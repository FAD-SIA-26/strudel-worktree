import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from './test-helpers/initTestRepo'
import { createTestDb } from './db/client'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { MockAgent } from './agents/mock'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { CommandQueue } from './events/commandQueues'
import { eventBus } from './events/eventBus'
import * as url from 'node:url'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

const strudelTemplatePath = url.fileURLToPath(
  new URL('../../../templates/strudel-track.toml', import.meta.url),
)

describe('Full orchestration (MockAgent)', () => {
  it('5-lane Strudel template: all sections delegate in one parallel batch', async () => {
    repoDir = initTestRepo('integration')
    const db  = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const leadQueues = new Map<string, CommandQueue<any>>()
    const emitted: string[] = []
    const leadDelegatedOrder: string[] = []
    const handler = (e: any) => {
      emitted.push(e.eventType)
      if (e.eventType === 'LeadDelegated') leadDelegatedOrder.push(e.payload?.sectionId ?? e.entityId)
    }
    eventBus.on('event', handler)

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'int-run', baseBranch: 'main',
      leadQueues,
      templatePath: strudelTemplatePath,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['write it'])
        const match = p.match(/([\w-]+-v1)/)
        return JSON.stringify({ winnerId: match?.[1] ?? 'drums-v1', reasoning: 'only one' })
      },
    })

    const autoApprove = setInterval(() => {
      for (const q of leadQueues.values()) {
        if (q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
      }
    }, 10)

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    clearInterval(autoApprove)
    eventBus.off('event', handler)

    expect(result.status).toBe('review_ready')
    expect(emitted).toContain('WorkerDone')
    expect(emitted).toContain('WinnerProposed')
    expect(emitted).toContain('WinnerSelected')
    expect(emitted).toContain('OrchestrationComplete')
    expect(leadDelegatedOrder).toEqual(['drums', 'bass', 'chords', 'melody', 'arrangement'])
    expect(emitted.lastIndexOf('LeadDelegated')).toBeLessThan(emitted.indexOf('LeadDone'))
  }, 60_000)
})
