import * as path from 'node:path'
import { getSQLite, type Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import { upsertTask } from '../db/queries'
import { createLeadPlan } from '../git/planFiles'
import { ConcurrencyGovernor } from './concurrency'
import { WorkerStateMachine } from './worker'
import { CommandQueue } from '../events/commandQueues'
import type { WorkerAgent } from '../agents/types'
import { ContextManager } from './context'
import type { OrcEvent, OrcCommand } from '@orc/types'

export type LeadState = 'idle'|'planning'|'running'|'reviewing'|'merging'|'done'|'failed'
export interface LeadResult { status: 'done'|'failed'; winnerBranch: string; reasoning: string }

interface LeadConfig {
  id:           string
  sectionId:    string
  sectionGoal:  string
  numWorkers:   number
  baseBranch:   string
  runBranch:    string
  runId:        string
  repoRoot:     string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  llmCall:      (prompt: string) => Promise<string>
  commandQueue: CommandQueue<OrcCommand>
  runPlanPath?: string
  maxRetries?:  number
}

export class LeadStateMachine {
  state: LeadState = 'idle'
  private ctx: ContextManager

  constructor(private readonly cfg: LeadConfig) {
    this.ctx = new ContextManager(cfg.repoRoot)
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: this.cfg.id, entityType: 'lead',
      eventType: eventType as any, sequence: nextSeq(this.cfg.id), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, this.cfg.id, 'lead', 'mastermind', this.state)
    })
  }

  async run(): Promise<LeadResult> {
    this.state = 'planning'
    this.emit('CommandIssued', { from: 'mastermind', to: this.cfg.id, commandType: 'SpawnLead', commandPayload: {} })

    const pmPrompt = this.ctx.buildPMPrompt(this.cfg.sectionId, this.cfg.sectionGoal, this.cfg.numWorkers, [])
    let workerPrompts: string[]
    try {
      const raw = await this.cfg.llmCall(pmPrompt)
      const parsed = JSON.parse(raw)
      workerPrompts = Array.isArray(parsed) ? parsed : Array.from({ length: this.cfg.numWorkers }, () => this.cfg.sectionGoal)
    } catch {
      workerPrompts = Array.from({ length: this.cfg.numWorkers }, () => this.cfg.sectionGoal)
    }

    const leadPlanPath = await createLeadPlan(this.cfg.repoRoot, this.cfg.runId, {
      sectionId:      this.cfg.sectionId,
      sectionGoal:    this.cfg.sectionGoal,
      workerVariants: workerPrompts,
    }).catch(() => '')

    this.emit('LeadPlanReady', { workerPrompts })
    this.state = 'running'

    // Namespace worker ids and branches by runId to prevent collisions across runs
    const workers = workerPrompts.map((prompt, i) => new WorkerStateMachine({
      id:           `${this.cfg.runId}-${this.cfg.sectionId}-v${i + 1}`,
      leadId:       this.cfg.id,
      sectionId:    this.cfg.sectionId,
      branch:       `feat/${this.cfg.runId}-${this.cfg.sectionId}-v${i + 1}`,
      baseBranch:   this.cfg.baseBranch,
      repoRoot:     this.cfg.repoRoot,
      runId:        this.cfg.runId,
      db:           this.cfg.db,
      governor:     this.cfg.governor,
      agentFactory: this.cfg.agentFactory,
      leadPlanPath,
      runPlanPath:  this.cfg.runPlanPath,
    }))

    const workerPromises = workers.map((w, i) =>
      w.run({ id: w.id, prompt: workerPrompts[i], maxRetries: this.cfg.maxRetries ?? 1, errorHistory: [] })
    )

    let forceWinnerId: string | undefined
    const drainCommandsOnce = async (): Promise<void> => {
      while (this.cfg.commandQueue.size > 0) {
        const cmd = await this.cfg.commandQueue.dequeue()
        if (cmd.commandType === 'ForceApprove') {
          forceWinnerId = cmd.winnerId
        } else if (cmd.commandType === 'Abort') {
          const w = workers.find(x => x.id === cmd.targetWorkerId)
          if (w) await w.abort()
        }
      }
    }
    const commandPollInterval = setInterval(() => {
      void drainCommandsOnce()
    }, 500)

    const results = await Promise.allSettled(workerPromises)
    clearInterval(commandPollInterval)
    await drainCommandsOnce()

    const done = results
      .map((r, i) => ({ r, id: workers[i].id, branch: workers[i].branch }))
      .filter(x => x.r.status === 'fulfilled' && (x.r as PromiseFulfilledResult<any>).value.status === 'done')
      .map(x => ({ workerId: x.id, diff: (x.r as PromiseFulfilledResult<any>).value.diff ?? '', branch: x.branch }))

    if (done.length === 0) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: 'all workers failed' })
      return { status: 'failed', winnerBranch: '', reasoning: 'all workers failed' }
    }

    this.state = 'reviewing'
    let winnerId = done[0].workerId
    let reasoning = 'first available'
    if (forceWinnerId && done.some(d => d.workerId === forceWinnerId)) {
      winnerId = forceWinnerId
      reasoning = 'force-approved by user'
    } else {
      const reviewPrompt = this.ctx.buildReviewerPrompt(this.cfg.sectionGoal, done)
      try {
        const raw = await this.cfg.llmCall(reviewPrompt)
        const rev = JSON.parse(raw)
        if (rev.winnerId) { winnerId = rev.winnerId; reasoning = rev.reasoning }
      } catch { }
    }

    const winner = done.find(d => d.workerId === winnerId) ?? done[0]
    await Promise.all(
      workers
        .filter(w => w.id !== winner.workerId)
        .map(w => w.abort().catch(() => undefined))
    )
    getSQLite(this.cfg.db).prepare(`
      INSERT INTO merge_candidates(id, lead_id, winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        winner_worker_id=excluded.winner_worker_id,
        reviewer_reasoning=excluded.reviewer_reasoning,
        selection_source=excluded.selection_source
    `).run(
      this.cfg.id,
      this.cfg.id,
      winner.workerId,
      this.cfg.runBranch,
      reasoning,
      forceWinnerId ? 'user' : 'reviewer',
    )
    this.emit('ReviewComplete', { winnerId: winner.workerId, reasoning })
    this.emit('MergeRequested', { leadId: this.cfg.id, worktreeId: winner.workerId, targetBranch: this.cfg.runBranch })
    this.state = 'done'
    this.emit('LeadDone', { branch: winner.branch, sectionId: this.cfg.sectionId })
    return { status: 'done', winnerBranch: winner.branch, reasoning }
  }
}
