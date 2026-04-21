'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrchestration } from '../hooks/useOrchestration'
import { TreePanel } from '../components/TreePanel'
import { DetailPanel } from '../components/DetailPanel'
import { EventStream } from '../components/EventStream'
import { launchFinalPreview } from '../lib/previewActions'
import { showFinalPreviewCta } from '../lib/reviewState'
import { StatusBadge, type MastermindState } from '../components/ui/StatusBadge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ProgressBar } from '../components/ui/ProgressBar'

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

export default function Page() {
  const [selected, setSelected] = useState<string | null>(null)
  const [finalPreviewError, setFinalPreviewError] = useState<string | null>(null)
  const qc = useQueryClient()
  const { data } = useOrchestration()
  const mState = data?.mastermindState ?? 'idle'
  const mappedState = STATE_MAP[mState] || 'idle'

  // Calculate overall progress
  const totalSections = data?.sections?.length ?? 0
  const completedSections = data?.sections?.filter(s => s.state === 'done' || s.state === 'review_ready').length ?? 0

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 h-14 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-[var(--accent)] font-bold text-sm tracking-wide select-none">◈ ORC</span>
          <div className="w-px h-5 bg-[var(--border)]" />
          <StatusBadge status={mappedState} size="sm" />
          {data?.runId && (
            <span className="text-xs text-[var(--text-tertiary)] font-mono truncate">
              {data.runId}
            </span>
          )}
        </div>
        {totalSections > 0 && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-[var(--text-secondary)]">
              {completedSections}/{totalSections} sections
            </span>
          </div>
        )}
      </header>

      {/* Progress Bar (when orchestration is running) */}
      {totalSections > 0 && mState !== 'idle' && (
        <div className="px-6 py-3 bg-[var(--surface)] border-b border-[var(--border)]">
          <ProgressBar
            value={completedSections}
            max={totalSections}
            label="Overall Progress"
          />
        </div>
      )}

      {showFinalPreviewCta(data) && (
        <div className="mx-6 mt-4 rounded-lg border border-[var(--success)] bg-[var(--success-bg)] px-5 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--success-text)] font-semibold mb-1">
              🎉 Review Ready
            </div>
            <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Full song is ready to audition. ORC will stay alive until you press Ctrl+C in the terminal.
            </div>
            {finalPreviewError && (
              <div className="text-xs text-[var(--danger-text)] mt-2">
                ⚠ Final preview launch failed. Retry without rerunning the orchestration.
              </div>
            )}
          </div>
          <Button
            variant="success"
            size="md"
            onClick={async () => {
              const artifact = await launchFinalPreview(qc)
              setFinalPreviewError(artifact ? null : 'launch failed')
            }}
          >
            ▶ Launch Preview
          </Button>
        </div>
      )}

      {/* Empty State */}
      {!data?.sections?.length && mState === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="◈"
            title="No Orchestration Running"
            description="Start an orchestration from the CLI to see the dashboard in action. Use ./run-orc.sh to begin."
            secondaryActions={
              <span className="text-[var(--text-tertiary)] text-xs">
                Waiting for orchestration...
              </span>
            }
          />
        </div>
      )}

      {/* 3-panel layout - Only show when we have data */}
      {data?.sections?.length ? (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Tree */}
          <aside className="w-64 border-r border-[var(--border)] overflow-y-auto overflow-x-hidden flex-shrink-0 bg-[var(--surface-hover)]">
            <TreePanel state={data} selected={selected} onSelect={setSelected} />
          </aside>

          {/* Center: Detail */}
          <main className="flex-1 overflow-hidden min-w-0 bg-[var(--background)]">
            <DetailPanel selectedId={selected} sections={data?.sections ?? []} />
          </main>

          {/* Right: Events */}
          <aside className="w-64 border-l border-[var(--border)] overflow-y-auto overflow-x-hidden flex-shrink-0 bg-[var(--surface-hover)]">
            <EventStream />
          </aside>
        </div>
      ) : null}
    </div>
  )
}
