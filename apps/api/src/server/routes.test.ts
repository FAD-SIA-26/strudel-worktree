import { afterAll, describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import request from 'supertest'
import { createTestDb, getSQLite } from '../db/client'
import { createApp } from './app'
import { CommandQueue } from '../events/commandQueues'
import { upsertArtifact, upsertTask, upsertWorktree } from '../db/queries'
import { createWorktree } from '../git/worktree'
import { cleanupTestRepo, initTestRepo } from '../test-helpers/initTestRepo'

let repoDir: string

afterAll(() => cleanupTestRepo(repoDir))

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

  it('GET /api/orchestration scopes workers and previews to the latest run', async () => {
    const db = createTestDb()
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    upsertTask(db, 'r2-bass-v1', 'worker', 'bass-lead', 'done')
    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', '/tmp/r1-bass-v1', 'feat/r1-bass-v1', 'main')
    upsertWorktree(db, 'run-r2', 'run-r2', '/tmp/run-r2', 'run/r2', 'main')
    upsertWorktree(db, 'r2-bass-v1', 'r2-bass-v1', '/tmp/r2-bass-v1', 'feat/r2-bass-v1', 'main')

    const sqlite = getSQLite(db)
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
    `).run('bass-lead', 'bass-lead', 'r2-bass-v1', null, 'lane/r2/bass', 'seed proposal', 'proposal_accept')
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('r1-bass-v1', 'solo', 'https://example.test/r1-solo', 'const bass = sound("bd")\nstack(bass)\n', '["src/bass.js"]', '[]', Date.now())
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('r2-bass-v1', 'solo', 'https://example.test/r2-solo', 'const bass = sound("bd")\nstack(bass)\n', '["src/bass.js"]', '[]', Date.now())

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      runId: 'r2',
      sections: [
        {
          id: 'bass',
          proposedWinnerWorkerId: 'r2-bass-v1',
          workers: [
            {
              id: 'r2-bass-v1',
              previewArtifacts: [
                { mode: 'solo', previewUrl: 'https://example.test/r2-solo' },
              ],
            },
          ],
        },
      ],
    })
    expect(res.body.sections[0].workers).toHaveLength(1)
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

  it('POST /api/drop rejects terminal workers', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'melody-v1', 'worker', 'melody-lead', 'done')
    const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

    const res = await request(app).post('/api/drop').send({
      leadId: 'melody-lead',
      workerId: 'melody-v1',
    })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'worker melody-v1 is already terminal' })
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

  it('POST /api/preview/final launches preview by composing all approved winners', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    // run worktree to anchor runId
    const runWorktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-route-preview-'))
    upsertWorktree(db, 'run-r1', 'run-r1', runWorktreePath, 'run/r1', 'main')

    // drums winner with real source
    const drumsWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-drums-'))
    await fs.mkdir(path.join(drumsWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(drumsWt, 'src/drums.js'), 'export const drums = s("bd hh sd hh")\n')
    upsertTask(db, 'drums-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-drums-v1', 'worker', 'drums-lead', 'done')
    upsertWorktree(db, 'r1-drums-v1', 'r1-drums-v1', drumsWt, 'feat/r1-drums-v1', 'main')
    sqlite.prepare(`INSERT INTO merge_candidates(id,lead_id,proposed_winner_worker_id,selected_winner_worker_id,target_branch,reviewer_reasoning,selection_source) VALUES(?,?,?,?,?,?,?)`
    ).run('drums-lead','drums-lead','r1-drums-v1','r1-drums-v1','lane/r1/drums','auto','proposal_accept')

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

  it('POST /api/preview/final returns 409 when no approved winners exist', async () => {
    const db = createTestDb()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-route-preview-missing-'))
    upsertWorktree(db, 'run-r1', 'run-r1', worktreePath, 'run/r1', 'main')
    const app = createApp({ db, leadQueues: new Map() })

    const res = await request(app).post('/api/preview/final').send({})

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'final preview unavailable: no approved winners with source files' })
  })

  it('POST /api/preview/final reuses the persisted final preview artifact when present', async () => {
    const db = createTestDb()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-route-preview-existing-'))
    upsertWorktree(db, 'run-r1', 'run-r1', worktreePath, 'run/r1', 'main')
    getSQLite(db).prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('run:r1:final', 'solo', 'https://strudel.cc/#existing', 'stack(sound("bd"))', '["src/index.js"]', '[]', Date.now())
    const app = createApp({ db, leadQueues: new Map() })

    const res = await request(app).post('/api/preview/final').send({})

    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({
      workerId: 'run:r1:final',
      mode: 'solo',
      previewUrl: 'https://strudel.cc/#existing',
    })
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

  it('GET /api/orchestration only advertises final preview availability when launchable', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-run-state-'))

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('mastermind', 'mastermind', null, 'review_ready', now, now)
    upsertWorktree(db, 'run-r3', 'run-r3', worktreePath, 'run/r3', 'main')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    expect(res.body.runId).toBe('r3')
    expect(res.body.reviewReady).toBe(true)
    expect(res.body.fullSongPreviewAvailable).toBe(false)
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
    upsertWorktree(db, 'chords-v2', 'chords-v2', '/tmp/chords-v2', 'feat/chords-v2', 'main')

    const resAfterSelection = await request(app).get('/api/orchestration')
    const melodyAfterSelection = resAfterSelection.body.sections.find((s: any) => s.id === 'melody')

    expect(melodyAfterSelection.workers[0].contextAvailable).toBe(true)
  })

  it('GET /api/orchestration hides stale contextual previews when upstream winner selection changes', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const now = Date.now()

    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('bass-lead', 'lead', 'mastermind', 'done', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-lead', 'lead', 'mastermind', 'running', now, now)
    sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('melody-v1', 'worker', 'melody-lead', 'done', now, now)
    sqlite.prepare(`INSERT INTO task_edges (parent_id, child_id, edge_type) VALUES (?, ?, ?)`)
      .run('bass-lead', 'melody-lead', 'depends_on')
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
      'bass-lead',
      'bass-lead',
      'bass-v2',
      'bass-v2',
      'lane/test/bass',
      'seed proposal',
      'proposal_accept',
    )
    upsertWorktree(db, 'bass-v2', 'bass-v2', '/tmp/bass-v2', 'feat/bass-v2', 'main')
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'melody-v1',
      'contextual',
      'https://example.test/stale-context',
      'stack(sound("bd"), sound("lead"))\n',
      '["src/bass.js","src/melody.js"]',
      '["bass-v1"]',
      now,
    )

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')
    const melodySection = res.body.sections.find((s: any) => s.id === 'melody')

    expect(res.status).toBe(200)
    expect(melodySection.workers[0].contextAvailable).toBe(true)
    expect(melodySection.workers[0].previewArtifacts).toEqual([])
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

  it('GET /api/entities/:entityId/detail returns worker plan, diff, and resolved paths', async () => {
    repoDir = initTestRepo('worker-detail-route')
    const db = createTestDb()
    const wtPath = path.join(repoDir, '.orc', 'worktrees', 'main-v1')

    await createWorktree(repoDir, wtPath, 'feat/main-v1')
    await fs.writeFile(path.join(wtPath, 'README.md'), '# worker branch change\n')
    await fs.writeFile(path.join(wtPath, '.orc', 'worker-plan.md'), '# Worker Plan\n\n- [ ] inspect\n')
    await fs.writeFile(path.join(wtPath, '.orc', '.orc-session.jsonl'), '{"ts":1,"output":"hello"}\n')

    upsertTask(db, 'main-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'main-v1', 'worker', 'main-lead', 'running')
    upsertWorktree(db, 'main-v1', 'main-v1', wtPath, 'feat/main-v1', 'main')
    upsertArtifact(db, 'main-v1', 'worker_plan', path.join(wtPath, '.orc', 'worker-plan.md'))
    upsertArtifact(db, 'main-v1', 'session_log', path.join(wtPath, '.orc', '.orc-session.jsonl'))

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/entities/main-v1/detail')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      entityId: 'main-v1',
      entityType: 'worker',
      resolvedPaths: {
        worktreePath: wtPath,
        planPath: path.join(wtPath, '.orc', 'worker-plan.md'),
        logPath: path.join(wtPath, '.orc', '.orc-session.jsonl'),
      },
      plan: {
        status: 'ready',
        content: '# Worker Plan\n\n- [ ] inspect\n',
      },
      diff: {
        status: 'ready',
        branch: 'feat/main-v1',
        baseBranch: 'main',
      },
    })
    expect(String(res.body.diff.content)).toContain('diff --git')
  })

  it('GET /api/entities/:entityId/detail predicts queued worker paths before the worktree exists', async () => {
    repoDir = initTestRepo('queued-worker-detail-route')
    const db = createTestDb()
    const runWtPath = path.join(repoDir, '.orc', 'worktrees', 'run-r9')

    await createWorktree(repoDir, runWtPath, 'run/r9')

    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'r9-chords-v1', 'worker', 'chords-lead', 'queued')
    upsertWorktree(db, 'run-r9', 'run-r9', runWtPath, 'run/r9', 'main')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/entities/r9-chords-v1/detail')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      entityId: 'r9-chords-v1',
      entityType: 'worker',
      resolvedPaths: {
        worktreePath: path.join(repoDir, '.orc', 'worktrees', 'r9-chords-v1'),
        planPath: path.join(repoDir, '.orc', 'worktrees', 'r9-chords-v1', '.orc', 'worker-plan.md'),
        logPath: path.join(repoDir, '.orc', 'worktrees', 'r9-chords-v1', '.orc', '.orc-session.jsonl'),
      },
      plan: {
        status: 'missing',
      },
      diff: {
        status: 'missing',
        branch: 'feat/r9-chords-v1',
        baseBranch: 'main',
      },
    })
    expect(res.body.plan.message).toMatch(/queued|does not exist yet/i)
    expect(res.body.diff.message).toMatch(/queued|not been created yet/i)
  })

  it('GET /api/entities/:entityId/detail returns the selected winner diff for a lead', async () => {
    repoDir = initTestRepo('lead-detail-route')
    const db = createTestDb()
    const wtPath = path.join(repoDir, '.orc', 'worktrees', 'melody-v2')

    await createWorktree(repoDir, wtPath, 'feat/melody-v2')
    await fs.writeFile(path.join(wtPath, 'README.md'), '# winner branch change\n')
    await fs.mkdir(path.join(repoDir, '.orc', 'runs', 'r5', 'leads'), { recursive: true })
    await fs.writeFile(path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'), '# Lead Plan\n')

    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'reviewing')
    upsertTask(db, 'melody-v2', 'worker', 'melody-lead', 'done')
    upsertWorktree(db, 'melody-v2', 'melody-v2', wtPath, 'feat/melody-v2', 'main')
    upsertArtifact(db, 'melody-lead', 'lead_plan', path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'))

    const sqlite = getSQLite(db)
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
    `).run('melody-lead', 'melody-lead', 'melody-v2', 'melody-v2', 'run/r5', 'winner selected', 'proposal_accept')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/entities/melody-lead/detail')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      entityId: 'melody-lead',
      entityType: 'lead',
      resolvedPaths: {
        planPath: path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'),
        winnerWorktreePath: wtPath,
      },
      plan: {
        status: 'ready',
        content: '# Lead Plan\n',
      },
      diff: {
        status: 'ready',
        winnerWorkerId: 'melody-v2',
        branch: 'feat/melody-v2',
        baseBranch: 'main',
      },
    })
    expect(String(res.body.diff.content)).toContain('diff --git')
  })

  it('GET /api/entities/:entityId/logs returns an empty payload for queued workers before worktree creation', async () => {
    repoDir = initTestRepo('queued-worker-logs-route')
    const db = createTestDb()
    const runWtPath = path.join(repoDir, '.orc', 'worktrees', 'run-r10')

    await createWorktree(repoDir, runWtPath, 'run/r10')

    upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'r10-melody-v2', 'worker', 'melody-lead', 'queued')
    upsertWorktree(db, 'run-r10', 'run-r10', runWtPath, 'run/r10', 'main')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/entities/r10-melody-v2/logs')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      entries: [],
      tailCursor: null,
    })
  })

  it('GET /api/orchestration sets contextAvailable=false when upstream winner has no worktree row', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    // bass-lead is done, winner selected
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    // bass winner's worktree intentionally NOT inserted

    // chords-lead depends on bass-lead
    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', '/tmp/r1-chords-v1', 'feat/r1-chords-v1', 'main')

    // run worktree to anchor runId
    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')

    sqlite.prepare(`
      INSERT INTO task_edges(parent_id, child_id, edge_type) VALUES (?, ?, ?)
    `).run('bass-lead', 'chords-lead', 'depends_on')

    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, proposed_winner_worker_id, selected_winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bass-lead', 'bass-lead', 'r1-bass-v1', 'r1-bass-v1', 'lane/r1/bass', 'auto', 'proposal_accept')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    const chordsSection = res.body.sections.find((s: any) => s.id === 'chords')
    expect(chordsSection.workers[0].contextAvailable).toBe(false)
  })

  it('GET /api/orchestration sets contextAvailable=true when upstream winner and worktree both exist', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    // bass-lead done with winner + worktree
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', '/tmp/r1-bass-v1', 'feat/r1-bass-v1', 'main')

    // chords-lead depends on bass-lead
    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', '/tmp/r1-chords-v1', 'feat/r1-chords-v1', 'main')

    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')

    sqlite.prepare(`
      INSERT INTO task_edges(parent_id, child_id, edge_type) VALUES (?, ?, ?)
    `).run('bass-lead', 'chords-lead', 'depends_on')

    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, proposed_winner_worker_id, selected_winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bass-lead', 'bass-lead', 'r1-bass-v1', 'r1-bass-v1', 'lane/r1/bass', 'auto', 'proposal_accept')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    const chordsSection = res.body.sections.find((s: any) => s.id === 'chords')
    expect(chordsSection.workers[0].contextAvailable).toBe(true)
  })

  it('GET /api/orchestration sets contextAvailable=true when any other section has a selected winner with worktree', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')

    // bass-lead: done, winner selected, worktree exists
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', '/tmp/r1-bass-v1', 'feat/r1-bass-v1', 'main')
    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, proposed_winner_worker_id, selected_winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bass-lead', 'bass-lead', 'r1-bass-v1', 'r1-bass-v1', 'lane/r1/bass', 'auto', 'proposal_accept')

    // chords-lead: awaiting approval, NO depends_on edge
    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', '/tmp/r1-chords-v1', 'feat/r1-chords-v1', 'main')
    // NOTE: no task_edges row — chords does NOT depend on bass

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    const chordsSection = res.body.sections.find((s: any) => s.id === 'chords')
    expect(chordsSection.workers[0].contextAvailable).toBe(true)
  })

  it('GET /api/orchestration sets contextAvailable=false when no other section has an approved winner', async () => {
    const db = createTestDb()

    upsertWorktree(db, 'run-r1', 'run-r1', '/tmp/run-r1', 'run/r1', 'main')

    // bass-lead: awaiting approval, no winner yet
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', '/tmp/r1-bass-v1', 'feat/r1-bass-v1', 'main')

    // chords-lead: also no winner
    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', '/tmp/r1-chords-v1', 'feat/r1-chords-v1', 'main')

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    const chordsSection = res.body.sections.find((s: any) => s.id === 'chords')
    expect(chordsSection.workers[0].contextAvailable).toBe(false)
  })

  it('GET /api/entities/:entityId/logs returns the latest worker log window oldest-first', async () => {
    repoDir = initTestRepo('worker-logs-route')
    const db = createTestDb()
    const wtPath = path.join(repoDir, '.orc', 'worktrees', 'main-v1')

    await createWorktree(repoDir, wtPath, 'feat/main-v1')
    await fs.writeFile(path.join(wtPath, '.orc', '.orc-session.jsonl'), [
      JSON.stringify({ ts: 1, output: 'first\n' }),
      JSON.stringify({ ts: 2, output: 'second\n' }),
      JSON.stringify({ ts: 3, output: 'third\n' }),
    ].join('\n') + '\n')

    upsertTask(db, 'main-lead', 'lead', 'mastermind', 'running')
    upsertTask(db, 'main-v1', 'worker', 'main-lead', 'running')
    upsertWorktree(db, 'main-v1', 'main-v1', wtPath, 'feat/main-v1', 'main')
    upsertArtifact(db, 'main-v1', 'session_log', path.join(wtPath, '.orc', '.orc-session.jsonl'))

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/entities/main-v1/logs?limit=2')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      entries: [
        expect.objectContaining({ id: 'main-v1:line:2', body: 'second', kind: 'stdout' }),
        expect.objectContaining({ id: 'main-v1:line:3', body: 'third', kind: 'stdout' }),
      ],
      tailCursor: 'line:3',
    })
  })
})
