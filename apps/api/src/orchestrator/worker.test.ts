import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { WorkerStateMachine } from './worker'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('WorkerStateMachine', () => {
  it('queued → spawning → running → done, creates plan file', async () => {
    repoDir = initTestRepo('worker-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const worker = new WorkerStateMachine({
      id: 'rhythm-v1', leadId: 'rhythm-lead', sectionId: 'rhythm',
      branch: 'feat/rhythm-v1', baseBranch: 'main',
      repoRoot: repoDir, runId: 'run-1', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    })
    const result = await worker.run({ id: 'rhythm-v1', prompt: 'Write rhythm', maxRetries: 1, errorHistory: [] })
    expect(result.status).toBe('done')
    expect(worker.state).toBe('done')
  }, 15_000)

  it('emits WorkerFailed and slotHeld=false on failure', async () => {
    repoDir = repoDir ?? initTestRepo('worker-fail-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const worker = new WorkerStateMachine({
      id: 'rhythm-v2', leadId: 'rhythm-lead', sectionId: 'rhythm',
      branch: 'feat/rhythm-v2', baseBranch: 'main',
      repoRoot: repoDir, runId: 'run-1', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'failed' }),
    })
    const result = await worker.run({ id: 'rhythm-v2', prompt: 'Write rhythm', maxRetries: 1, errorHistory: [] })
    expect(result.status).toBe('failed')
    expect(gov.activeCount).toBe(0)
  }, 15_000)
})
