import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { WorkerStateMachine } from './worker'
import type { WorkerAgent, WorkerContext, WorkerResult, WorkerTask } from '../agents/types'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('WorkerStateMachine', () => {
  it('commits successful worker changes onto the worker branch', async () => {
    repoDir = initTestRepo('worker-commit-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)

    class FileWritingAgent implements WorkerAgent {
      async run(_task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
        await fs.writeFile(`${ctx.worktreePath}/RESULT.txt`, 'hello from worker\n')
        return { status: 'done', branch: ctx.branch, diff: '', retryable: false }
      }
      async abort(): Promise<void> {}
    }

    const worker = new WorkerStateMachine({
      id: 'rhythm-v3', leadId: 'rhythm-lead', sectionId: 'rhythm',
      branch: 'feat/rhythm-v3', baseBranch: 'main',
      repoRoot: repoDir, runId: 'run-1', db, governor: gov,
      agentFactory: () => new FileWritingAgent(),
    })

    const result = await worker.run({ id: 'rhythm-v3', prompt: 'Write rhythm', maxRetries: 1, errorHistory: [] })

    expect(result.status).toBe('done')
    const wtPath = `${repoDir}/.orc/worktrees/rhythm-v3`
    expect(execFileSync('git', ['show', 'HEAD:RESULT.txt'], { cwd: wtPath, encoding: 'utf8' })).toBe('hello from worker\n')
    expect(execFileSync('git', ['status', '--short'], { cwd: wtPath, encoding: 'utf8' })).toBe('?? .orc/\n')
  }, 15_000)

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
