import { Router } from 'express'
import type { AppDeps } from './app'
import { getAllTasks, getWorktrees, getPreviews, getMergeCandidates, getTaskEdges } from '../db/queries'
import { launchPreview, launchRunPreview, stopPreview } from '../orchestrator/preview'

export function createRoutes({ db, leadQueues }: AppDeps): Router {
  const r = Router()

  r.get('/orchestration', (_req, res) => {
    const tasks = getAllTasks(db)
    const worktrees = getWorktrees(db)
    const previews = getPreviews(db)
    const mergeCandidates = getMergeCandidates(db)
    const taskEdges = getTaskEdges(db)
    const mastermindState = tasks.find(t => t.id === 'mastermind')?.state ?? 'idle'
    const runWorktree = worktrees.find(wt => wt.branch?.startsWith('run/'))
    const runId = runWorktree?.branch?.replace('run/', '') ?? 'current'
    const finalPreview = previews.find(p => p.workerId === `run:${runId}:final` && p.mode === 'solo')
    const mergeCandidateByLead = new Map(mergeCandidates.map(candidate => [candidate.leadId, candidate]))
    const worktreeByWorker = new Map(worktrees.map(worktree => [worktree.workerId, worktree]))
    const previewsByWorker = new Map<string, Array<{ mode: 'solo' | 'contextual'; previewUrl: string }>>()
    for (const preview of previews) {
      const entries = previewsByWorker.get(preview.workerId) ?? []
      entries.push({ mode: preview.mode, previewUrl: preview.previewUrl })
      previewsByWorker.set(preview.workerId, entries)
    }

    const sections = tasks.filter(t => t.type === 'lead').map(lead => {
      const candidate = mergeCandidateByLead.get(lead.id)
      const selectedWinnerWorkerId = candidate?.selectedWinnerWorkerId ?? null
      const upstreamLeadIds = taskEdges
        .filter(edge => edge.edgeType === 'depends_on' && edge.childId === lead.id)
        .map(edge => edge.parentId)

      return {
        id: lead.id.replace('-lead', ''),
        state: lead.state,
        proposedWinnerWorkerId: candidate?.proposedWinnerWorkerId ?? null,
        selectedWinnerWorkerId,
        selectionStatus:
          lead.state === 'awaiting_user_approval' ? 'waiting_for_user'
          : selectedWinnerWorkerId && lead.state === 'done' ? 'lane_merged'
          : selectedWinnerWorkerId ? 'selected'
          : 'waiting_for_review',
        awaitingUserApproval: lead.state === 'awaiting_user_approval',
        workers: tasks.filter(t => t.type === 'worker' && t.parentId === lead.id).map(worker => {
          const wt = worktreeByWorker.get(worker.id)
          const previewArtifacts = previewsByWorker.get(worker.id) ?? []

          return {
            id: worker.id,
            state: worker.state,
            branch: wt?.branch,
            isProposed: candidate?.proposedWinnerWorkerId === worker.id,
            isSelected: selectedWinnerWorkerId === worker.id,
            canBeSelected: worker.state === 'done' && selectedWinnerWorkerId !== worker.id,
            isStopping: worker.state === 'stopping',
            contextAvailable: upstreamLeadIds.length > 0 && upstreamLeadIds.every(depLeadId =>
              Boolean(mergeCandidateByLead.get(depLeadId)?.selectedWinnerWorkerId)
            ),
            previewArtifacts,
          }
        }),
      }
    })

    const reviewReady = mastermindState === 'review_ready'
    res.json({
      runId,
      mastermindState,
      reviewReady,
      fullSongPreviewAvailable: reviewReady,
      fullSongPreviewUrl: finalPreview?.previewUrl,
      sections,
    })
  })

  r.get('/events', (_req, res) => {
    const sqlite = (db as any).session.client
    res.json({ events: sqlite.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 100').all() })
  })

  r.post('/approve', (req, res) => {
    const { workerId, leadId } = req.body as { workerId?: string; leadId?: string }
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return }
    const q = leadQueues.get(leadId)
    if (!q) { res.status(404).json({ error: `lead queue not found for ${leadId}` }); return }
    if (workerId) q.enqueue({ commandType: 'SelectWinner', workerId })
    else q.enqueue({ commandType: 'AcceptProposal' })
    res.status(202).json({ ok: true })
  })

  r.post('/drop', (req, res) => {
    const { workerId, leadId } = req.body
    if (!workerId || !leadId) { res.status(400).json({ error: 'workerId and leadId required' }); return }
    const q = leadQueues.get(leadId)
    if (q) { q.enqueue({ commandType: 'Abort', targetWorkerId: workerId }) }
    res.status(202).json({ ok: true })
  })

  r.post('/preview/launch', async (req, res) => {
    const { workerId, mode } = req.body as { workerId?: string; mode?: 'solo' | 'contextual' }
    if (!workerId || !mode) { res.status(400).json({ error: 'workerId and mode required' }); return }
    const wts = getWorktrees(db)
    const wt = wts.find(x => x.workerId === workerId)
    if (!wt) { res.status(404).json({ error: `worktree not found for worker ${workerId}` }); return }
    const artifact = await launchPreview(db, workerId, wt.path, mode)
    res.status(202).json(artifact)
  })

  r.post('/preview/final', async (_req, res) => {
    const runWorktree = getWorktrees(db).find(wt => wt.branch?.startsWith('run/'))
    if (!runWorktree) {
      res.status(409).json({ error: 'final preview unavailable' })
      return
    }

    const runId = runWorktree.branch?.replace('run/', '') ?? 'current'
    const artifact = await launchRunPreview(db, runId, runWorktree.path)
    res.status(202).json(artifact)
  })

  r.post('/preview/stop', (req, res) => {
    const { workerId } = req.body
    if (!workerId) { res.status(400).json({ error: 'workerId required' }); return }
    stopPreview(db, workerId)
    res.status(202).json({ ok: true })
  })

  r.post('/steer', (req, res) => {
    const { directive } = req.body
    if (!directive) { res.status(400).json({ error: 'directive required' }); return }
    console.log('[orc] steer directive (not routed):', directive)
    res.status(202).json({ ok: true, note: 'NL routing is [POST-DEMO]' })
  })

  return r
}
