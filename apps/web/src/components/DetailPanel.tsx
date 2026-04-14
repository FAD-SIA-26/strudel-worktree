'use client'
import { useEffect, useState } from 'react'
import type { SectionInfo, WorkerInfo } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const WORKER_STATE_CFG: Record<string, { dot: string; text: string }> = {
  queued:   { dot: 'bg-gray-500',                text: 'text-gray-500' },
  spawning: { dot: 'bg-blue-400 animate-pulse',  text: 'text-blue-400' },
  running:  { dot: 'bg-blue-400 animate-pulse',  text: 'text-blue-400' },
  stalled:  { dot: 'bg-amber-400',               text: 'text-amber-400' },
  zombie:   { dot: 'bg-red-500',                 text: 'text-red-400' },
  done:     { dot: 'bg-emerald-400',             text: 'text-emerald-400' },
  failed:   { dot: 'bg-red-500',                 text: 'text-red-400' },
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

export function DetailPanel({ selectedId, sections }: {
  selectedId: string | null
  sections: SectionInfo[]
}) {
  const isLead = selectedId?.endsWith('-lead') ?? false
  const [tab, setTab] = useState<'compare' | 'plan' | 'logs' | 'preview'>(
    isLead ? 'compare' : 'plan'
  )

  useEffect(() => {
    setTab(isLead ? 'compare' : 'plan')
  }, [isLead, selectedId])

  if (!selectedId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 select-none">
        <div className="w-12 h-12 rounded-2xl bg-[#0f1420] border border-[#1c2738] flex items-center justify-center">
          <span className="text-gray-700 text-xl">◈</span>
        </div>
        <div>
          <p className="text-sm text-gray-500 font-medium">Nothing selected</p>
          <p className="text-[11px] text-gray-700 mt-1">
            Choose a section lead or worker from the tree
          </p>
        </div>
      </div>
    )
  }

  const sectionId = selectedId.replace('-lead', '')
  const section = sections.find(s => s.id === sectionId)
  const worker: WorkerInfo | undefined = sections.flatMap(s => s.workers).find(w => w.id === selectedId)
  const workerCfg = worker ? (WORKER_STATE_CFG[worker.state] ?? WORKER_STATE_CFG.queued) : null

  async function approve() {
    if (!worker) return
    const leadId = sections.find(s => s.workers.some(w => w.id === worker.id))?.id + '-lead'
    await fetch(`${API}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: worker.id, leadId }),
    })
  }

  async function drop() {
    const leadId = isLead
      ? selectedId
      : (sections.find(s => s.workers.some(w => w.id === selectedId))?.id + '-lead')
    await fetch(`${API}/api/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: selectedId, leadId }),
    })
  }

  async function launchPreview(workerId: string) {
    await fetch(`${API}/api/preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreeId: workerId }),
    })
  }

  const tabs = isLead
    ? (['compare', 'plan', 'logs'] as const)
    : (['plan', 'logs', 'preview'] as const)

  const TAB_LABEL: Record<string, string> = {
    compare: 'Compare',
    plan: 'Plan',
    logs: 'Logs',
    preview: 'Preview',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel header */}
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
              <span className={`text-[10px] ${workerCfg.text}`}>{worker!.state}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5 flex-shrink-0">
          {worker?.state === 'done' && (
            <button
              onClick={approve}
              className="text-[11px] bg-emerald-500/12 hover:bg-emerald-500/22 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/25 transition-colors"
            >
              ✓ Approve
            </button>
          )}
          <button
            onClick={drop}
            className="text-[11px] bg-red-500/8 hover:bg-red-500/18 text-red-400 px-2.5 py-1 rounded border border-red-500/20 transition-colors"
          >
            ✕ Drop
          </button>
          {worker?.previewUrl ? (
            <a
              href={worker.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] bg-blue-500/12 hover:bg-blue-500/22 text-blue-400 px-2.5 py-1 rounded border border-blue-500/25 transition-colors"
            >
              ↗ Preview
            </a>
          ) : worker ? (
            <button
              onClick={() => launchPreview(worker.id)}
              className="text-[11px] bg-[#111825] hover:bg-[#192030] text-blue-400 px-2.5 py-1 rounded border border-[#1c2738] transition-colors"
            >
              ▶ Launch
            </button>
          ) : null}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#1c2738] bg-[#0b0e14] flex-shrink-0 px-2 gap-0.5">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === t
                ? 'text-blue-400'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {TAB_LABEL[t]}
            {tab === t && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-400 rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-5">

        {/* Compare tab (leads only) */}
        {tab === 'compare' && isLead && section && (
          <div className="max-w-2xl space-y-2">
            <p className="text-[11px] text-gray-600 mb-4">
              Review each worker's output. Launch a preview to compare, then pick the winner.
            </p>
            {section.workers.map(w => {
              const cfg = WORKER_STATE_CFG[w.state] ?? WORKER_STATE_CFG.queued
              const isDone = w.state === 'done'
              return (
                <div
                  key={w.id}
                  className={`flex items-center gap-3 p-3.5 rounded-lg border transition-colors ${
                    isDone
                      ? 'border-emerald-500/25 bg-emerald-500/5'
                      : 'border-[#1c2738] bg-[#0f1420] opacity-60'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] text-gray-200 truncate">{w.id}</div>
                    <div className={`text-[10px] mt-0.5 ${cfg.text}`}>{w.state}</div>
                  </div>
                  {isDone && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      {w.previewUrl ? (
                        <a
                          href={w.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] bg-violet-500/12 hover:bg-violet-500/22 text-violet-400 px-2.5 py-1 rounded border border-violet-500/25 transition-colors"
                        >
                          ↗ Listen
                        </a>
                      ) : (
                        <button
                          onClick={() => launchPreview(w.id)}
                          className="text-[11px] bg-violet-500/8 hover:bg-violet-500/18 text-violet-400 px-2.5 py-1 rounded border border-violet-500/20 transition-colors"
                        >
                          ▶ Launch
                        </button>
                      )}
                      <button
                        onClick={() => fetch(`${API}/api/approve`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ workerId: w.id, leadId: `${sectionId}-lead` }),
                        })}
                        className="text-[11px] bg-emerald-500/12 hover:bg-emerald-500/22 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/25 transition-colors"
                      >
                        ✓ Pick
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {section.workers.length === 0 && (
              <div className="py-8 text-[11px] text-gray-700 text-center italic">
                No workers assigned yet
              </div>
            )}
          </div>
        )}

        {/* Plan tab */}
        {tab === 'plan' && (
          <div className="max-w-xl space-y-3">
            <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-3">
              <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                File path
              </span>
              <CodeBlock>
                {isLead
                  ? `.orc/runs/current/leads/${sectionId}.md`
                  : `.worktrees/${selectedId}/.orc/worker-plan.md`}
              </CodeBlock>
              <p className="text-[11px] text-gray-600">
                Markdown file — open in your editor to view.
              </p>
            </div>
          </div>
        )}

        {/* Logs tab */}
        {tab === 'logs' && (
          <div className="max-w-xl space-y-3">
            {isLead ? (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
                <p className="text-[11px] text-gray-500">
                  Select a worker to view its session log.
                </p>
              </div>
            ) : (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-3">
                <div className="space-y-1.5">
                  <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                    Log file
                  </span>
                  <CodeBlock>
                    {`.worktrees/${selectedId}/.orc/.orc-session.jsonl`}
                  </CodeBlock>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                    Tail in real-time
                  </span>
                  <CodeBlock color="amber">
                    {`tail -f .worktrees/${selectedId}/.orc/.orc-session.jsonl`}
                  </CodeBlock>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview tab */}
        {tab === 'preview' && !isLead && (
          <div className="max-w-xl space-y-3">
            {worker?.previewUrl ? (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
                <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">
                  Preview URL
                </span>
                <a
                  href={worker.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] font-mono text-blue-400 hover:text-blue-300 bg-blue-500/5 border border-blue-500/15 rounded px-3 py-2 break-all transition-colors"
                >
                  {worker.previewUrl}
                </a>
              </div>
            ) : (
              <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
                <p className="text-[11px] text-gray-600">
                  No preview available yet.{' '}
                  <span className="text-blue-400">▶ Launch</span> to start one.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
