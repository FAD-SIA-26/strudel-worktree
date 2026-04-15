import { getSQLite, type Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import { upsertArtifact, upsertTask } from '../db/queries'
import { createLeadPlan } from '../git/planFiles'
import { laneBranchName, laneWorktreePath } from '../git/branchLayout'
import { addWorktreeForBranch, createBranch, mergeBranch } from '../git/worktree'
import { ConcurrencyGovernor } from './concurrency'
import { WorkerStateMachine } from './worker'
import { CommandQueue } from '../events/commandQueues'
import type { WorkerAgent } from '../agents/types'
import { ContextManager } from './context'
import type { OrcEvent, OrcCommand } from '@orc/types'

export type LeadState = 'idle'|'planning'|'running'|'awaiting_user_approval'|'merging_lane'|'done'|'failed'
export interface LeadResult { status: 'done'|'failed'; laneBranch: string; reasoning: string }
type CompletedWorker = { workerId: string; diff: string; branch: string }

interface LeadConfig {
  id:           string
  sectionId:    string
  sectionGoal:  string
  numWorkers:   number
  baseBranch:   string
  laneBranch?:  string
  runBranch?:   string
  runId:        string
  repoRoot:     string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  llmCall:      (prompt: string) => Promise<string>
  commandQueue: CommandQueue<OrcCommand>
  runPlanPath?: string
  maxRetries?:  number
  domainSkillName?: string
  domainSkillContent?: string
}

export class LeadStateMachine {
  state: LeadState = 'idle'
  private ctx: ContextManager

  constructor(private readonly cfg: LeadConfig) {
    this.ctx = new ContextManager(cfg.repoRoot)
  }

  private get laneBranch(): string {
    return this.cfg.laneBranch ?? laneBranchName(this.cfg.runId, this.cfg.sectionId)
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

  private persistProposal(proposedWinnerWorkerId: string, reasoning: string): void {
    getSQLite(this.cfg.db).prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, NULL, ?, ?, 'proposal_accept')
      ON CONFLICT(id) DO UPDATE SET
        proposed_winner_worker_id=excluded.proposed_winner_worker_id,
        selected_winner_worker_id=NULL,
        target_branch=excluded.target_branch,
        reviewer_reasoning=excluded.reviewer_reasoning,
        selection_source='proposal_accept'
    `).run(this.cfg.id, this.cfg.id, proposedWinnerWorkerId, this.laneBranch, reasoning)
  }

  private persistSelection(selectedWinnerWorkerId: string, selectionSource: 'proposal_accept' | 'user_override'): void {
    getSQLite(this.cfg.db).prepare(`
      UPDATE merge_candidates
      SET selected_winner_worker_id=?, selection_source=?
      WHERE id=?
    `).run(selectedWinnerWorkerId, selectionSource, this.cfg.id)
  }

  private async ensureLaneBranchWorktree(): Promise<void> {
    await createBranch(this.cfg.repoRoot, this.laneBranch).catch(err => {
      if (!err.message?.includes('already exists')) throw err
    })
    await addWorktreeForBranch(
      this.cfg.repoRoot,
      laneWorktreePath(this.cfg.repoRoot, this.cfg.runId, this.cfg.sectionId),
      this.laneBranch,
      { hydrateDependencies: false },
    ).catch(err => {
      if (!err.message?.includes('already exists') && !err.message?.includes('is already checked out')) throw err
    })
  }

  private async waitForUserSelection(
    workers: WorkerStateMachine[],
    doneWorkers: CompletedWorker[],
    proposedWinnerWorkerId: string,
  ): Promise<{ selectedWinnerWorkerId: string; selectionSource: 'proposal_accept' | 'user_override' }> {
    let selectedWinnerWorkerId: string | null = null
    let selectionSource: 'proposal_accept' | 'user_override' = 'proposal_accept'
    const isSelectableWorker = (workerId: string): boolean =>
      doneWorkers.some(worker => worker.workerId === workerId)
      && workers.find(worker => worker.id === workerId)?.state === 'done'

    while (!selectedWinnerWorkerId) {
      const cmd = await this.cfg.commandQueue.dequeue()
      if (cmd.commandType === 'AcceptProposal' && isSelectableWorker(proposedWinnerWorkerId)) {
        selectedWinnerWorkerId = proposedWinnerWorkerId
        selectionSource = 'proposal_accept'
      } else if (cmd.commandType === 'SelectWinner' && isSelectableWorker(cmd.workerId)) {
        selectedWinnerWorkerId = cmd.workerId
        selectionSource = cmd.workerId === proposedWinnerWorkerId ? 'proposal_accept' : 'user_override'
      } else if (cmd.commandType === 'Abort') {
        const worker = workers.find(candidate => candidate.id === cmd.targetWorkerId)
        if (worker) await worker.abort()
      }
    }

    return { selectedWinnerWorkerId, selectionSource }
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
    if (leadPlanPath) {
      upsertArtifact(this.cfg.db, this.cfg.id, 'lead_plan', leadPlanPath)
    }

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
      domainSkillName: this.cfg.domainSkillName,
      domainSkillContent: this.cfg.domainSkillContent,
    }))

    const workerPromises = workers.map((w, i) =>
      w.run({ id: w.id, prompt: workerPrompts[i], maxRetries: this.cfg.maxRetries ?? 1, errorHistory: [] })
    )

    const drainCommandsOnce = async (): Promise<void> => {
      while (this.cfg.commandQueue.size > 0) {
        const cmd = await this.cfg.commandQueue.dequeue()
        if (cmd.commandType !== 'Abort') continue
        const worker = workers.find(candidate => candidate.id === cmd.targetWorkerId)
        if (worker) await worker.abort()
      }
    }
    const commandPollInterval = setInterval(() => {
      void drainCommandsOnce()
    }, 500)

    const results = await Promise.allSettled(workerPromises)
    clearInterval(commandPollInterval)
    await drainCommandsOnce()

    const done = results
      .map((r, i) => ({ r, id: workers[i].id }))
      .filter(x => x.r.status === 'fulfilled' && (x.r as PromiseFulfilledResult<any>).value.status === 'done')
      .map(x => ({
        workerId: x.id,
        diff: (x.r as PromiseFulfilledResult<any>).value.diff ?? '',
        branch: (x.r as PromiseFulfilledResult<any>).value.branch,
      }))

    if (done.length === 0) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: 'all workers failed' })
      return { status: 'failed', laneBranch: '', reasoning: 'all workers failed' }
    }

    const reviewPrompt = this.ctx.buildReviewerPrompt(this.cfg.sectionGoal, done)
    let proposedWinnerWorkerId: string
    let reasoning: string
    try {
      const raw = await this.cfg.llmCall(reviewPrompt)
      const rev = JSON.parse(raw)
      if (typeof rev.winnerId !== 'string') throw new Error('reviewer returned no winnerId')
      if (!done.some(worker => worker.workerId === rev.winnerId)) {
        throw new Error(`reviewer proposed unknown winner ${rev.winnerId}`)
      }
      proposedWinnerWorkerId = rev.winnerId
      reasoning = typeof rev.reasoning === 'string' && rev.reasoning.trim().length > 0
        ? rev.reasoning
        : 'reviewer proposal'
    } catch (error: unknown) {
      this.state = 'failed'
      this.emit('LeadFailed', {
        reason: error instanceof Error ? error.message : 'reviewer failed',
      })
      return { status: 'failed', laneBranch: '', reasoning: 'reviewer failed' }
    }

    this.state = 'awaiting_user_approval'
    this.persistProposal(proposedWinnerWorkerId, reasoning)
    this.emit('WinnerProposed', { proposedWinnerId: proposedWinnerWorkerId, reasoning })

    const { selectedWinnerWorkerId, selectionSource } = await this.waitForUserSelection(
      workers,
      done,
      proposedWinnerWorkerId,
    )
    this.persistSelection(selectedWinnerWorkerId, selectionSource)
    this.state = 'merging_lane'
    this.emit('WinnerSelected', { selectedWinnerId: selectedWinnerWorkerId, selectionSource })

    const winner = done.find(worker => worker.workerId === selectedWinnerWorkerId)
    if (!winner) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: `selected worker ${selectedWinnerWorkerId} is not complete` })
      return { status: 'failed', laneBranch: '', reasoning: 'selected worker not complete' }
    }

    await this.ensureLaneBranchWorktree()
    this.emit('LaneMergeStarted', { laneBranch: this.laneBranch, selectedWinnerWorkerId })
    const merged = await mergeBranch(
      laneWorktreePath(this.cfg.repoRoot, this.cfg.runId, this.cfg.sectionId),
      winner.branch,
    )
    if (!merged.success) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: `lane merge failed: ${merged.conflictFiles.join(', ')}` })
      return { status: 'failed', laneBranch: '', reasoning: 'lane merge failed' }
    }
    this.emit('LaneMergeCompleted', { laneBranch: this.laneBranch, selectedWinnerWorkerId })

    this.state = 'done'
    this.emit('LeadDone', { branch: this.laneBranch, sectionId: this.cfg.sectionId })
    return {
      status: 'done',
      laneBranch: this.laneBranch,
      reasoning: selectionSource === 'user_override' ? 'user override' : reasoning,
    }
  }
}
