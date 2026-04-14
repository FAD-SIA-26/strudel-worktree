import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { WorkerAgent, WorkerTask, WorkerContext, WorkerResult } from './types'
import { eventBus } from '../events/eventBus'
import { writeDoneMarker } from '../git/reconcile'
import { getWorktreeDiff } from '../git/worktree'
import { nextSeq } from '../db/journal'

export class CodexCLIAdapter implements WorkerAgent {
  private proc: ReturnType<typeof spawn> | null = null

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    const sessionPath = path.join(ctx.worktreePath, '.orc', '.orc-session.jsonl')
    const session = await fs.open(sessionPath, 'a')
    const prompt = [task.prompt, task.strategy ? `\nApproach: ${task.strategy}` : '',
      task.errorHistory.length ? `\nPrior failures:\n${task.errorHistory.join('\n')}` : '',
      `\nYour plan: ${ctx.planPath}`, `\nLead plan: ${ctx.leadPlanPath}`, `\nRun plan: ${ctx.runPlanPath}`,
    ].join('')

    return new Promise<WorkerResult>(resolve => {
      this.proc = spawn('codex', ['--prompt', prompt, '--json'], { cwd: ctx.worktreePath, env: { ...process.env } })

      this.proc.stdout?.on('data', async (chunk: Buffer) => {
        const line = chunk.toString()
        await session.write(JSON.stringify({ ts: Date.now(), output: line }) + '\n')
        eventBus.publish({ entityId: ctx.entityId, entityType: 'worker', eventType: 'WorkerProgress',
          sequence: nextSeq(ctx.entityId), ts: Date.now(), payload: { output: line, ts: Date.now() } } as any)
      })

      const finish = async (code: number | null) => {
        await session.close()
        const status = code === 0 ? 'done' as const : 'failed' as const
        await writeDoneMarker(ctx.worktreePath, { status, exitCode: code ?? 1, ts: Date.now() })
        if (status === 'done') {
          resolve({ status: 'done', branch: ctx.branch, diff: await getWorktreeDiff(ctx.worktreePath, ctx.baseBranch), retryable: false })
        } else {
          resolve({ status: 'failed', branch: ctx.branch, error: `exit code ${code}`, retryable: true })
        }
      }
      this.proc.on('close', finish)
      this.proc.on('error', async err => { await session.close(); resolve({ status: 'failed', branch: ctx.branch, error: err.message, retryable: true }) })
    })
  }

  async abort(): Promise<void> { this.proc?.kill('SIGTERM') }
}
