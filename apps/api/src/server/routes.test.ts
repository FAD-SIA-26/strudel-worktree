import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import request from 'supertest'
import { createTestDb, getSQLite } from '../db/client'
import { createApp } from './app'
import { CommandQueue } from '../events/commandQueues'
import { upsertTask, upsertWorktree } from '../db/queries'

describe('routes', () => {
  it('GET /api/orchestration returns sections array', async () => {
    const db = createTestDb()
    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sections')
  })

  it('GET /api/orchestration includes workers, selection flags, and previews for each lead', async () => {
    const db = createTestDb()
    upsertTask(db, 'main-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'main-v1', 'worker', 'main-lead', 'done')
    upsertWorktree(db, 'main-v1', 'main-v1', '/tmp/main-v1', 'feat/main-v1', 'main')
    const sqlite = getSQLite(db)
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('main-v1', 'solo', 'https://example.test/solo', 'const main = sound("bd")\nstack(main)\n', '["src/main.js"]', '[]', Date.now())
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('main-v1', 'contextual', 'https://example.test/context', 'const main = sound("bd")\nstack(main)\n', '["src/main.js"]', '[]', Date.now())

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      runId: 'current',
      mastermindState: 'idle',
      reviewReady: false,
      fullSongPreviewAvailable: false,
      sections: [
        {
          id: 'main',
          state: 'running',
          proposedWinnerWorkerId: null,
          selectedWinnerWorkerId: null,
          selectionStatus: 'waiting_for_review',
          awaitingUserApproval: false,
          workers: [
            {
              id: 'main-v1',
              state: 'done',
              branch: 'feat/main-v1',
              isProposed: false,
              isSelected: false,
              canBeSelected: false,
              isStopping: false,
              contextAvailable: false,
              previewArtifacts: [
                { mode: 'solo', previewUrl: 'https://example.test/solo' },
                { mode: 'contextual', previewUrl: 'https://example.test/context' },
              ],
            },
          ],
        },
      ],
    })
  })

  it('GET / redirects to the dashboard when configured', async () => {
    const db = createTestDb()
    const app = createApp({
      db,
      leadQueues: new Map(),
      dashboardUrl: 'http://localhost:3000',
    })

    const res = await request(app).get('/')

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:3000')
  })

  it('POST /api/approve accepts a proposal without a worker id', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    getSQLite(db).prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', null, 'lane/r1/melody', 'seed proposal', 'proposal_accept')
    const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

    const res = await request(app).post('/api/approve').send({ leadId: 'melody-lead' })

    expect(res.status).toBe(202)
    expect(await leadQ.dequeue()).toEqual({ commandType: 'AcceptProposal' })
  })

  it('POST /api/approve selects an explicit winner when workerId is provided', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'melody-v2', 'worker', 'melody-lead', 'done')
    getSQLite(db).prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', null, 'lane/r1/melody', 'seed proposal', 'proposal_accept')
    const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

    const res = await request(app).post('/api/approve').send({
      leadId: 'melody-lead',
      workerId: 'melody-v2',
    })

    expect(res.status).toBe(202)
    expect(await leadQ.dequeue()).toEqual({
      commandType: 'SelectWinner',
      workerId: 'melody-v2',
    })
  })

  it('POST /api/approve rejects selection before the lead is awaiting approval', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'melody-v2', 'worker', 'melody-lead', 'done')
    getSQLite(db).prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', null, 'lane/r1/melody', 'seed proposal', 'proposal_accept')
    const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

    const res = await request(app).post('/api/approve').send({
      leadId: 'melody-lead',
      workerId: 'melody-v2',
    })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'lead melody-lead is not awaiting user approval' })
    expect(leadQ.size).toBe(0)
  })

  it('POST /api/approve rejects workers that are not selectable', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'melody-v2', 'worker', 'melody-lead', 'running')
    getSQLite(db).prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', null, 'lane/r1/melody', 'seed proposal', 'proposal_accept')
    const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

    const res = await request(app).post('/api/approve').send({
      leadId: 'melody-lead',
      workerId: 'melody-v2',
    })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'worker melody-v2 is not selectable for melody-lead' })
    expect(leadQ.size).toBe(0)
  })

  it('POST /api/preview/launch returns a solo preview artifact', async () => {
    const db = createTestDb()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-route-preview-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src', 'main.js'), 'export const main = sound("bd")\n')
    upsertWorktree(db, 'main-v1', 'main-v1', worktreePath, 'feat/main-v1', 'main')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app)
      .post('/api/preview/launch')
      .send({ workerId: 'main-v1', mode: 'solo' })

    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({
      mode: 'solo',
      previewUrl: expect.stringMatching(/^https:\/\/strudel\.cc\/#/),
    })
  })

  it('POST /api/preview/final launches preview from the run worktree', async () => {
    const db = createTestDb()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-route-preview-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src/index.js'), 'stack(sound("bd"), sound("hh"))\n')
    upsertWorktree(db, 'run-r1', 'run-r1', worktreePath, 'run/r1', 'main')
    const app = createApp({ db, leadQueues: new Map() })

    const res = await request(app).post('/api/preview/final').send({})

    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({
      workerId: 'run:r1:final',
      mode: 'solo',
      previewUrl: expect.stringMatching(/^https:\/\/strudel\.cc\/#/),
    })
  })

  it('POST /api/preview/final returns 409 when no run worktree exists', async () => {
    const db = createTestDb()
    const app = createApp({ db, leadQueues: new Map() })

    const res = await request(app).post('/api/preview/final').send({})

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'final preview unavailable' })
  })

  it('POST /api/preview/final returns 409 when the run file is missing', async () => {
    const db = createTestDb()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-route-preview-missing-'))
    upsertWorktree(db, 'run-r1', 'run-r1', worktreePath, 'run/r1', 'main')
    const app = createApp({ db, leadQueues: new Map() })

    const res = await request(app).post('/api/preview/final').send({})

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'final preview unavailable: missing src/index.js' })
  })

  it('GET /api/orchestration returns proposed/selected state plus review-ready fields', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('mastermind', 'mastermind', null, 'review_ready', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-lead', 'lead', 'mastermind', 'done', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-v1', 'worker', 'melody-lead', 'done', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-v2', 'worker', 'melody-lead', 'stop_failed', now, now)
    upsertWorktree(db, 'melody-v1', 'melody-v1', '/tmp/melody-v1', 'feat/melody-v1', 'main')
    upsertWorktree(db, 'melody-v2', 'melody-v2', '/tmp/melody-v2', 'feat/melody-v2', 'main')
    upsertWorktree(db, 'run-current', 'run-current', '/tmp/run-current', 'run/current', 'main')
    sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'melody-lead',
      'melody-lead',
      'melody-v1',
      'melody-v2',
      'lane/r1/melody',
      'reviewer preferred v1',
      'user_override',
    )
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run:current:final',
      'solo',
      'https://strudel.cc/#final',
      'stack(sound("bd"))',
      '["src/index.js"]',
      '[]',
      now,
    )

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')
    const body = res.body
    const melodySection = body.sections.find((s: any) => s.id === 'melody')

    expect(res.status).toBe(200)
    expect(body.reviewReady).toBe(true)
    expect(body.fullSongPreviewAvailable).toBe(true)
    expect(body.fullSongPreviewUrl).toBe('https://strudel.cc/#final')
    expect(melodySection).toMatchObject({
      id: 'melody',
      state: 'done',
      proposedWinnerWorkerId: 'melody-v1',
      selectedWinnerWorkerId: 'melody-v2',
      selectionStatus: 'lane_merged',
      awaitingUserApproval: false,
    })
    expect(melodySection.workers[0]).toMatchObject({
      id: 'melody-v1',
      isProposed: true,
      isSelected: false,
      canBeSelected: false,
      isStopping: false,
    })
    expect(melodySection.workers[1]).toMatchObject({
      id: 'melody-v2',
      isProposed: false,
      isSelected: true,
      canBeSelected: false,
      isStopping: false,
    })
  })

  it('GET /api/orchestration reflects awaiting approval state from persisted tasks', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-lead', 'lead', 'mastermind', 'awaiting_user_approval', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-v1', 'worker', 'melody-lead', 'done', now, now)
    sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', null, 'lane/r1/melody', 'seed proposal', 'proposal_accept')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')
    const melodySection = res.body.sections.find((s: any) => s.id === 'melody')

    expect(res.status).toBe(200)
    expect(melodySection).toMatchObject({
      awaitingUserApproval: true,
      selectionStatus: 'waiting_for_user',
    })
    expect(melodySection.workers[0]).toMatchObject({
      id: 'melody-v1',
      isProposed: true,
      canBeSelected: true,
    })
  })

  it('GET /api/orchestration marks context available only after upstream selected winner exists', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('chords-lead', 'lead', 'mastermind', 'done', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-lead', 'lead', 'mastermind', 'running', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-v1', 'worker', 'melody-lead', 'done', now, now)
    sqlite.prepare(`INSERT INTO task_edges (parent_id, child_id, edge_type) VALUES (?, ?, ?)`)
      .run('chords-lead', 'melody-lead', 'depends_on')
    sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'chords-lead',
      'chords-lead',
      'chords-v2',
      null,
      'lane/test/chords',
      'seed proposal',
      'proposal_accept',
    )

    const app = createApp({ db, leadQueues: new Map() })
    const resBeforeSelection = await request(app).get('/api/orchestration')
    const melodyBeforeSelection = resBeforeSelection.body.sections.find((s: any) => s.id === 'melody')

    expect(melodyBeforeSelection.workers[0].contextAvailable).toBe(false)

    sqlite.prepare(`
      UPDATE merge_candidates
      SET selected_winner_worker_id = ?
      WHERE lead_id = ?
    `).run('chords-v2', 'chords-lead')

    const resAfterSelection = await request(app).get('/api/orchestration')
    const melodyAfterSelection = resAfterSelection.body.sections.find((s: any) => s.id === 'melody')

    expect(melodyAfterSelection.workers[0].contextAvailable).toBe(true)
  })

  it('GET /api/orchestration prefers the newest run worktree for run-level state', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('mastermind', 'mastermind', null, 'review_ready', now, now)
    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')
    upsertWorktree(db, 'run-r2', 'run-r2', '/tmp/run-r2', 'run/r2', 'main')
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('run:r2:final', 'solo', 'https://strudel.cc/#r2', 'stack(sound("hh"))', '["src/index.js"]', '[]', now)

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    expect(res.body.runId).toBe('r2')
    expect(res.body.fullSongPreviewUrl).toBe('https://strudel.cc/#r2')
  })
})
