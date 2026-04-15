import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { getSQLite, type Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import { upsertArtifact, upsertTask } from '../db/queries'
import { createRunPlan } from '../git/planFiles'
import { ConcurrencyGovernor, configureGovernor } from './concurrency'
import { LeadStateMachine } from './lead'
import { MergeCoordinator } from './mergeCoordinator'
import { mergeBranch, createBranch, addWorktreeForBranch } from '../git/worktree'
import { CommandQueue } from '../events/commandQueues'
import { ContextManager } from './context'
import type { WorkerAgent } from '../agents/types'
import type { OrcEvent, OrcCommand } from '@orc/types'
import { getOrcPaths } from '../runtime/paths'
import { loadTemplate, renderPromptHint } from './templateLoader'

interface SectionPlan { id: string; goal: string; numWorkers: number; dependsOn: string[] }

interface MastermindConfig {
  repoRoot:    string
  db:          Db
  governor:    ConcurrencyGovernor
  runId:       string
  baseBranch:  string
  agentFactory: () => WorkerAgent
  llmCall:     (prompt: string) => Promise<string>
  leadQueues?: Map<string, CommandQueue<OrcCommand>>
  doMerge?:    (targetWorktreePath: string, sourceBranch: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  templatePath?: string
  maxConcurrentWorkers?: number
}

export type MastermindState =
  | 'idle'
  | 'planning'
  | 'delegating'
  | 'monitoring'
  | 'merging_lanes'
  | 'review_ready'
  | 'failed'

export class MastermindStateMachine {
  state: MastermindState = 'idle'
  private ctx: ContextManager

  constructor(private readonly cfg: MastermindConfig) {
    this.ctx = new ContextManager(cfg.repoRoot)
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: 'mastermind', entityType: 'mastermind',
      eventType: eventType as any, sequence: nextSeq('mastermind'), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, 'mastermind', 'mastermind', null, this.state)
    })
  }

  async run(opts: { userGoal: string }): Promise<{ status: 'review_ready'|'failed'; runBranch: string }> {
    if (this.cfg.maxConcurrentWorkers) configureGovernor(this.cfg.maxConcurrentWorkers)

    this.state = 'planning'
    this.emit('CommandIssued', { from: 'user', to: 'mastermind', commandType: 'Run', commandPayload: { goal: opts.userGoal } })

    const runDir = path.join(getOrcPaths(this.cfg.repoRoot).runsDir, this.cfg.runId)
    await fs.mkdir(path.join(runDir, 'leads'), { recursive: true })

    let sections: SectionPlan[]
    try {
      if (this.cfg.templatePath) {
        const template = await loadTemplate(this.cfg.templatePath)
        sections = template.sections.map(section => ({
          id: section.id,
          goal: renderPromptHint(section.prompt_hint, template.params, {}),
          numWorkers: section.workers,
          dependsOn: section.depends_on,
        }))
      } else {
        const prompt = await this.ctx.buildMastermindPrompt(opts.userGoal, this.cfg.runId)
        const raw = await this.cfg.llmCall(prompt)
        const parsed = JSON.parse(raw)
        sections = Array.isArray(parsed) ? parsed.map(s => ({ ...s, dependsOn: s.dependsOn ?? s.depends_on ?? [] })) : [{ id: 'main', goal: opts.userGoal, numWorkers: 2, dependsOn: [] }]
      }
    } catch {
      sections = [{ id: 'main', goal: opts.userGoal, numWorkers: 2, dependsOn: [] }]
    }

    const runPlanPath = await createRunPlan(this.cfg.repoRoot, this.cfg.runId, {
      userGoal: opts.userGoal, sections: sections.map(s => s.id),
    }).catch(() => '')
    if (runPlanPath) {
      upsertArtifact(this.cfg.db, this.cfg.runId, 'run_plan', runPlanPath)
    }

    const sqlite = getSQLite(this.cfg.db)
    for (const section of sections) {
      for (const dep of section.dependsOn) {
        sqlite.prepare(`
          INSERT INTO task_edges(parent_id, child_id, edge_type)
          VALUES(?, ?, ?)
        `).run(`${dep}-lead`, `${section.id}-lead`, 'depends_on')
      }
    }

    const runBranch = `run/${this.cfg.runId}`
    // Create the run branch without switching the main working tree
    await createBranch(this.cfg.repoRoot, runBranch).catch(err => {
      if (!err.message?.includes('already exists')) throw err
    })

    // Create a dedicated worktree for the run branch — all merges happen there,
    // never touching the main working directory.
    // Branch already exists (created above), so use addWorktreeForBranch (no -b flag)
    const runWtPath = path.join(getOrcPaths(this.cfg.repoRoot).worktreesDir, `run-${this.cfg.runId}`)
    await addWorktreeForBranch(this.cfg.repoRoot, runWtPath, runBranch, { hydrateDependencies: false }).catch(err => {
      if (!err.message?.includes('already exists') && !err.message?.includes('is already checked out')) throw err
    })

    this.emit('PlanReady', { sections: sections.map(s => s.id), runId: this.cfg.runId })
    this.state = 'delegating'

    const sectionResults = new Map<string, { status: 'done'|'failed'; laneBranch: string }>()
    const resolved = new Set<string>()
    const failed = new Set<string>()
    const remaining = [...sections]

    while (remaining.length > 0) {
      const batch = remaining.filter(s => s.dependsOn.every(d => resolved.has(d)))

      if (batch.length === 0) {
        const blockedByFailure = remaining.filter(s => s.dependsOn.some(d => failed.has(d)))
        if (blockedByFailure.length > 0) {
          for (const s of blockedByFailure) {
            sectionResults.set(s.id, { status: 'failed', laneBranch: '' })
            failed.add(s.id)
            remaining.splice(remaining.indexOf(s), 1)
          }
          continue
        }
        this.state = 'failed'
        this.emit('OrchestrationFailed', { reason: 'circular or unresolvable section dependencies' })
        return { status: 'failed', runBranch }
      }

      batch.forEach(s => remaining.splice(remaining.indexOf(s), 1))

      const batchResults = await Promise.allSettled(
        batch.map(section => {
          this.emit('LeadDelegated', { leadId: `${section.id}-lead`, sectionId: section.id })
          const leadId = `${section.id}-lead`
          const leadCommandQueue = new CommandQueue<OrcCommand>()
          this.cfg.leadQueues?.set(leadId, leadCommandQueue)
          const lead = new LeadStateMachine({
            id: leadId, sectionId: section.id, sectionGoal: section.goal,
            numWorkers: section.numWorkers, baseBranch: this.cfg.baseBranch,
            runBranch: `run/${this.cfg.runId}`, runId: this.cfg.runId,
            repoRoot: this.cfg.repoRoot, db: this.cfg.db, governor: this.cfg.governor,
            agentFactory: this.cfg.agentFactory, llmCall: this.cfg.llmCall,
            commandQueue: leadCommandQueue, runPlanPath,
          })
          return lead.run()
            .then(result => ({ section, result }))
            .finally(() => {
              this.cfg.leadQueues?.delete(leadId)
            })
        })
      )

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const { section, result } = r.value
          sectionResults.set(section.id, { status: result.status, laneBranch: result.laneBranch })
          if (result.status === 'done') { resolved.add(section.id) }
          else { failed.add(section.id) }
        } else {
          const section = batch[batchResults.indexOf(r)]
          if (section) failed.add(section.id)
        }
      }
    }

    this.state = 'monitoring'
    const failures = [...sectionResults.values()].filter(r => r.status === 'failed')
    if (failures.length > 0) {
      this.state = 'failed'
      this.emit('OrchestrationFailed', { reason: `${failures.length} section(s) failed` })
      return { status: 'failed', runBranch }
    }

    this.state = 'merging_lanes'
    // Merges happen in the dedicated run worktree — the main worktree is never affected
    const doMerge = this.cfg.doMerge ?? ((_target, source) => mergeBranch(runWtPath, source))
    const mergeConflicts: string[] = []
    const mergeFailures: string[] = []
    const mc = new MergeCoordinator({
      db: this.cfg.db, repoRoot: this.cfg.repoRoot, doMerge,
      onConflict: (id)         => { mergeConflicts.push(id) },
      onFailed:   (id, reason) => { mergeFailures.push(reason); this.emit('OrchestrationFailed', { reason: `merge failed: ${reason}` }) },
    })

    for (const [sectionId, result] of sectionResults) {
      if (result.status === 'done' && result.laneBranch) {
        mc.enqueue({
          leadId: `${sectionId}-lead`,
          worktreeId: sectionId,
          sourceBranch: result.laneBranch,
          targetBranch: `run/${this.cfg.runId}`,
        })
      }
    }

    await mc.drainQueue()

    if (mergeConflicts.length > 0 || mergeFailures.length > 0) {
      this.state = 'failed'
      const reason = mergeConflicts.length > 0
        ? `${mergeConflicts.length} merge conflict(s) unresolved`
        : `${mergeFailures.length} merge(s) failed: ${mergeFailures[0]}`
      this.emit('OrchestrationFailed', { reason })
      return { status: 'failed', runBranch }
    }

    this.state = 'review_ready'
    this.emit('OrchestrationComplete', { runBranch })
    return { status: 'review_ready', runBranch }
  }
}
