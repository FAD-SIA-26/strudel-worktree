import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb, getSQLite } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { LeadStateMachine } from './lead'
import { CommandQueue } from '../events/commandQueues'
import { laneBranchName } from '../git/branchLayout'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('LeadStateMachine', () => {
  it('persists the lead as running while workers are active', async () => {
    repoDir = initTestRepo('lead-running-state-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()
    const lead = new LeadStateMachine({
      id: 'rhythm-lead', sectionId: 'rhythm', sectionGoal: 'Write rhythm section',
      numWorkers: 2, baseBranch: 'main', laneBranch: laneBranchName('r5', 'rhythm'), runId: 'r5',
      repoRoot: repoDir, db, governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 1200, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'r5-rhythm-v1', reasoning: 'best diff' })
      },
    })

    const runPromise = lead.run()
    const sqlite = getSQLite(db)

    let leadRow: { state: string } | undefined
    let workerRows: Array<{ state: string }> = []
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      leadRow = sqlite.prepare('SELECT state FROM tasks WHERE id=?').get('rhythm-lead') as { state: string } | undefined
      workerRows = sqlite.prepare(`
        SELECT state
        FROM tasks
        WHERE type='worker' AND parent_id=?
        ORDER BY id
      `).all('rhythm-lead') as Array<{ state: string }>
      if (
        lead.state === 'running'
        && workerRows.length === 2
        && workerRows.every(worker => worker.state === 'running')
      ) {
        break
      }
      await sleep(25)
    }

    expect(lead.state).toBe('running')
    expect(workerRows).toHaveLength(2)
    expect(workerRows.every(worker => worker.state === 'running')).toBe(true)
    expect(leadRow).toEqual({ state: 'running' })

    while (lead.state !== 'awaiting_user_approval') {
      await sleep(25)
    }
    q.enqueue({ commandType: 'AcceptProposal' })
    await runPromise
  }, 30_000)

  it('reviewer proposes a winner and lead waits for explicit user approval', async () => {
    repoDir = initTestRepo('lead-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()
    const lead = new LeadStateMachine({
      id: 'rhythm-lead', sectionId: 'rhythm', sectionGoal: 'Write rhythm section',
      numWorkers: 2, baseBranch: 'main', laneBranch: laneBranchName('r1', 'rhythm'), runId: 'r1',
      repoRoot: repoDir, db, governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        // reviewer receives full namespaced workerId (r1-rhythm-v1), must return it
        return JSON.stringify({ winnerId: 'r1-rhythm-v1', reasoning: 'best diff' })
      },
    })

    const runPromise = lead.run()
    await sleep(75)

    expect(lead.state).toBe('awaiting_user_approval')
    const sqlite = getSQLite(db)
    expect(sqlite.prepare(`
      SELECT proposed_winner_worker_id AS proposedWinnerWorkerId, selected_winner_worker_id AS selectedWinnerWorkerId
      FROM merge_candidates
      WHERE id=?
    `).get('rhythm-lead')).toEqual({
      proposedWinnerWorkerId: 'r1-rhythm-v1',
      selectedWinnerWorkerId: null,
    })
    expect(sqlite.prepare('SELECT state FROM tasks WHERE id=?').get('rhythm-lead')).toEqual({
      state: 'awaiting_user_approval',
    })

    let settled = false
    void runPromise.then(() => { settled = true })
    await sleep(25)
    expect(settled).toBe(false)

    q.enqueue({ commandType: 'AcceptProposal' })
    const result = await runPromise
    expect(result.status).toBe('done')
    expect(result.laneBranch).toBe('lane/r1/rhythm')
    expect(sqlite.prepare(`
      SELECT selected_winner_worker_id AS selectedWinnerWorkerId, selection_source AS selectionSource
      FROM merge_candidates
      WHERE id=?
    `).get('rhythm-lead')).toEqual({
      selectedWinnerWorkerId: 'r1-rhythm-v1',
      selectionSource: 'proposal_accept',
    })
    expect(sqlite.prepare(`
      SELECT event_type AS eventType
      FROM event_log
      WHERE entity_id=?
      ORDER BY id ASC
    `).all('rhythm-lead').map((row: any) => row.eventType)).toEqual(expect.arrayContaining([
      'WinnerProposed',
      'WinnerSelected',
      'LaneMergeStarted',
      'LaneMergeCompleted',
      'LeadDone',
    ]))
  }, 30_000)

  it('preserves the exact section goal when PM prompt generation falls back', async () => {
    repoDir = initTestRepo('lead-fallback-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()
    const lead = new LeadStateMachine({
      id: 'main-lead', sectionId: 'main', sectionGoal: 'Create a file with exactly one line: hello',
      numWorkers: 2, baseBranch: 'main', laneBranch: laneBranchName('r2', 'main'), runId: 'r2',
      repoRoot: repoDir, db, governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async () => JSON.stringify({ winnerId: 'r2-main-v1', reasoning: 'fallback shape' }),
    })

    const runPromise = lead.run()
    await sleep(75)
    q.enqueue({ commandType: 'AcceptProposal' })
    await runPromise

    const leadPlan = await fs.readFile(`${repoDir}/.orc/runs/r2/leads/main.md`, 'utf8')
    expect(leadPlan).toContain('Create a file with exactly one line: hello')
    expect(leadPlan).not.toContain('(variation 1)')
    expect(leadPlan).not.toContain('(variation 2)')
  }, 30_000)

  it('user can override the reviewer proposal', async () => {
    repoDir = initTestRepo('lead-user-override-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()
    const lead = new LeadStateMachine({
      id: 'bass-lead',
      sectionId: 'bass',
      sectionGoal: 'build bass section',
      numWorkers: 2,
      baseBranch: 'main',
      laneBranch: laneBranchName('r2', 'bass'),
      runId: 'r2',
      repoRoot: repoDir,
      db,
      governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'r2-bass-v1', reasoning: 'reviewer preferred v1' })
      },
    })

    const runPromise = lead.run()
    await sleep(75)
    q.enqueue({ commandType: 'SelectWinner', workerId: 'r2-bass-v2' })
    const result = await runPromise
    expect(result.status).toBe('done')
    expect(result.laneBranch).toBe('lane/r2/bass')
    expect(result.reasoning).toBe('user override')
    expect(getSQLite(db).prepare(`
      SELECT proposed_winner_worker_id AS proposedWinnerWorkerId,
             selected_winner_worker_id AS selectedWinnerWorkerId,
             selection_source AS selectionSource
      FROM merge_candidates
      WHERE id=?
    `).get('bass-lead')).toEqual({
      proposedWinnerWorkerId: 'r2-bass-v1',
      selectedWinnerWorkerId: 'r2-bass-v2',
      selectionSource: 'user_override',
    })
  })

  it('falls back to the first completed worker when reviewer cannot produce a proposal', async () => {
    repoDir = initTestRepo('lead-reviewer-failure-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()
    const lead = new LeadStateMachine({
      id: 'drums-lead',
      sectionId: 'drums',
      sectionGoal: 'build drums section',
      numWorkers: 1,
      baseBranch: 'main',
      laneBranch: laneBranchName('r3', 'drums'),
      runId: 'r3',
      repoRoot: repoDir,
      db,
      governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1'])
        throw new Error('reviewer unavailable')
      },
    })

    const runPromise = lead.run()
    await sleep(75)

    expect(lead.state).toBe('awaiting_user_approval')
    expect(getSQLite(db).prepare(`
      SELECT proposed_winner_worker_id AS proposedWinnerWorkerId, selected_winner_worker_id AS selectedWinnerWorkerId
      FROM merge_candidates
      WHERE id=?
    `).get('drums-lead')).toEqual({
      proposedWinnerWorkerId: 'r3-drums-v1',
      selectedWinnerWorkerId: null,
    })

    q.enqueue({ commandType: 'AcceptProposal' })
    await expect(runPromise).resolves.toEqual({
      status: 'done',
      laneBranch: 'lane/r3/drums',
      reasoning: 'reviewer unavailable; defaulted to the first completed worker',
    })
  })

  it('ignores accepting a proposal after that worker was aborted during approval', async () => {
    repoDir = initTestRepo('lead-stop-failed-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const q = new CommandQueue<any>()

    const lead = new LeadStateMachine({
      id: 'pad-lead',
      sectionId: 'pad',
      sectionGoal: 'build pad section',
      numWorkers: 2,
      baseBranch: 'main',
      laneBranch: laneBranchName('r4', 'pad'),
      runId: 'r4',
      repoRoot: repoDir,
      db,
      governor: gov,
      commandQueue: q,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'r4-pad-v1', reasoning: 'v1 is best' })
      },
    })

    const runPromise = lead.run()
    await sleep(75)
    q.enqueue({ commandType: 'Abort', targetWorkerId: 'r4-pad-v1' })
    q.enqueue({ commandType: 'AcceptProposal' })
    q.enqueue({ commandType: 'SelectWinner', workerId: 'r4-pad-v2' })

    await expect(runPromise).resolves.toMatchObject({
      status: 'done',
      laneBranch: 'lane/r4/pad',
      reasoning: 'user override',
    })

    const sqlite = getSQLite(db)
    expect(sqlite.prepare('SELECT state FROM tasks WHERE id=?').get('r4-pad-v1')).toEqual({ state: 'cancelled' })
    expect(sqlite.prepare(`
      SELECT selected_winner_worker_id AS selectedWinnerWorkerId, selection_source AS selectionSource
      FROM merge_candidates
      WHERE id=?
    `).get('pad-lead')).toEqual({
      selectedWinnerWorkerId: 'r4-pad-v2',
      selectionSource: 'user_override',
    })
  })
})
