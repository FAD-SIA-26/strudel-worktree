import * as path from 'node:path'
import type { WorkerTask, WorkerAgent, WorkerHeartbeat } from '../agents/types'
import { getSQLite, type Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import { upsertArtifact, upsertTask, upsertWorktree } from '../db/queries'
import { commitWorktreeChanges, createWorktree } from '../git/worktree'
import { createWorkerPlan } from '../git/planFiles'
import { ConcurrencyGovernor } from './concurrency'
import type { OrcEvent } from '@orc/types'
import { getOrcPaths } from '../runtime/paths'

export type WorkerState = 'queued'|'spawning'|'running'|'stopping'|'stop_failed'|'stalled'|'zombie'|'done'|'failed'|'retrying'|'cancelled'

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
  domainSkillName?: string
  domainSkillContent?: string
}

export class WorkerStateMachine {
  state: WorkerState = 'queued'
  readonly id: string
  readonly branch: string
  private agent: WorkerAgent | null = null
  private slotHeld = false
  private lastHeartbeatEventAt = 0

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

  private recordHeartbeat(heartbeat: WorkerHeartbeat): void {
    const now = heartbeat.ts ?? Date.now()
    const sqlite = getSQLite(this.cfg.db)
    sqlite.prepare(`
      INSERT INTO runs(id,entity_id,adapter_type,pid,started_at,last_seen_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        adapter_type=excluded.adapter_type,
        pid=COALESCE(excluded.pid, runs.pid),
        last_seen_at=excluded.last_seen_at
    `).run(this.cfg.id, this.cfg.id, 'worker', heartbeat.pid ?? null, now, now)
    sqlite.prepare("UPDATE tasks SET state='running', updated_at=? WHERE id=?").run(now, this.cfg.id)

    const output = heartbeat.output?.trim()
    if (!output) return
    if (now - this.lastHeartbeatEventAt < 5_000) return
    this.lastHeartbeatEventAt = now
    this.emit('WorkerProgress', { output: output.slice(0, 500), ts: now })
  }

  async run(task: WorkerTask): Promise<{ status: 'done'|'failed'; branch: string; diff?: string; error?: string }> {
    this.state = 'queued'
    this.emit('CommandIssued', { from: this.cfg.leadId, to: this.cfg.id, commandType: 'SpawnWorker', commandPayload: {} })

    await this.cfg.governor.acquire()
    this.slotHeld = true
    this.state = 'spawning'
    this.emit('WorkerProgress', { output: 'creating worktree', ts: Date.now() })

    const wtPath = path.join(getOrcPaths(this.cfg.repoRoot).worktreesDir, this.cfg.id)
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
    upsertArtifact(this.cfg.db, this.cfg.id, 'worker_plan', planPath)

    this.state = 'running'
    this.recordHeartbeat({ ts: Date.now(), output: 'worker initialized' })
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
      domainSkillName: this.cfg.domainSkillName,
      domainSkillContent: this.cfg.domainSkillContent,
      onHeartbeat:  heartbeat => this.recordHeartbeat(heartbeat),
      onSessionLogOpened: sessionPath => upsertArtifact(this.cfg.db, this.cfg.id, 'session_log', sessionPath),
    })

    if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }

    if (result.status === 'done') {
      try {
        await commitWorktreeChanges(
          wtPath,
          `orc: complete ${this.cfg.id}`,
        )
      } catch (err: any) {
        this.state = 'failed'
        this.emit('WorkerFailed', { error: err.message ?? 'failed to commit worker changes', retryable: true })
        return { status: 'failed', branch: result.branch, error: err.message ?? 'failed to commit worker changes' }
      }
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
    this.state = 'stopping'
    this.emit('WorkerStopping', { reason: 'lead selected another winner' })
    try {
      await this.agent?.abort()
      this.state = 'cancelled'
      this.emit('WorkerFailed', { error: 'aborted', retryable: false })
    } catch (error: unknown) {
      this.state = 'stop_failed'
      this.emit('WorkerStopFailed', {
        reason: error instanceof Error ? error.message : 'abort failed',
      })
    }
  }
}
