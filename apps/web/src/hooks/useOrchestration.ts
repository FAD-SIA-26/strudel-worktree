'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { orcWs } from '../ws/client'
import type { OrchState } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

function applyEvent(old: OrchState | undefined, ev: any): OrchState {
  if (!old) return { runId: 'current', mastermindState: 'idle', sections: [] }

  const workerStateMap: Record<string, string> = {
    WorkerDone: 'done', WorkerFailed: 'failed', WorkerStalled: 'stalled',
    WorkerZombie: 'zombie', WorkerRecovered: 'running', WorkerProgress: 'running',
  }
  if (workerStateMap[ev.eventType]) {
    return {
      ...old,
      sections: old.sections.map(s => ({
        ...s,
        workers: s.workers.map(w =>
          w.id === ev.entityId ? { ...w, state: workerStateMap[ev.eventType] } : w
        ),
      })),
    }
  }

  const leadStateMap: Record<string, string> = {
    LeadPlanReady: 'running', ReviewComplete: 'reviewing',
    MergeRequested: 'merging', LeadDone: 'done', LeadFailed: 'failed',
  }
  if (leadStateMap[ev.eventType]) {
    const sectionId = (ev.entityId as string).replace('-lead', '')
    return {
      ...old,
      sections: old.sections.map(s =>
        s.id === sectionId ? { ...s, state: leadStateMap[ev.eventType] } : s
      ),
    }
  }

  const mastermindStateMap: Record<string, string> = {
    PlanReady: 'delegating', OrchestrationComplete: 'done', OrchestrationFailed: 'failed',
  }
  if (mastermindStateMap[ev.eventType]) {
    return { ...old, mastermindState: mastermindStateMap[ev.eventType] }
  }

  if (ev.eventType === 'LeadDelegated') {
    const sectionId = ev.payload?.sectionId as string
    const exists = old.sections.some(s => s.id === sectionId)
    return {
      ...old,
      mastermindState: 'monitoring',
      sections: exists ? old.sections : [...old.sections, { id: sectionId, state: 'idle', workers: [] }],
    }
  }

  return old
}

export function useOrchestration() {
  const qc = useQueryClient()
  const query = useQuery<OrchState>({
    queryKey: ['orchestration'],
    queryFn: () => fetch(`${API}/api/orchestration`).then(r => r.json()),
    refetchInterval: false,
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
