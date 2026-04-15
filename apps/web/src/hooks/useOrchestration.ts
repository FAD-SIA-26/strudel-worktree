'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { orcWs } from '../ws/client'
import type { OrchState } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

function applyEvent(old: OrchState | undefined, ev: any): OrchState {
  if (!old) {
    return {
      runId: 'current',
      mastermindState: 'idle',
      reviewReady: false,
      fullSongPreviewAvailable: false,
      sections: [],
    }
  }

  const workerStateMap: Record<string, string> = {
    WorkerDone: 'done',
    WorkerFailed: 'failed',
    WorkerStalled: 'stalled',
    WorkerZombie: 'zombie',
    WorkerRecovered: 'running',
    WorkerProgress: 'running',
    WorkerStopping: 'stopping',
    WorkerStopFailed: 'stop_failed',
  }
  if (workerStateMap[ev.eventType]) {
    return {
      ...old,
      sections: old.sections.map(s => ({
        ...s,
        workers: s.workers.map(w =>
          w.id === ev.entityId
            ? {
                ...w,
                state: workerStateMap[ev.eventType],
                isStopping: ev.eventType === 'WorkerStopping' ? true : ev.eventType === 'WorkerStopFailed' ? false : w.isStopping,
              }
            : w
        ),
      })),
    }
  }

  const leadStateMap: Record<string, string> = {
    LeadPlanReady: 'running',
    WinnerProposed: 'awaiting_user_approval',
    LaneMergeStarted: 'merging_lane',
    LeadDone: 'done',
    LeadFailed: 'failed',
  }
  if (leadStateMap[ev.eventType]) {
    const sectionId = (ev.entityId as string).replace('-lead', '')
    return {
      ...old,
      sections: old.sections.map(s => {
        if (s.id !== sectionId) return s

        const proposedWinnerId =
          ev.eventType === 'WinnerProposed' ? (ev.payload?.proposedWinnerId as string | undefined) : undefined

        return {
          ...s,
          state: leadStateMap[ev.eventType],
          awaitingUserApproval: ev.eventType === 'WinnerProposed' ? true : ev.eventType === 'LaneMergeStarted' ? false : s.awaitingUserApproval,
          selectionStatus: ev.eventType === 'WinnerProposed'
            ? 'waiting_for_user'
            : ev.eventType === 'LaneMergeStarted'
              ? 'selected'
              : ev.eventType === 'LeadDone'
                ? 'lane_merged'
                : s.selectionStatus,
          proposedWinnerWorkerId: proposedWinnerId ?? s.proposedWinnerWorkerId,
          workers: proposedWinnerId
            ? s.workers.map(w => ({ ...w, isProposed: w.id === proposedWinnerId }))
            : s.workers,
        }
      }),
    }
  }

  const mastermindStateMap: Record<string, string> = {
    PlanReady: 'delegating',
    OrchestrationComplete: 'review_ready',
    OrchestrationFailed: 'failed',
  }
  if (mastermindStateMap[ev.eventType]) {
    return {
      ...old,
      mastermindState: mastermindStateMap[ev.eventType],
      reviewReady: ev.eventType === 'OrchestrationComplete' ? true : old.reviewReady,
    }
  }

  if (ev.eventType === 'WinnerSelected') {
    const sectionId = (ev.entityId as string).replace('-lead', '')
    const selectedWinnerId = ev.payload?.selectedWinnerId as string | undefined
    if (!selectedWinnerId) return old

    return {
      ...old,
      sections: old.sections.map(section => {
        if (section.id !== sectionId) return section

        return {
          ...section,
          awaitingUserApproval: false,
          selectionStatus: 'selected',
          selectedWinnerWorkerId: selectedWinnerId,
          workers: section.workers.map(worker => ({
            ...worker,
            isSelected: worker.id === selectedWinnerId,
            canBeSelected: worker.state === 'done' && worker.id !== selectedWinnerId,
          })),
        }
      }),
    }
  }

  if (ev.eventType === 'LaneMergeCompleted') {
    const sectionId = (ev.entityId as string).replace('-lead', '')
    return {
      ...old,
      sections: old.sections.map(section =>
        section.id === sectionId ? { ...section, selectionStatus: 'lane_merged' } : section
      ),
    }
  }

  if (ev.eventType === 'LeadDelegated') {
    const sectionId = ev.payload?.sectionId as string
    const exists = old.sections.some(s => s.id === sectionId)
    return {
      ...old,
      mastermindState: 'monitoring',
      sections: exists
        ? old.sections
        : [
            ...old.sections,
            {
              id: sectionId,
              state: 'idle',
              proposedWinnerWorkerId: null,
              selectedWinnerWorkerId: null,
              selectionStatus: 'waiting_for_review',
              awaitingUserApproval: false,
              workers: [],
            },
          ],
    }
  }

  return old
}

export function useOrchestration() {
  const qc = useQueryClient()
  const query = useQuery<OrchState>({
    queryKey: ['orchestration'],
    queryFn: () => fetch(`${API}/api/orchestration`).then(r => r.json()),
    refetchInterval: 2000,
  })
  useEffect(() => {
    orcWs.connect()
    const unsub = orcWs.subscribe(ev => {
      qc.setQueryData<OrchState>(['orchestration'], old => applyEvent(old, ev))
    })
    return () => { unsub(); orcWs.disconnect() }
  }, [qc])
  return query
}
