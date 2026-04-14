'use client'
import type { WorkerInfo } from '@orc/types'

const COLORS: Record<string, string> = {
  queued: 'text-gray-400', spawning: 'text-blue-300', running: 'text-green-300',
  stalled: 'text-yellow-300', zombie: 'text-red-400', done: 'text-green-200', failed: 'text-red-300',
}

export function WorkerCard({ worker, selected, onSelect }: { worker: WorkerInfo; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button onClick={() => onSelect(worker.id)}
      className={`flex items-center gap-2 px-3 py-1 rounded text-xs w-full text-left ${selected ? 'ring-1 ring-blue-400 bg-gray-700' : 'hover:bg-gray-800'}`}>
      <span className={`font-mono ${COLORS[worker.state] ?? 'text-gray-400'}`}>{worker.state}</span>
      <span className="text-gray-300 font-mono">{worker.id}</span>
      {worker.previewUrl && (
        <a href={worker.previewUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="ml-auto text-blue-400 text-[10px] hover:underline">&#9654; preview</a>
      )}
    </button>
  )
}
