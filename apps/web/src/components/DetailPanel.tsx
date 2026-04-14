'use client'
import { useEffect, useState } from 'react'
import type { SectionInfo, WorkerInfo } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function DetailPanel({ selectedId, sections }: { selectedId: string | null; sections: SectionInfo[] }) {
  const isLead = selectedId?.endsWith('-lead') ?? false
  const [tab, setTab] = useState<'compare'|'plan'|'logs'|'preview'>(isLead ? 'compare' : 'plan')
  useEffect(() => {
    setTab(isLead ? 'compare' : 'plan')
  }, [isLead, selectedId])
  if (!selectedId) return <div className="flex items-center justify-center h-full text-gray-600 text-sm">Select an entity from the tree</div>

  const sectionId = selectedId.replace('-lead', '')
  const section = sections.find(s => s.id === sectionId)
  const worker: WorkerInfo | undefined = sections.flatMap(s => s.workers).find(w => w.id === selectedId)

  async function approve() {
    if (!worker) return
    const leadId = sections.find(s => s.workers.some(w => w.id === worker.id))?.id + '-lead'
    await fetch(`${API}/api/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: worker.id, leadId }) })
  }
  async function drop() {
    const leadId = isLead ? selectedId : (sections.find(s => s.workers.some(w => w.id === selectedId))?.id + '-lead')
    await fetch(`${API}/api/drop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: selectedId, leadId }) })
  }
  async function launchPreview(workerId: string) {
    await fetch(`${API}/api/preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreeId: workerId }),
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700">
        <span className="font-mono text-yellow-300 font-bold text-sm">{selectedId}</span>
        <div className="ml-auto flex gap-2">
          {worker?.state === 'done' && (
            <button onClick={approve} className="text-[11px] bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded">&#10003; Approve</button>
          )}
          <button onClick={drop} className="text-[11px] bg-gray-700 hover:bg-red-800 text-red-300 px-3 py-1 rounded">&#10005; Drop</button>
          {worker?.previewUrl ? (
            <a href={worker.previewUrl} target="_blank" rel="noreferrer"
              className="text-[11px] bg-blue-800 hover:bg-blue-700 text-blue-200 px-3 py-1 rounded">&#9654; Preview</a>
          ) : worker ? (
            <button onClick={() => launchPreview(worker.id)} className="text-[11px] bg-blue-900 hover:bg-blue-800 text-blue-200 px-3 py-1 rounded">&#9654; Launch Preview</button>
          ) : null}
        </div>
      </div>

      <div className="flex border-b border-gray-700">
        {(isLead ? ['compare', 'plan', 'logs'] as const : ['plan', 'logs', 'preview'] as const).map(t => (
          <button key={t} onClick={() => setTab(t as any)}
            className={`px-4 py-2 text-xs capitalize ${tab === t ? 'border-b-2 border-blue-400 text-blue-300' : 'text-gray-500 hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 text-xs font-mono text-gray-400">
        {tab === 'compare' && isLead && section && (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] text-gray-500 font-sans">Listen to each variant and approve the winner.</p>
            {section.workers.map(w => (
              <div key={w.id} className={`flex items-center gap-3 p-3 rounded border ${w.state === 'done' ? 'border-green-700 bg-green-950' : 'border-gray-700 bg-gray-800 opacity-60'}`}>
                <div className="flex flex-col flex-1 gap-1">
                  <span className="text-gray-200 font-bold">{w.id}</span>
                  <span className={`text-[10px] ${w.state === 'done' ? 'text-green-400' : w.state === 'running' ? 'text-blue-400' : w.state === 'failed' ? 'text-red-400' : 'text-gray-500'}`}>{w.state}</span>
                </div>
                {w.state === 'done' && (
                  w.previewUrl
                    ? <a href={w.previewUrl} target="_blank" rel="noreferrer" className="text-[11px] bg-purple-800 hover:bg-purple-700 text-purple-200 px-3 py-1.5 rounded font-sans">&#9834; Listen</a>
                    : <button onClick={() => launchPreview(w.id)} className="text-[11px] bg-purple-900 hover:bg-purple-800 text-purple-200 px-3 py-1.5 rounded font-sans">&#9834; Launch</button>
                )}
                {w.state === 'done' && (
                  <button onClick={() => fetch(`${API}/api/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: w.id, leadId: `${sectionId}-lead` }) })}
                    className="text-[11px] bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-sans">&#10003; Pick this</button>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'plan' && (
          <p className="text-gray-500 font-sans">
            {isLead ? `Lead plan: .orc/runs/current/leads/${sectionId}.md` : `Worker plan: .worktrees/${selectedId}/.orc/worker-plan.md`}<br/><br/>
            Plain markdown &mdash; view in your editor.
          </p>
        )}
        {tab === 'logs' && (
          <p className="text-gray-500 font-sans">
            {isLead ? 'Select a worker to view its session log.' : <><code>.worktrees/{selectedId}/.orc/.orc-session.jsonl</code><br/><br/><code>tail -f .worktrees/{selectedId}/.orc/.orc-session.jsonl</code></>}
          </p>
        )}
        {tab === 'preview' && !isLead && (
          worker?.previewUrl
            ? <a href={worker.previewUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline break-all font-sans">{worker.previewUrl}</a>
            : <p className="text-gray-500 font-sans">No preview yet.</p>
        )}
      </div>
    </div>
  )
}
