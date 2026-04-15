import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createTestDb, getSQLite } from '../db/client'
import { readLeadLogWindow, readWorkerLogWindow } from './entityLogs'

describe('entityLogs', () => {
  it('returns worker log entries oldest-first with line-based ids and a tail cursor', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-worker-log-'))
    const logPath = path.join(dir, '.orc-session.jsonl')

    await fs.writeFile(logPath, [
      JSON.stringify({ ts: 1, output: '{"type":"thread.started"}\n' }),
      JSON.stringify({ ts: 2, error: 'boom\n' }),
      JSON.stringify({ ts: 3, output: 'plain stdout\n' }),
    ].join('\n') + '\n')

    const result = await readWorkerLogWindow('main-v1', logPath, 2)

    expect(result).toEqual({
      entries: [
        expect.objectContaining({ id: 'main-v1:line:2', kind: 'stderr', ts: 2 }),
        expect.objectContaining({ id: 'main-v1:line:3', kind: 'stdout', ts: 3 }),
      ],
      tailCursor: 'line:3',
    })
  })

  it('returns only lead events for the selected lead id', () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    sqlite.prepare(`
      INSERT INTO event_log(entity_id, entity_type, event_type, sequence, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'lead', 'ReviewComplete', 1, '{"winnerId":"melody-v2"}', 10)

    sqlite.prepare(`
      INSERT INTO event_log(entity_id, entity_type, event_type, sequence, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('melody-v2', 'worker', 'WorkerDone', 1, '{"branch":"feat/melody-v2","diff":"+x"}', 11)

    const result = readLeadLogWindow(db, 'melody-lead', 50)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      id: 'melody-lead:event:1',
      kind: 'lead_event',
      title: 'ReviewComplete',
    })
    expect(result.tailCursor).toBe('event:1')
  })
})
