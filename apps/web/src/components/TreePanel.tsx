'use client'
import { useState } from 'react'
import type { OrchState } from '@orc/types'
import { WorkerCard } from './WorkerCard'

export function TreePanel({ state, selected, onSelect }: { state: OrchState | undefined; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(new Set<string>())
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const LEAD_COLORS: Record<string, string> = {
    idle: 'text-gray-500', planning: 'text-purple-300', running: 'text-blue-300',
    reviewing: 'text-yellow-300', merging: 'text-orange-300', done: 'text-green-300', failed: 'text-red-300',
  }
  return (
    <div className="p-3 overflow-y-auto">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">TREE</div>
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-indigo-950 border border-indigo-700 mb-2">
        <span className="text-indigo-400 text-xs">&#9670;</span>
        <span className="text-indigo-300 font-bold text-xs">mastermind</span>
        <span className="ml-auto text-[10px] text-indigo-500">{state?.mastermindState ?? 'idle'}</span>
      </div>
      {(state?.sections ?? []).map(s => (
        <div key={s.id} className="ml-3 mb-1">
          <button onClick={() => { toggle(s.id); onSelect(`${s.id}-lead`) }}
            className={`flex items-center gap-2 px-2 py-1 rounded w-full text-left text-xs ${selected === `${s.id}-lead` ? 'ring-1 ring-yellow-400' : 'hover:bg-gray-800'}`}>
            <span className="text-gray-500">{open.has(s.id) ? '\u25be' : '\u25b8'}</span>
            <span className="text-yellow-300 font-mono">{s.id}-lead</span>
            <span className={`ml-auto text-[10px] ${LEAD_COLORS[s.state] ?? 'text-gray-500'}`}>{s.state}</span>
          </button>
          {open.has(s.id) && (
            <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
              {s.workers.map(w => (
                <WorkerCard key={w.id} worker={w} selected={selected === w.id} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
