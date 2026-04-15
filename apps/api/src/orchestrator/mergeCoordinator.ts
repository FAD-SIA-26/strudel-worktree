import { getSQLite, type Db } from '../db/client'
import { writeEvent, nextSeq } from '../db/journal'
import type { OrcEvent } from '@orc/types'

interface MergeReq { leadId: string; worktreeId: string; sourceBranch: string; targetBranch: string }
interface MergeCoordinatorConfig {
  db:          Db
  repoRoot:    string
  doMerge:     (target: string, source: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  onComplete?: (mergeId: string, targetBranch: string) => void
  onConflict?: (mergeId: string, files: string[]) => void
  onFailed?:   (mergeId: string, reason: string) => void
}

export class MergeCoordinator {
  private queue: MergeReq[] = []
  private processing = false

  constructor(private readonly cfg: MergeCoordinatorConfig) {}

  enqueue(req: MergeReq): void {
    this.queue.push(req)
    getSQLite(this.cfg.db).prepare(
      'INSERT INTO merge_queue(lead_id,winner_worktree_id,target_branch,status,created_at) VALUES(?,?,?,?,?)'
    ).run(req.leadId, req.worktreeId, req.targetBranch, 'pending', Date.now())
  }

  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return
    this.processing = true
    const req = this.queue.shift()!
    const mergeId = `${req.leadId}-${req.worktreeId}`
    const sqlite = getSQLite(this.cfg.db)
    sqlite.prepare("UPDATE merge_queue SET status='merging' WHERE lead_id=? AND winner_worktree_id=? AND status='pending'")
          .run(req.leadId, req.worktreeId)
    try {
      const r = await this.cfg.doMerge(req.targetBranch, req.sourceBranch)
      if (r.success) {
        sqlite.prepare("UPDATE merge_queue SET status='done', merged_at=? WHERE lead_id=? AND winner_worktree_id=?").run(Date.now(), req.leadId, req.worktreeId)
        writeEvent(this.cfg.db, { entityId: 'mastermind', entityType: 'mastermind', eventType: 'MergeComplete',
          sequence: nextSeq('mastermind'), ts: Date.now(), payload: { mergeId, targetBranch: req.targetBranch } } as OrcEvent, () => {})
        this.cfg.onComplete?.(mergeId, req.targetBranch)
      } else {
        sqlite.prepare("UPDATE merge_queue SET status='conflict', conflict_details=? WHERE lead_id=? AND winner_worktree_id=?")
              .run(JSON.stringify({ files: r.conflictFiles }), req.leadId, req.worktreeId)
        writeEvent(this.cfg.db, { entityId: 'mastermind', entityType: 'mastermind', eventType: 'MergeConflict',
          sequence: nextSeq('mastermind'), ts: Date.now(), payload: { mergeId, conflictFiles: r.conflictFiles } } as OrcEvent, () => {})
        this.cfg.onConflict?.(mergeId, r.conflictFiles)
      }
    } catch (error: unknown) {
      sqlite.prepare("UPDATE merge_queue SET status='failed' WHERE lead_id=? AND winner_worktree_id=?").run(req.leadId, req.worktreeId)
      this.cfg.onFailed?.(mergeId, error instanceof Error ? error.message : String(error))
    } finally {
      this.processing = false
    }
    if (this.queue.length > 0) await this.processNext()
  }

  async drainQueue(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      if (!this.processing) await this.processNext()
      else await new Promise(r => setTimeout(r, 50))
    }
  }
}
