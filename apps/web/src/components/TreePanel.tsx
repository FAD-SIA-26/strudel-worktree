'use client'
import { useState } from 'react'
import type { OrchState } from '@orc/types'
import { WorkerCard } from './WorkerCard'
import { StatusBadge, type MastermindState } from './ui/StatusBadge'

const STATE_MAP: Record<string, MastermindState> = {
  idle: 'idle',
  planning: 'planning',
  running: 'running',
  reviewing: 'reviewing',
  awaiting_user_approval: 'awaiting_user_approval',
  merging: 'merging',
  merging_lane: 'merging_lane',
  merging_lanes: 'merging_lanes',
  done: 'complete',
  review_ready: 'complete',
  failed: 'failed',
}

export function TreePanel({ state, selected, onSelect }: {
  state: OrchState | undefined
  selected: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(new Set<string>())
  const toggle = (id: string) => setOpen(p => {
    const n = new Set(p)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const mastermindState = STATE_MAP[state?.mastermindState ?? 'idle'] || 'idle'

  return (
    <div className="p-3 space-y-2">
      {/* Panel label */}
      <div className="px-2 pt-1 pb-2">
        <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Hierarchy
        </span>
      </div>

      {/* Mastermind */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] mb-3">
        <span className="text-[var(--accent)] text-sm flex-shrink-0">◆</span>
        <span className="text-[var(--text-primary)] font-semibold text-sm flex-1">
          mastermind
        </span>
        <StatusBadge status={mastermindState} size="sm" showLabel={false} />
      </div>

      {/* Sections */}
      {(state?.sections ?? []).map(s => {
        const isOpen = open.has(s.id)
        const leadId = `${s.id}-lead`
        const isSelected = selected === leadId
        const sectionState = STATE_MAP[s.state] || 'idle'

        return (
          <div key={s.id}>
            <button
              onClick={() => { toggle(s.id); onSelect(leadId) }}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg w-full text-left min-w-0 transition-colors ${
                isSelected
                  ? 'bg-[var(--surface)] ring-2 ring-[var(--accent)]'
                  : 'hover:bg-[var(--surface-hover)]'
              }`}
            >
              <span className="text-[var(--text-tertiary)] text-xs flex-shrink-0 w-3">
                {isOpen ? '▾' : '▸'}
              </span>
              <span className="text-[var(--text-primary)] font-mono text-sm truncate flex-1 min-w-0">
                {s.id}
              </span>
              <StatusBadge status={sectionState} size="sm" showLabel={false} />
            </button>

            {isOpen && (
              <div className="ml-4 mt-1 mb-2 border-l-2 border-[var(--border)] pl-2 space-y-1">
                {s.workers.map(w => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    selected={selected === w.id}
                    onSelect={onSelect}
                  />
                ))}
                {s.workers.length === 0 && (
                  <div className="px-3 py-3 text-xs text-[var(--text-tertiary)] italic">
                    No workers yet
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {!state?.sections?.length && (
        <div className="px-3 py-8 text-sm text-[var(--text-tertiary)] text-center">
          Awaiting sections…
        </div>
      )}
    </div>
  )
}
