import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { Router } from 'express'
import { getSQLite } from '../db/client'
import { getAllTasks, getWorktrees, getPreviews, getMergeCandidates, getTaskEdges, getArtifactPath } from '../db/queries'
import { launchPreview, launchRunPreview, stopPreview } from '../orchestrator/preview'
import type { AppDeps } from './app'
import { getEntityDetail } from './entityDetails'
import { readLeadLogWindow, readWorkerLogWindow, streamLeadLogs, streamWorkerLogs } from './entityLogs'
import { resolveWorkerRuntime } from './workerRuntime'

function parseLimit(value: unknown): number {
  const numeric = Number(value ?? 500)
  if (!Number.isFinite(numeric) || numeric <= 0) return 500
  return Math.min(1000, Math.floor(numeric))
}

function workerBelongsToRun(workerId: string, runId: string): boolean {
  return workerId.startsWith(`${runId}-`)
}

function isInActiveRun(workerId: string, runId: string): boolean {
  return runId === 'current' || workerBelongsToRun(workerId, runId)
}

function parseContextWinnerIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').sort()
      : []
  } catch {
    return []
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

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
    const scopedWorkerIds = new Set(
      tasks
        .filter(task => task.type === 'worker' && isInActiveRun(task.id, runId))
        .map(task => task.id),
    )
    const worktreeByWorker = new Map(
      worktrees
        .filter(worktree => scopedWorkerIds.has(worktree.workerId))
        .map(worktree => [worktree.workerId, worktree]),
    )
    const allWorktreeByWorker = new Map(
      worktrees.map(worktree => [worktree.workerId, worktree]),
    )
    const previewsByWorker = new Map<string, Array<{
      mode: 'solo' | 'contextual'
      previewUrl: string
      contextWinnerIds: string[]
    }>>()
    for (const preview of previews.filter(preview => scopedWorkerIds.has(preview.workerId))) {
      const entries = previewsByWorker.get(preview.workerId) ?? []
      entries.push({
        mode: preview.mode,
        previewUrl: preview.previewUrl,
        contextWinnerIds: parseContextWinnerIds(preview.contextWinnerIds),
      })
      previewsByWorker.set(preview.workerId, entries)
    }

    const sections = tasks.filter(t => t.type === 'lead').map(lead => {
      const candidate = mergeCandidateByLead.get(lead.id)
      const selectedWinnerWorkerId = candidate?.selectedWinnerWorkerId ?? null
      const upstreamLeadIds = taskEdges
        .filter(edge => edge.edgeType === 'depends_on' && edge.childId === lead.id)
        .map(edge => edge.parentId)
      const currentContextWinnerIds = upstreamLeadIds
        .map(depLeadId => mergeCandidateByLead.get(depLeadId)?.selectedWinnerWorkerId)
        .filter((winnerId): winnerId is string => Boolean(winnerId))
        .sort()

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
        workers: tasks.filter(
          task => task.type === 'worker'
            && task.parentId === lead.id
            && isInActiveRun(task.id, runId),
        ).map(worker => {
          const wt = worktreeByWorker.get(worker.id)
          const previewArtifacts = (previewsByWorker.get(worker.id) ?? [])
            .filter(preview =>
              preview.mode !== 'contextual'
              || arraysEqual(preview.contextWinnerIds, currentContextWinnerIds)
            )
            .map(preview => ({
              mode: preview.mode,
              previewUrl: preview.previewUrl,
            }))
          const awaitingUserApproval = lead.state === 'awaiting_user_approval'

          return {
            id: worker.id,
            state: worker.state,
            branch: wt?.branch,
            isProposed: candidate?.proposedWinnerWorkerId === worker.id,
            isSelected: selectedWinnerWorkerId === worker.id,
            canBeSelected: awaitingUserApproval && worker.state === 'done' && selectedWinnerWorkerId !== worker.id,
            isStopping: worker.state === 'stopping',
            contextAvailable: upstreamLeadIds.length > 0 && upstreamLeadIds.every(depLeadId => {
              const winnerId = mergeCandidateByLead.get(depLeadId)?.selectedWinnerWorkerId
              if (!winnerId) return false
              return Boolean(allWorktreeByWorker.get(winnerId))
            }),
            previewArtifacts,
          }
        }),
      }
    })

    const reviewReady = mastermindState === 'review_ready'
    const finalPreviewLaunchable = Boolean(
      finalPreview?.previewUrl
      || (runWorktree && existsSync(path.join(runWorktree.path, 'src/index.js')))
    )
    res.json({
      runId,
      mastermindState,
      reviewReady,
      fullSongPreviewAvailable: reviewReady && finalPreviewLaunchable,
      fullSongPreviewUrl: finalPreview?.previewUrl,
      sections,
    })
  })

  r.get('/events', (_req, res) => {
    const sqlite = getSQLite(db)
    res.json({ events: sqlite.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 100').all() })
  })

  r.get('/entities/:entityId/detail', async (req, res) => {
    const detail = await getEntityDetail(db, req.params.entityId)
    if (!detail) {
      res.status(404).json({ error: `entity not found: ${req.params.entityId}` })
      return
    }
    res.json(detail)
  })

  r.get('/entities/:entityId/logs', async (req, res) => {
    const entityId = req.params.entityId
    const task = getAllTasks(db).find(candidate => candidate.id === entityId)
    if (!task) {
      res.status(404).json({ error: `entity not found: ${entityId}` })
      return
    }

    const limit = parseLimit(req.query.limit)

    if (task.type === 'lead') {
      res.json(readLeadLogWindow(db, entityId, limit))
      return
    }

    if (task.type === 'worker') {
      const workerRuntime = resolveWorkerRuntime(db, entityId)
      if (!workerRuntime) {
        res.status(404).json({ error: `worktree not found for ${entityId}` })
        return
      }
      res.json(await readWorkerLogWindow(entityId, workerRuntime.logPath, limit))
      return
    }

    res.status(400).json({ error: `unsupported entity type for logs: ${task.type}` })
  })

  r.get('/entities/:entityId/logs/stream', (req, res) => {
    const entityId = req.params.entityId
    const task = getAllTasks(db).find(candidate => candidate.id === entityId)
    if (!task) {
      res.status(404).end()
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const afterValue = String(req.query.after ?? '')
    let cleanup = () => {}

    if (task.type === 'lead') {
      const afterEventId = afterValue.startsWith('event:') ? Number(afterValue.slice(6)) : 0
      cleanup = streamLeadLogs(db, res, entityId, Number.isFinite(afterEventId) ? afterEventId : 0)
    } else if (task.type === 'worker') {
      const workerRuntime = resolveWorkerRuntime(db, entityId)
      if (!workerRuntime) {
        res.end()
        return
      }
      const afterLine = afterValue.startsWith('line:') ? Number(afterValue.slice(5)) : 0
      cleanup = streamWorkerLogs(res, entityId, workerRuntime.logPath, Number.isFinite(afterLine) ? afterLine : 0)
    }

    req.on('close', () => {
      cleanup()
      res.end()
    })
  })

  r.post('/approve', (req, res) => {
    const { workerId, leadId } = req.body as { workerId?: string; leadId?: string }
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return }
    const tasks = getAllTasks(db)
    const lead = tasks.find(task => task.id === leadId && task.type === 'lead')
    if (!lead) { res.status(404).json({ error: `lead not found for ${leadId}` }); return }
    const q = leadQueues.get(leadId)
    if (!q) { res.status(404).json({ error: `lead queue not found for ${leadId}` }); return }
    if (lead.state !== 'awaiting_user_approval') {
      res.status(409).json({ error: `lead ${leadId} is not awaiting user approval` })
      return
    }

    const candidate = getMergeCandidates(db).find(entry => entry.leadId === leadId)
    if (!candidate?.proposedWinnerWorkerId) {
      res.status(409).json({ error: `lead ${leadId} has no reviewer proposal` })
      return
    }

    if (workerId) {
      const worker = tasks.find(task => task.id === workerId && task.type === 'worker' && task.parentId === leadId)
      const canBeSelected = worker?.state === 'done' && candidate.selectedWinnerWorkerId !== workerId
      if (!canBeSelected) {
        res.status(409).json({ error: `worker ${workerId} is not selectable for ${leadId}` })
        return
      }
      q.enqueue({ commandType: 'SelectWinner', workerId })
    } else {
      q.enqueue({ commandType: 'AcceptProposal' })
    }
    res.status(202).json({ ok: true })
  })

  r.post('/drop', (req, res) => {
    const { workerId, leadId } = req.body
    if (!workerId || !leadId) { res.status(400).json({ error: 'workerId and leadId required' }); return }
    const tasks = getAllTasks(db)
    const worker = tasks.find(task => task.id === workerId && task.parentId === leadId && task.type === 'worker')
    if (!worker) { res.status(404).json({ error: `worker ${workerId} not found for ${leadId}` }); return }
    if (['done', 'failed', 'cancelled', 'stop_failed'].includes(worker.state)) {
      res.status(409).json({ error: `worker ${workerId} is already terminal` })
      return
    }
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
    const existingPreview = getPreviews(db).find(
      preview => preview.workerId === `run:${runId}:final` && preview.mode === 'solo',
    )
    if (existingPreview) {
      res.status(202).json(existingPreview)
      return
    }

    try {
      const artifact = await launchRunPreview(db, runId, runWorktree.path)
      res.status(202).json(artifact)
    } catch (error) {
      res.status(409).json({
        error: error instanceof Error ? error.message : 'final preview unavailable',
      })
    }
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
