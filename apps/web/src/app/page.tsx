"use client";
import { useState } from "react";
import { DetailPanel } from "../components/DetailPanel";
import { EventStream } from "../components/EventStream";
import { TreePanel } from "../components/TreePanel";
import { useOrchestration } from "../hooks/useOrchestration";

const STATE_DOT: Record<string, string> = {
  idle: "bg-gray-600",
  planning: "bg-violet-400 animate-pulse",
  running: "bg-blue-400 animate-pulse",
  reviewing: "bg-amber-400 animate-pulse",
  merging: "bg-orange-400 animate-pulse",
  done: "bg-emerald-400",
  failed: "bg-red-500",
};

export default function Page() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useOrchestration();
  const mState = data?.mastermindState ?? "idle";

  return (
    <div className="h-screen flex flex-col bg-[#070a0e] overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-10 border-b border-[#1c2738] bg-[#0b0e14] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-indigo-400 font-bold text-xs tracking-widest select-none">
            &#11041; ORC
          </span>
          <div className="w-px h-4 bg-[#1c2738]" />
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT[mState] ?? "bg-gray-600"}`}
            />
            <span className="text-[10px] text-gray-500 font-mono">
              {mState}
            </span>
          </div>
          {data?.runId && (
            <span className="text-[10px] text-gray-700 font-mono truncate ml-1">
              · {data.runId}
            </span>
          )}
        </div>
        <span className="text-[9px] text-gray-700 flex-shrink-0 hidden sm:block">
          Select entity → view plan / logs / preview
        </span>
      </header>

      {/* 3-panel layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Tree */}
        <aside className="w-56 border-r border-[#1c2738] overflow-y-auto overflow-x-hidden flex-shrink-0">
          <TreePanel state={data} selected={selected} onSelect={setSelected} />
        </aside>

        {/* Center: Detail */}
        <main className="flex-1 overflow-hidden min-w-0">
          <DetailPanel selectedId={selected} sections={data?.sections ?? []} />
        </main>

        {/* Right: Events */}
        <aside className="w-56 border-l border-[#1c2738] overflow-y-auto overflow-x-hidden flex-shrink-0">
          <EventStream />
        </aside>
      </div>
    </div>
  );
}
