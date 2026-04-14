import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { LeadStateMachine } from './lead'
import { CommandQueue } from '../events/commandQueues'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('LeadStateMachine', () => {
  it('PM → 2 workers → reviewer → LeadDone, creates lead plan', async () => {
    repoDir = initTestRepo('lead-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const lead = new LeadStateMachine({
      id: 'rhythm-lead', sectionId: 'rhythm', sectionGoal: 'Write rhythm section',
      numWorkers: 2, baseBranch: 'main', runBranch: 'run/r1', runId: 'r1',
      repoRoot: repoDir, db, governor: gov,
      commandQueue: new CommandQueue(),
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'best diff' })
      },
    })
    const result = await lead.run()
    expect(result.status).toBe('done')
    expect(result.winnerBranch).toBe('feat/rhythm-v1')
  }, 30_000)
})
