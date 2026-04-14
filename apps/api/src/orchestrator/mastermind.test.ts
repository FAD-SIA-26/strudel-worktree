import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { MastermindStateMachine } from './mastermind'
import { eventBus } from '../events/eventBus'
import type { WorkerAgent, WorkerContext, WorkerResult, WorkerTask } from '../agents/types'

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
      repoRoot: repoDir, db, governor: gov, runId: 'r1', baseBranch: 'main',
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'rhythm', goal: 'Write rhythm', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['write bass pattern'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'only one' })
      },
    })

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    expect(result.status).toBe('done')
    expect(result.runBranch).toBe('run/r1')
    expect(events).toContain('OrchestrationComplete')
    eventBus.removeAllListeners('event')
  }, 30_000)

  it('passes the starting branch through to workers instead of assuming main', async () => {
    repoDir = initTestRepo('mastermind-branch-test', { initialBranch: 'trunk' })
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const seenBaseRefs: string[] = []

    class CapturingAgent implements WorkerAgent {
      async run(_task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
        seenBaseRefs.push(ctx.baseBranch)
        await fs.writeFile(`${ctx.worktreePath}/RESULT.txt`, 'done\n')
        return { status: 'done', branch: ctx.branch, diff: '', retryable: false }
      }
      async abort(): Promise<void> {}
    }

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'r2', baseBranch: 'trunk',
      agentFactory: () => new CapturingAgent(),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'landing', goal: 'Build landing page', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['build the landing page'])
        return JSON.stringify({ winnerId: 'r2-landing-v1', reasoning: 'only worker' })
      },
    })

    const result = await m.run({ userGoal: 'Build landing page' })
    expect(result.status).toBe('done')
    expect(seenBaseRefs).toEqual(['trunk'])
  }, 30_000)
})
