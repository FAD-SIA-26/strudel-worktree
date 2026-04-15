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

  it('GET /api/orchestration includes workers and previews for each lead', async () => {
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
    expect(res.body).toEqual({
      runId: 'current',
      mastermindState: 'idle',
      sections: [
        {
          id: 'main',
          state: 'running',
          workers: [
            {
              id: 'main-v1',
              state: 'done',
              branch: 'feat/main-v1',
              selected: false,
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

  it('POST /api/approve enqueues ForceApprove to lead queue', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    const leadQueues = new Map([['drums-lead', leadQ]])
    const app = createApp({ db, leadQueues })
    const res = await request(app).post('/api/approve').send({ workerId: 'drums-v1', leadId: 'drums-lead' })
    expect(res.status).toBe(202)
    expect(leadQ.size).toBe(1)
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

  it('GET /api/orchestration marks selected workers and context availability', async () => {
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
      INSERT INTO merge_candidates(id, lead_id, winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('chords-lead', 'chords-lead', 'chords-v2', 'run/test', 'seed winner', 'reviewer')
    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'melody-lead', 'melody-v1', 'run/test', 'seed selection', 'user')
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-v1', 'solo', 'https://example.test/solo', 'const melody = note("a4").sound("sine")\nstack(melody)\n', '["src/melody.js"]', '[]', now)
    sqlite.prepare(`
      INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('melody-v1', 'contextual', 'https://example.test/context', 'const chords = note("<[d4 f4 a4]>").sound("triangle")\nconst melody = note("a4").sound("sine")\nstack(chords, melody)\n', '["src/chords.js","src/melody.js"]', '["chords-v2"]', now)

    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')

    expect(res.status).toBe(200)
    const melodySection = res.body.sections.find((s: any) => s.id === 'melody')
    expect(melodySection.workers[0]).toMatchObject({
      id: 'melody-v1',
      selected: true,
      contextAvailable: true,
      previewArtifacts: [
        { mode: 'solo', previewUrl: 'https://example.test/solo' },
        { mode: 'contextual', previewUrl: 'https://example.test/context' },
      ],
    })
  })
})
