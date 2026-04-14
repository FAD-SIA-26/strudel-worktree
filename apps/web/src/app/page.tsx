'use client'
import { useState } from 'react'
import { useOrchestration } from '../hooks/useOrchestration'
import { TreePanel } from '../components/TreePanel'
import { DetailPanel } from '../components/DetailPanel'
import { EventStream } from '../components/EventStream'

export default function Page() {
  const [selected, setSelected] = useState<string | null>(null)
  const { data } = useOrchestration()

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm">&#11041; WorkTree Orchestrator</span>
        <span className="text-[10px] text-gray-500 ml-2">{data?.mastermindState ?? 'idle'}</span>
        <span className="ml-auto text-[10px] text-gray-600">
          Approve / Drop / Preview &rarr; action buttons &nbsp;&middot;&nbsp; NL steering &rarr; [POST-DEMO]
        </span>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-52 border-r border-gray-700 overflow-y-auto flex-shrink-0">
          <TreePanel state={data} selected={selected} onSelect={setSelected} />
        </div>
        <div className="flex-1 overflow-hidden">
          <DetailPanel selectedId={selected} sections={data?.sections ?? []} />
        </div>
        <div className="w-52 border-l border-gray-700 overflow-y-auto flex-shrink-0">
          <EventStream />
        </div>
      </div>
    </div>
  )
}
