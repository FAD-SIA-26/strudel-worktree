import { describe, it, expect } from 'vitest'
import { createTestDb, getSQLite } from '../db/client'
import { Watchdog } from './watchdog'

describe('Watchdog', () => {
  it('marks stalled worker when last_seen_at exceeds threshold', async () => {
    const db = createTestDb()
    const now = Date.now()
    getSQLite(db).prepare(`INSERT INTO tasks(id,type,parent_id,state,created_at,updated_at) VALUES('w1','worker','l1','running',${now},${now})`).run()
    getSQLite(db).prepare(`INSERT INTO runs(id,entity_id,started_at,last_seen_at) VALUES('r1','w1',${now - 200_000},${now - 200_000})`).run()
    const stalled: string[] = []
    const wd = new Watchdog({ db, intervalMs: 50, stalledThresholdMs: 60_000 })
    wd.on('WorkerStalled', (id: string) => stalled.push(id))
    wd.start()
    await new Promise(r => setTimeout(r, 150))
    wd.stop()
    expect(stalled).toContain('w1')
  })
})
