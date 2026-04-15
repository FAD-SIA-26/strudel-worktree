import { afterAll, describe, expect, it } from 'vitest'
import { MockAgent } from '../agents/mock'
import { createTestDb, getSQLite } from '../db/client'
import { CommandQueue } from '../events/commandQueues'
import { cleanupTestRepo, initTestRepo } from '../test-helpers/initTestRepo'
import { ConcurrencyGovernor } from './concurrency'
import { MastermindStateMachine } from './mastermind'

let repoDir: string

afterAll(() => cleanupTestRepo(repoDir))

describe('artifact registration', () => {
  it('registers run, lead, and worker plan artifacts as the orchestration creates them', async () => {
    repoDir = initTestRepo('artifact-registration')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(2)
    const leadQueues = new Map<string, CommandQueue<any>>()

    const mastermind = new MastermindStateMachine({
      repoRoot: repoDir,
      db,
      governor: gov,
      runId: 'r7',
      baseBranch: 'main',
      leadQueues,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async prompt => {
        if (prompt.includes('Decompose')) {
          return JSON.stringify([{ id: 'main', goal: 'Build landing page', numWorkers: 1, dependsOn: [] }])
        }
        if (prompt.includes('Generate')) {
          return JSON.stringify(['build landing page'])
        }
        return JSON.stringify({ winnerId: 'r7-main-v1', reasoning: 'only worker' })
      },
    })

    const autoApprove = setInterval(() => {
      const q = leadQueues.get('main-lead')
      if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
    }, 10)

    await mastermind.run({ userGoal: 'Build landing page' })
    clearInterval(autoApprove)

    const rows = getSQLite(db)
      .prepare(`
        SELECT entity_id AS entityId, artifact_type AS artifactType, path
        FROM artifacts
        ORDER BY entity_id, artifact_type
      `)
      .all() as Array<{ entityId: string; artifactType: string; path: string }>

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'r7',
        artifactType: 'run_plan',
        path: expect.stringContaining('/.orc/runs/r7/run-plan.md'),
      }),
      expect.objectContaining({
        entityId: 'main-lead',
        artifactType: 'lead_plan',
        path: expect.stringContaining('/.orc/runs/r7/leads/main.md'),
      }),
      expect.objectContaining({
        entityId: 'r7-main-v1',
        artifactType: 'worker_plan',
        path: expect.stringContaining('/.orc/worktrees/r7-main-v1/.orc/worker-plan.md'),
      }),
    ]))
  }, 30_000)
})
