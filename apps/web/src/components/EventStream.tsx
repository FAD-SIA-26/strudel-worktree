'use client'
import { useEffect, useRef, useState } from 'react'
import { orcWs } from '../ws/client'

export function EventStream() {
  const [events, setEvents] = useState<Array<{ ts: number; type: string; id: string }>>([])
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const unsub = orcWs.subscribe((e: any) => {
      setEvents(p => [...p.slice(-99), { ts: e.ts, type: e.eventType, id: e.entityId }])
    })
    return unsub
  }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])
  const C: Record<string, string> = {
    WorkerDone: 'text-green-400', WorkerFailed: 'text-red-400', WorkerStalled: 'text-yellow-400',
    WorkerZombie: 'text-red-400', LeadDone: 'text-green-300', ReviewComplete: 'text-blue-300',
    MergeConflict: 'text-orange-400', OrchestrationComplete: 'text-green-200 font-bold',
  }
  return (
    <div className="p-3 overflow-y-auto">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">EVENTS</div>
      {events.map((e, i) => (
        <div key={i} className={`text-[10px] font-mono flex gap-2 ${C[e.type] ?? 'text-gray-500'}`}>
          <span className="text-gray-600">{new Date(e.ts).toLocaleTimeString()}</span>
          <span>{e.id}</span><span>{e.type}</span>
        </div>
      ))}
      <div ref={bottom} />
    </div>
  )
}
