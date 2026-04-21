'use client'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SectionInfo, WorkerInfo } from '@orc/types'
import { launchWorkerPreview } from '../lib/previewActions'
import { getProposedWorker, getSelectedWorker } from '../lib/reviewState'
import { useEntityDetail } from '../hooks/useEntityDetail'
import { useEntityLogs } from '../hooks/useEntityLogs'
import { Button } from './ui/Button'
import { StatusBadge } from './ui/StatusBadge'
import { WorkerComparison } from './WorkerComparison'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const API_UNAVAILABLE_MESSAGE = 'Unable to reach the ORC API. Start or resume ORC and try again.'

const WORKER_STATE_CFG: Record<string, { dot: string; text: string }> = {
  queued: { dot: 'bg-gray-500', text: 'text-gray-500' },
  spawning: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400' },
  running: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400' },
  stalled: { dot: 'bg-amber-400', text: 'text-amber-400' },
  zombie: { dot: 'bg-red-500', text: 'text-red-400' },
  stopping: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  stop_failed: { dot: 'bg-red-500', text: 'text-red-400' },
  done: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  failed: { dot: 'bg-red-500', text: 'text-red-400' },
}

function CodeBlock({ children, color = 'blue' }: { children: string; color?: 'blue' | 'amber' }) {
  const palette = color === 'amber'
    ? 'text-amber-300/80 bg-amber-500/5 border-amber-500/15'
    : 'text-blue-300 bg-blue-500/5 border-blue-500/15'

  return (
    <code className={`block text-[11px] font-mono rounded px-3 py-2 border break-all leading-relaxed ${palette}`}>
      {children}
    </code>
  )
}

function TextPanel({
  label,
  pathValue,
  content,
  emptyMessage,
}: {
  label: string
  pathValue?: string | null
  content: string | null | undefined
  emptyMessage: string
}) {
  return (
    <div className="max-w-3xl space-y-3">
      {pathValue ? (
        <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
          <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
            {label} path
          </span>
          <CodeBlock>{pathValue}</CodeBlock>
        </div>
      ) : null}
      <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
        <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-300 font-mono leading-relaxed">
          {content && content.length > 0 ? content : emptyMessage}
        </pre>
      </div>
    </div>
  )
}

function previewFor(worker: WorkerInfo, mode: 'solo' | 'contextual') {
  return worker.previewArtifacts.find(p => p.mode === mode)
}

async function readActionError(res: Response): Promise<string> {
  try {
    const payload = await res.json() as { error?: string }
    if (typeof payload?.error === 'string' && payload.error.length > 0) {
      return payload.error
    }
  } catch {}

  return `Request failed (${res.status})`
}

export function DetailPanel({ selectedId, sections }: {
  selectedId: string | null
  sections: SectionInfo[]
}) {
  const qc = useQueryClient()
  const isLead = selectedId?.endsWith('-lead') ?? false
  const { data: detail } = useEntityDetail(selectedId)
  const logs = useEntityLogs(selectedId)
  const [tab, setTab] = useState<'compare' | 'plan' | 'logs' | 'diff' | 'preview'>(
    isLead ? 'compare' : 'plan'
  )
  const [pendingWinnerId, setPendingWinnerId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showComparison, setShowComparison] = useState(false)

  useEffect(() => {
    setTab(isLead ? 'compare' : 'plan')
    setActionError(null)
  }, [isLead, selectedId])

  if (!selectedId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8 select-none">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
          <span className="text-[var(--text-tertiary)] text-3xl">◈</span>
        </div>
        <div>
          <p className="text-base text-[var(--text-secondary)] font-semibold">Nothing selected</p>
          <p className="text-sm text-[var(--text-tertiary)] mt-2">
            Choose a section lead or worker from the tree
          </p>
        </div>
      </div>
    )
  }

  const leadSection = isLead
    ? sections.find(s => `${s.id}-lead` === selectedId)
    : sections.find(s => s.workers.some(w => w.id === selectedId))
  const leadId = leadSection ? `${leadSection.id}-lead` : null
  const sectionId = leadSection?.id ?? selectedId.replace('-lead', '')
  const section = isLead ? leadSection : undefined
  const worker = isLead ? undefined : leadSection?.workers.find(w => w.id === selectedId)
  const workerCfg = worker ? (WORKER_STATE_CFG[worker.state] ?? WORKER_STATE_CFG.queued) : null
  const headerSoloPreview = worker ? previewFor(worker, 'solo') : null
  const proposedWorker = getProposedWorker(section)
  const selectedWorker = getSelectedWorker(section)
  const canChooseWinner = Boolean(leadId && leadSection?.awaitingUserApproval)

  async function postAction(path: string, body: Record<string, unknown>) {
    setActionError(null)
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setActionError(await readActionError(res))
        return null
      }
      return res
    } catch {
      setActionError(API_UNAVAILABLE_MESSAGE)
      return null
    }
  }

  async function approveProposal(targetLeadId: string) {
    setPendingWinnerId(proposedWorker?.id ?? null)
    try {
      const res = await postAction('/api/approve', { leadId: targetLeadId })
      if (res) {
        await qc.invalidateQueries({ queryKey: ['orchestration'] })
      }
    } finally {
      setPendingWinnerId(null)
    }
  }

  async function pickWinner(workerId: string, targetLeadId: string) {
    setPendingWinnerId(workerId)
    try {
      const res = await postAction('/api/approve', { workerId, leadId: targetLeadId })
      if (res) {
        await qc.invalidateQueries({ queryKey: ['orchestration'] })
      }
    } finally {
      setPendingWinnerId(null)
    }
  }

  async function drop() {
    const targetLeadId = isLead ? selectedId : leadId
    if (!targetLeadId) return

    const res = await postAction('/api/drop', { workerId: selectedId, leadId: targetLeadId })
    if (res) {
      await qc.invalidateQueries({ queryKey: ['orchestration'] })
    }
  }

  const tabs = isLead
    ? (['compare', 'plan', 'logs', 'diff'] as const)
    : (['plan', 'logs', 'diff', 'preview'] as const)

  const TAB_LABEL: Record<string, string> = {
    compare: 'Compare',
    plan: 'Plan',
    logs: 'Logs',
    diff: 'Diff',
    preview: 'Preview',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1c2738] bg-[#0b0e14] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${
            isLead
              ? 'bg-yellow-500/12 text-yellow-400 border-yellow-500/25'
              : 'bg-blue-500/12 text-blue-400 border-blue-500/25'
          }`}>
            {isLead ? 'LEAD' : 'WORKER'}
          </span>
          <span className="font-mono text-[12px] text-gray-200 truncate">{selectedId}</span>
          {workerCfg && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${workerCfg.dot}`} />
              <span className={`text-[10px] ${workerCfg.text}`}>{worker?.state}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {worker?.canBeSelected && canChooseWinner && leadId && (
            <Button
              variant="success"
              size="sm"
              onClick={() => pickWinner(worker.id, leadId)}
            >
              ✓ Choose Winner
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={drop}>
            ✕ Drop
          </Button>
          {headerSoloPreview ? (
            <a
              href={headerSoloPreview.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 h-8 px-3 text-xs rounded-md font-medium transition-all bg-[var(--info-bg)] text-[var(--info-text)] hover:bg-[var(--info)] border border-[var(--info)]"
            >
              ↗ Preview
            </a>
          ) : worker ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => launchWorkerPreview(qc, worker.id, 'solo')}
            >
              ▶ Launch
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex border-b border-[#1c2738] bg-[#0b0e14] flex-shrink-0 px-2 gap-0.5">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === t ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {TAB_LABEL[t]}
            {tab === t && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-400 rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-5">
        {actionError && (
          <div className="max-w-2xl mb-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-[11px] text-red-200">
            {actionError}
          </div>
        )}
        {tab === 'compare' && isLead && section && (
          <>
            <div className="max-w-2xl space-y-2">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  Review each worker&apos;s output. Launch previews, then explicitly pick the lane winner.
                </p>
                {section.workers.filter(w => w.state === 'done').length >= 2 && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowComparison(true)}
                  >
                    Compare Side-by-Side
                  </Button>
                )}
              </div>

              {section.awaitingUserApproval && proposedWorker && leadId && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-4 mb-4">
                <div className="text-[11px] text-amber-200">
                  Mastermind suggests <span className="font-mono">{proposedWorker.id}</span> for this lane. You can
                  accept it or choose another completed worker.
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => approveProposal(leadId)}
                  >
                    ✓ Accept Suggestion
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => launchWorkerPreview(qc, proposedWorker.id, 'solo')}
                  >
                    ▶ Open Preview
                  </Button>
                </div>
              </div>
            )}

            {selectedWorker && !section.awaitingUserApproval && (
              <div className="text-[10px] text-emerald-200/85 mb-3">
                Current selected winner: <span className="font-mono">{selectedWorker.id}</span>
              </div>
            )}

            {section.workers.map(w => {
              const cfg = WORKER_STATE_CFG[w.state] ?? WORKER_STATE_CFG.queued
              const isDone = w.state === 'done'
              const soloPreview = previewFor(w, 'solo')
              const contextualPreview = previewFor(w, 'contextual')

              return (
                <div
                  key={w.id}
                  className={`flex items-center gap-3 p-3.5 rounded-lg border transition-colors ${
                    w.isSelected
                      ? 'border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/30'
                      : isDone
                        ? 'border-emerald-500/25 bg-emerald-500/5'
                        : 'border-[#1c2738] bg-[#0f1420] opacity-60'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] text-gray-200 truncate flex items-center gap-2 flex-wrap">
                      <span className="truncate">{w.id}</span>
                      {w.isProposed && (
                        <span className="text-[10px] text-amber-300 border border-amber-400/30 rounded px-2 py-0.5">
                          SUGGESTED BY REVIEWER
                        </span>
                      )}
                      {w.isSelected && (
                        <span className="text-[10px] text-emerald-300 border border-emerald-400/30 rounded px-2 py-0.5">
                          SELECTED WINNER
                        </span>
                      )}
                      {pendingWinnerId === w.id && (
                        <span className="text-[10px] text-blue-300 border border-blue-400/30 rounded px-2 py-0.5">
                          SELECTING...
                        </span>
                      )}
                      {w.isStopping && (
                        <span className="text-[10px] text-amber-300 border border-amber-400/30 rounded px-2 py-0.5">
                          STOPPING SIBLINGS...
                        </span>
                      )}
                      {w.state === 'stop_failed' && (
                        <span className="text-[10px] text-red-300 border border-red-400/30 rounded px-2 py-0.5">
                          STOPPING FAILED
                        </span>
                      )}
                      {section.selectionStatus === 'lane_merged' && w.isSelected && (
                        <span className="text-[10px] text-emerald-200 border border-emerald-400/30 rounded px-2 py-0.5">
                          MERGED INTO LANE
                        </span>
                      )}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${cfg.text}`}>{w.state}</div>
                  </div>
                  {isDone && (
                    <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {soloPreview ? (
                        <a
                          href={soloPreview.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-2 h-8 px-3 text-xs rounded-md font-medium transition-all bg-violet-500/12 text-violet-400 hover:bg-violet-500/22 border border-violet-500/25"
                        >
                          ↗ Solo
                        </a>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => launchWorkerPreview(qc, w.id, 'solo')}
                        >
                          ▶ Solo
                        </Button>
                      )}
                      {contextualPreview ? (
                        <a
                          href={contextualPreview.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-2 h-8 px-3 text-xs rounded-md font-medium transition-all bg-[var(--info-bg)] text-[var(--info-text)] hover:bg-[var(--info)] border border-[var(--info)]"
                        >
                          ↗ Context
                        </a>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => launchWorkerPreview(qc, w.id, 'contextual')}
                          disabled={!w.contextAvailable}
                        >
                          ▶ Context
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => launchWorkerPreview(qc, w.id, 'solo')}
                      >
                        ↻ Refresh
                      </Button>
                      {w.canBeSelected && canChooseWinner && leadId && (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => pickWinner(w.id, leadId)}
                        >
                          ✓ Winner
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {section.workers.length === 0 && (
              <div className="py-8 text-sm text-[var(--text-tertiary)] text-center italic">
                No workers assigned yet
              </div>
            )}
            </div>
          </>
        )}

        {tab === 'plan' && detail && (
          <TextPanel
            label="Plan"
            pathValue={detail.resolvedPaths.planPath}
            content={detail.plan.content}
            emptyMessage={detail.plan.message ?? 'Plan not available yet.'}
          />
        )}

        {tab === 'logs' && detail && (
          <div className="max-w-3xl space-y-3">
            {detail.entityType === 'worker' && detail.resolvedPaths.logPath ? (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
                <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                  Log path
                </span>
                <CodeBlock>{detail.resolvedPaths.logPath}</CodeBlock>
              </div>
            ) : null}
            <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
              <div className="space-y-2">
                {logs.entries.length > 0 ? logs.entries.map(entry => (
                  <div key={entry.id} className="border border-[#1c2738] rounded px-3 py-2 bg-[#0b0e14]">
                    <div className="text-[10px] text-gray-500 font-mono">{entry.title}</div>
                    <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-300 font-mono leading-relaxed">{entry.body}</pre>
                  </div>
                )) : (
                  <p className="text-[11px] text-gray-600">
                    {logs.status === 'loading'
                      ? 'Loading logs...'
                      : logs.error ?? 'No logs available yet.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'diff' && detail && (
          <TextPanel
            label="Diff"
            pathValue={detail.entityType === 'worker' ? detail.resolvedPaths.worktreePath : detail.resolvedPaths.winnerWorktreePath}
            content={detail.diff.content}
            emptyMessage={detail.diff.message ?? 'No diff available yet.'}
          />
        )}

        {tab === 'preview' && !isLead && (
          <div className="max-w-xl space-y-3">
            {headerSoloPreview ? (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
                <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                  Preview URL
                </span>
                <a
                  href={headerSoloPreview.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] font-mono text-blue-400 hover:text-blue-300 bg-blue-500/5 border border-blue-500/15 rounded px-3 py-2 break-all transition-colors"
                >
                  {headerSoloPreview.previewUrl}
                </a>
              </div>
            ) : worker ? (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5 space-y-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  No preview available yet. Launch to start one.
                </p>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => launchWorkerPreview(qc, worker.id, 'solo')}
                >
                  ▶ Launch Solo Preview
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Worker Comparison Modal */}
      {showComparison && section && leadId && (
        <WorkerComparison
          workers={section.workers}
          onSelectWinner={(workerId) => pickWinner(workerId, leadId)}
          onClose={() => setShowComparison(false)}
        />
      )}
    </div>
  )
}
