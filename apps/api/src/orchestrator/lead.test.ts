import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
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
        // reviewer receives full namespaced workerId (r1-rhythm-v1), must return it
        return JSON.stringify({ winnerId: 'r1-rhythm-v1', reasoning: 'best diff' })
      },
    })
    const result = await lead.run()
    expect(result.status).toBe('done')
    expect(result.winnerBranch).toBe('feat/r1-rhythm-v1')
  }, 30_000)

  it('preserves the exact section goal when PM prompt generation falls back', async () => {
    repoDir = initTestRepo('lead-fallback-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const lead = new LeadStateMachine({
      id: 'main-lead', sectionId: 'main', sectionGoal: 'Create a file with exactly one line: hello',
      numWorkers: 2, baseBranch: 'main', runBranch: 'run/r2', runId: 'r2',
      repoRoot: repoDir, db, governor: gov,
      commandQueue: new CommandQueue(),
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async () => JSON.stringify({ winnerId: 'r2-main-v1', reasoning: 'fallback shape' }),
    })

    await lead.run()

    const leadPlan = await fs.readFile(`${repoDir}/.orc/runs/r2/leads/main.md`, 'utf8')
    expect(leadPlan).toContain('Create a file with exactly one line: hello')
    expect(leadPlan).not.toContain('(variation 1)')
    expect(leadPlan).not.toContain('(variation 2)')
  }, 30_000)

  it('force-approves a done winner and aborts running siblings', async () => {
    repoDir = initTestRepo('lead-force-approve-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const aborted: string[] = []

    class RecordingAgent extends MockAgent {
      constructor(private readonly workerId: string) {
        super({ delayMs: 5, outcome: 'done' })
      }

      override async abort(): Promise<void> {
        aborted.push(this.workerId)
        await super.abort()
      }
    }

    const q = new CommandQueue<any>()
    q.enqueue({ commandType: 'ForceApprove', winnerId: 'run1-main-v1' })

    let nextIndex = 0
    const lead = new LeadStateMachine({
      id: 'main-lead',
      sectionId: 'main',
      sectionGoal: 'build main section',
      numWorkers: 2,
      baseBranch: 'main',
      runBranch: 'run/run1',
      runId: 'run1',
      repoRoot: repoDir,
      db,
      governor: gov,
      commandQueue: q,
      agentFactory: () => {
        nextIndex += 1
        return new RecordingAgent(`run1-main-v${nextIndex}`)
      },
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'run1-main-v2', reasoning: 'reviewer would have picked v2' })
      },
    })

    const result = await lead.run()
    expect(result.status).toBe('done')
    expect(result.winnerBranch).toBe('feat/run1-main-v1')
    expect(result.reasoning).toBe('force-approved by user')
    expect(aborted).toContain('run1-main-v2')
  })
})
