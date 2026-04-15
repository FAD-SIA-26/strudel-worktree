"use client";
import type { WorkerInfo } from "@orc/types";

const STATE_CFG: Record<string, { dot: string; text: string }> = {
  queued: { dot: "bg-gray-500", text: "text-gray-500" },
  spawning: { dot: "bg-blue-400 animate-pulse", text: "text-blue-400" },
  running: { dot: "bg-blue-400 animate-pulse", text: "text-blue-400" },
  stalled: { dot: "bg-amber-400", text: "text-amber-400" },
  zombie: { dot: "bg-red-500", text: "text-red-400" },
  done: { dot: "bg-emerald-400", text: "text-emerald-400" },
  failed: { dot: "bg-red-500", text: "text-red-400" },
};

export function WorkerCard({
  worker,
  selected,
  onSelect,
}: {
  worker: WorkerInfo;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const cfg = STATE_CFG[worker.state] ?? {
    dot: "bg-gray-500",
    text: "text-gray-500",
  };
  return (
    <button
      type="button"
      onClick={() => onSelect(worker.id)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded w-full text-left min-w-0 transition-colors ${
        selected ? "bg-[#192030] ring-1 ring-blue-500/40" : "hover:bg-[#111825]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className="font-mono text-[11px] text-gray-300 truncate flex-1 min-w-0">
        {worker.id}
      </span>
      {worker.previewUrl && (
        <a
          href={worker.previewUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[9px] text-blue-500 hover:text-blue-400 flex-shrink-0 transition-colors"
          title="Open preview"
        >
          ↗
        </a>
      )}
    </button>
  );
}
