'use client'
import type { WorkerInfo } from '@orc/types'
import { StatusBadge, type WorkerState } from './ui/StatusBadge'

const STATE_MAP: Record<string, WorkerState> = {
  queued: 'queued',
  spawning: 'spawning',
  running: 'running',
  stalled: 'stalled',
  zombie: 'zombie',
  stopping: 'stopping',
  stop_failed: 'stop_failed',
  done: 'complete',
  failed: 'failed',
}

export function WorkerCard({ worker, selected, onSelect }: {
  worker: WorkerInfo
  selected: boolean
  onSelect: (id: string) => void
}) {
  const mappedState = STATE_MAP[worker.state] || 'queued'
  const soloPreview = worker.previewArtifacts.find(p => p.mode === 'solo')

  return (
    <button
      onClick={() => onSelect(worker.id)}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg w-full text-left min-w-0 transition-colors ${
        selected
          ? 'bg-[var(--surface)] ring-2 ring-[var(--info)]'
          : 'hover:bg-[var(--surface-hover)]'
      }`}
    >
      <StatusBadge status={mappedState} size="sm" showLabel={false} />
      <span className="font-mono text-sm text-[var(--text-primary)] truncate flex-1 min-w-0">
        {worker.id}
      </span>
      {soloPreview && (
        <a
          href={soloPreview.previewUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="ml-auto text-xs text-[var(--info-text)] hover:text-[var(--info)] flex-shrink-0 transition-colors"
          title="Open solo preview"
        >
          ↗
        </a>
      )}
    </button>
  )
}
