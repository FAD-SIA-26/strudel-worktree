import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { MastermindStateMachine } from './mastermind'
import { eventBus } from '../events/eventBus'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('MastermindStateMachine', () => {
  it('decomposes → spawns leads in dependency order → OrchestrationComplete', async () => {
    repoDir = initTestRepo('mastermind-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const events: string[] = []
    eventBus.on('event', (e: any) => events.push(e.eventType))

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'r1',
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'rhythm', goal: 'Write rhythm', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['write bass pattern'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'only one' })
      },
    })

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    expect(result.status).toBe('done')
    expect(events).toContain('OrchestrationComplete')
    eventBus.removeAllListeners('event')
  }, 30_000)
})
