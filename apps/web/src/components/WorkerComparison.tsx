'use client'
import { useState } from 'react'
import type { WorkerInfo } from '@orc/types'
import { Button } from './ui/Button'
import { StatusBadge, type WorkerState } from './ui/StatusBadge'

interface WorkerComparisonProps {
  workers: WorkerInfo[]
  onSelectWinner: (workerId: string) => void
  onClose: () => void
}

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

export function WorkerComparison({ workers, onSelectWinner, onClose }: WorkerComparisonProps) {
  const [selectedWorker, setSelectedWorker] = useState<string | null>(
    workers.find(w => w.isSelected)?.id ?? null
  )

  const doneWorkers = workers.filter(w => w.state === 'done')

  if (doneWorkers.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-[var(--surface)] rounded-lg p-6 max-w-md border border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No Workers Ready
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            No completed workers available for comparison. Wait for workers to finish.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--background)] rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden border border-[var(--border)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Compare Workers
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Select the best implementation for this section
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Worker Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {doneWorkers.map((worker) => {
            const isSelected = selectedWorker === worker.id
            const soloPreview = worker.previewArtifacts.find(p => p.mode === 'solo')
            const mappedState = STATE_MAP[worker.state] || 'complete'

            return (
              <div
                key={worker.id}
                className={`rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--success-bg)]'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/50'
                }`}
              >
                {/* Worker Header */}
                <div className="p-4 border-b border-[var(--border)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-[var(--text-primary)] font-semibold">
                      {worker.id}
                    </span>
                    <StatusBadge status={mappedState} size="sm" />
                  </div>
                  {worker.isProposed && (
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Suggested by reviewer
                    </div>
                  )}
                  {isSelected && (
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400 ml-2">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Current selection
                    </div>
                  )}
                </div>

                {/* Preview */}
                <div className="p-4">
                  {soloPreview ? (
                    <div className="aspect-video bg-[var(--background)] rounded border border-[var(--border)] mb-4">
                      <iframe
                        src={soloPreview.previewUrl}
                        className="w-full h-full rounded"
                        title={`Preview ${worker.id}`}
                      />
                    </div>
                  ) : (
                    <div className="aspect-video bg-[var(--background)] rounded border border-[var(--border)] mb-4 flex items-center justify-center">
                      <span className="text-sm text-[var(--text-tertiary)]">
                        No preview available
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {worker.canBeSelected && (
                      <Button
                        variant={isSelected ? 'success' : 'primary'}
                        size="sm"
                        onClick={() => {
                          setSelectedWorker(worker.id)
                          onSelectWinner(worker.id)
                        }}
                        className="flex-1"
                      >
                        {isSelected ? '✓ Selected' : 'Select This'}
                      </Button>
                    )}
                    {soloPreview && (
                      <a
                        href={soloPreview.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 h-8 px-3 text-xs rounded-md font-medium transition-all bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-[var(--border)]"
                      >
                        ↗ Open
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] bg-[var(--surface)]">
          <span className="text-sm text-[var(--text-secondary)]">
            {doneWorkers.length} worker{doneWorkers.length !== 1 ? 's' : ''} available
          </span>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
