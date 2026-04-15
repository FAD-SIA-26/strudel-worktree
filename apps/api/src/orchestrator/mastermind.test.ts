import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb, getSQLite } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { MastermindStateMachine } from './mastermind'
import { eventBus } from '../events/eventBus'
import { CommandQueue } from '../events/commandQueues'
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

    const leadQueues = new Map<string, CommandQueue<any>>()
    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'r1', baseBranch: 'main',
      leadQueues,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'rhythm', goal: 'Write rhythm', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['write bass pattern'])
        return JSON.stringify({ winnerId: 'r1-rhythm-v1', reasoning: 'only one' })
      },
    })
    const autoApprove = setInterval(() => {
      const q = leadQueues.get('rhythm-lead')
      if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
    }, 10)

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    clearInterval(autoApprove)
    expect(result.status).toBe('review_ready')
    expect(result.runBranch).toBe('run/r1')
    expect(events).toContain('OrchestrationComplete')
    eventBus.removeAllListeners('event')
  }, 30_000)

  it('passes the starting branch through to workers instead of assuming main', async () => {
    repoDir = initTestRepo('mastermind-branch-test', { initialBranch: 'trunk' })
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const seenBaseRefs: string[] = []
    const leadQueues = new Map<string, CommandQueue<any>>()

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
      leadQueues,
      agentFactory: () => new CapturingAgent(),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'landing', goal: 'Build landing page', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['build the landing page'])
        return JSON.stringify({ winnerId: 'r2-landing-v1', reasoning: 'only worker' })
      },
    })
    const autoApprove = setInterval(() => {
      const q = leadQueues.get('landing-lead')
      if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
    }, 10)

    const result = await m.run({ userGoal: 'Build landing page' })
    clearInterval(autoApprove)
    expect(result.status).toBe('review_ready')
    expect(seenBaseRefs).toEqual(['trunk'])
  }, 30_000)

  it('persists section dependency edges for downstream contextual previews', async () => {
    repoDir = initTestRepo('mastermind-deps-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const leadQueues = new Map<string, CommandQueue<any>>()

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'r3', baseBranch: 'main',
      leadQueues,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) {
          return JSON.stringify([
            { id: 'chords', goal: 'Write chords', numWorkers: 1, dependsOn: [] },
            { id: 'melody', goal: 'Write melody', numWorkers: 1, dependsOn: ['chords'] },
          ])
        }
        if (p.includes('Generate')) return JSON.stringify(['only variation'])
        return JSON.stringify({ winnerId: 'r3-chords-v1', reasoning: 'only worker' })
      },
    })
    const autoApprove = setInterval(() => {
      for (const leadId of ['chords-lead', 'melody-lead']) {
        const q = leadQueues.get(leadId)
        if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
      }
    }, 10)

    await m.run({ userGoal: 'Build a dependent track' })
    clearInterval(autoApprove)

    const edges = getSQLite(db)
      .prepare(`SELECT parent_id AS parentId, child_id AS childId, edge_type AS edgeType FROM task_edges`)
      .all() as Array<{ parentId: string; childId: string; edgeType: string }>

    expect(edges).toContainEqual({
      parentId: 'chords-lead',
      childId: 'melody-lead',
      edgeType: 'depends_on',
    })
  }, 30_000)

  it('merges lane branches into the run branch and ends in review_ready', async () => {
    repoDir = initTestRepo('mastermind-review-ready-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const leadQueues = new Map<string, CommandQueue<any>>()
    const mergedSources: string[] = []

    const m = new MastermindStateMachine({
      repoRoot: repoDir,
      db,
      governor: gov,
      runId: 'r4',
      baseBranch: 'main',
      leadQueues,
      doMerge: async (_target, source) => {
        mergedSources.push(source)
        return { success: true, conflictFiles: [] }
      },
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'arrangement', goal: 'Write arrangement', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['only variation'])
        return JSON.stringify({ winnerId: 'r4-arrangement-v1', reasoning: 'only one' })
      },
    })

    const autoApprove = setInterval(() => {
      const q = leadQueues.get('arrangement-lead')
      if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
    }, 10)

    const result = await m.run({ userGoal: 'Build track' })
    clearInterval(autoApprove)

    expect(result.status).toBe('review_ready')
    expect(m.state).toBe('review_ready')
    expect(mergedSources).toEqual(['lane/r4/arrangement'])
  }, 30_000)
})
