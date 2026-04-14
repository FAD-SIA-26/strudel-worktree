import * as path from 'node:path'
import type { WorkerTask, WorkerAgent } from '../agents/types'
import type { Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import { upsertTask, upsertWorktree } from '../db/queries'
import { createWorktree } from '../git/worktree'
import { createWorkerPlan } from '../git/planFiles'
import { ConcurrencyGovernor } from './concurrency'
import type { OrcEvent } from '@orc/types'

export type WorkerState = 'queued'|'spawning'|'running'|'stalled'|'zombie'|'done'|'failed'|'retrying'|'cancelled'

interface WorkerConfig {
  id:           string
  leadId:       string
  sectionId:    string
  branch:       string
  baseBranch:   string
  repoRoot:     string
  runId:        string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  leadPlanPath?: string
  runPlanPath?:  string
}

export class WorkerStateMachine {
  state: WorkerState = 'queued'
  readonly id: string
  readonly branch: string
  private agent: WorkerAgent | null = null
  private slotHeld = false

  constructor(private readonly cfg: WorkerConfig) {
    this.id     = cfg.id
    this.branch = cfg.branch
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: this.cfg.id, entityType: 'worker',
      eventType: eventType as any, sequence: nextSeq(this.cfg.id), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, this.cfg.id, 'worker', this.cfg.leadId, this.state)
    })
  }

  async run(task: WorkerTask): Promise<{ status: 'done'|'failed'; branch: string; diff?: string; error?: string }> {
    this.state = 'queued'
    this.emit('CommandIssued', { from: this.cfg.leadId, to: this.cfg.id, commandType: 'SpawnWorker', commandPayload: {} })

    await this.cfg.governor.acquire()
    this.slotHeld = true
    this.state = 'spawning'
    this.emit('WorkerProgress', { output: 'creating worktree', ts: Date.now() })

    const wtPath = path.join(this.cfg.repoRoot, '.worktrees', this.cfg.id)
    try {
      await createWorktree(this.cfg.repoRoot, wtPath, this.cfg.branch)
    } catch (err: any) {
      if (!err.message?.includes('already exists')) throw err
    }

    upsertWorktree(this.cfg.db, this.cfg.id, this.cfg.id, wtPath, this.cfg.branch, this.cfg.baseBranch)

    const planPath = await createWorkerPlan(wtPath, {
      workerId:   this.cfg.id,
      objective:  task.prompt,
      strategy:   task.strategy ?? 'default',
    })

    this.state = 'running'
    this.emit('WorkerProgress', { output: 'agent started', ts: Date.now() })

    this.agent = this.cfg.agentFactory()
    const result = await this.agent.run(task, {
      worktreePath: wtPath,
      branch:       this.cfg.branch,
      baseBranch:   this.cfg.baseBranch,
      entityId:     this.cfg.id,
      planPath,
      leadPlanPath: this.cfg.leadPlanPath ?? '',
      runPlanPath:  this.cfg.runPlanPath  ?? '',
    })

    if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }

    if (result.status === 'done') {
      this.state = 'done'
      this.emit('WorkerDone', { branch: result.branch, diff: result.diff ?? '' })
    } else {
      this.state = 'failed'
      this.emit('WorkerFailed', { error: result.error ?? 'unknown', retryable: result.retryable })
    }
    return result
  }

  async abort(): Promise<void> {
    if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }
    this.state = 'cancelled'
    await this.agent?.abort()
    this.emit('WorkerFailed', { error: 'aborted', retryable: false })
  }
}
