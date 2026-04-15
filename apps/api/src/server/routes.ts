import { Router } from 'express'
import type { AppDeps } from './app'
import { getAllTasks, getWorktrees, getPreviews, getMergeCandidates, getTaskEdges } from '../db/queries'
import { launchPreview, stopPreview } from '../orchestrator/preview'

export function createRoutes({ db, leadQueues }: AppDeps): Router {
  const r = Router()

  r.get('/orchestration', (_req, res) => {
    const tasks = getAllTasks(db)
    const worktrees = getWorktrees(db)
    const previews = getPreviews(db)
    const mergeCandidates = getMergeCandidates(db)
    const taskEdges = getTaskEdges(db)
    const sections = tasks.filter(t => t.type === 'lead').map(lead => ({
      id: lead.id.replace('-lead', ''), state: lead.state,
      workers: tasks.filter(t => t.type === 'worker' && t.parentId === lead.id).map(w => {
        const wt = worktrees.find(x => x.workerId === w.id)
        const previewArtifacts = previews
          .filter(p => p.workerId === w.id)
          .map(p => ({ mode: p.mode, previewUrl: p.previewUrl }))
        const selected = mergeCandidates.some(c => c.leadId === lead.id && c.winnerWorkerId === w.id)
        const upstreamLeadIds = taskEdges
          .filter(edge => edge.edgeType === 'depends_on' && edge.childId === lead.id)
          .map(edge => edge.parentId)
        const contextAvailable = upstreamLeadIds.length > 0 && upstreamLeadIds.every(depLeadId =>
          mergeCandidates.some(c => c.leadId === depLeadId)
        )
        return {
          id: w.id,
          state: w.state,
          branch: wt?.branch,
          selected,
          contextAvailable,
          previewArtifacts,
        }
      }),
    }))
    res.json({ runId: 'current', mastermindState: tasks.find(t => t.id === 'mastermind')?.state ?? 'idle', sections })
  })

  r.get('/events', (_req, res) => {
    const sqlite = (db as any).session.client
    res.json({ events: sqlite.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 100').all() })
  })

  r.post('/approve', (req, res) => {
    const { workerId, leadId } = req.body
    if (!workerId || !leadId) { res.status(400).json({ error: 'workerId and leadId required' }); return }
    const q = leadQueues.get(leadId)
    if (!q) { res.status(404).json({ error: `lead queue not found for ${leadId}` }); return }
    q.enqueue({ commandType: 'ForceApprove', winnerId: workerId })
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
