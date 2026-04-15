"use client";
import type { OrchState } from "@orc/types";
import { useState } from "react";
import { WorkerCard } from "./WorkerCard";

const LEAD_BADGE: Record<string, string> = {
  idle: "text-gray-500  bg-gray-500/10  border-gray-500/20",
  planning: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  running: "text-blue-400   bg-blue-500/10   border-blue-500/20",
  reviewing: "text-amber-400  bg-amber-500/10  border-amber-500/20",
  merging: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  done: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  failed: "text-red-400    bg-red-500/10    border-red-500/20",
};

export function TreePanel({
  state,
  selected,
  onSelect,
}: {
  state: OrchState | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(new Set<string>());
  const toggle = (id: string) =>
    setOpen((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="p-2 space-y-0.5">
      {/* Panel label */}
      <div className="px-2 pt-2 pb-2.5">
        <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.15em]">
          Hierarchy
        </span>
      </div>

      {/* Mastermind */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-500/8 border border-indigo-500/20 mb-2">
        <span className="text-indigo-500 text-[10px] flex-shrink-0">◆</span>
        <span className="text-indigo-300 font-semibold text-[11px]">
          mastermind
        </span>
        <span
          className={`ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded border ${
            LEAD_BADGE[state?.mastermindState ?? "idle"] ?? LEAD_BADGE.idle
          }`}
        >
          {state?.mastermindState ?? "idle"}
        </span>
      </div>

      {/* Sections */}
      {(state?.sections ?? []).map((s) => {
        const isOpen = open.has(s.id);
        const leadId = `${s.id}-lead`;
        const isSelected = selected === leadId;
        return (
          <div key={s.id}>
            <button
              type="button"
              onClick={() => {
                toggle(s.id);
                onSelect(leadId);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded w-full text-left min-w-0 transition-colors ${
                isSelected
                  ? "bg-[#1f2a1a] ring-1 ring-yellow-500/30"
                  : "hover:bg-[#111825]"
              }`}
            >
              <span className="text-gray-600 text-[9px] flex-shrink-0 w-3">
                {isOpen ? "▾" : "▸"}
              </span>
              <span className="text-yellow-300/90 font-mono text-[11px] truncate flex-1 min-w-0">
                {s.id}
              </span>
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${
                  LEAD_BADGE[s.state] ?? LEAD_BADGE.idle
                }`}
              >
                {s.state}
              </span>
            </button>

            {isOpen && (
              <div className="ml-3 mt-0.5 mb-1 border-l border-[#1c2738] pl-1.5 space-y-0.5">
                {s.workers.map((w) => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    selected={selected === w.id}
                    onSelect={onSelect}
                  />
                ))}
                {s.workers.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-gray-700 italic">
                    No workers yet
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!state?.sections?.length && (
        <div className="px-3 py-6 text-[11px] text-gray-700 text-center">
          Awaiting sections…
        </div>
      )}
    </div>
  );
}
