"use client";
import type { OrcEvent } from "@orc/types";
import { useEffect, useRef, useState } from "react";
import { orcWs } from "../ws/client";

const EVENT_CFG: Record<
  string,
  { bg: string; dot: string; label: string; short: string }
> = {
  WorkerDone: {
    bg: "bg-emerald-500/8",
    dot: "bg-emerald-400",
    label: "text-emerald-400",
    short: "DONE",
  },
  WorkerFailed: {
    bg: "bg-red-500/8",
    dot: "bg-red-500",
    label: "text-red-400",
    short: "FAIL",
  },
  WorkerStalled: {
    bg: "bg-amber-500/8",
    dot: "bg-amber-400",
    label: "text-amber-400",
    short: "STALL",
  },
  WorkerZombie: {
    bg: "bg-red-500/8",
    dot: "bg-red-500",
    label: "text-red-400",
    short: "DEAD",
  },
  LeadDone: {
    bg: "bg-emerald-500/8",
    dot: "bg-emerald-300",
    label: "text-emerald-300",
    short: "LEAD",
  },
  ReviewComplete: {
    bg: "bg-blue-500/8",
    dot: "bg-blue-400",
    label: "text-blue-400",
    short: "REV",
  },
  MergeConflict: {
    bg: "bg-orange-500/8",
    dot: "bg-orange-400",
    label: "text-orange-400",
    short: "CONF",
  },
  OrchestrationComplete: {
    bg: "bg-emerald-500/12",
    dot: "bg-emerald-200",
    label: "text-emerald-200",
    short: "ORC",
  },
};

export function EventStream() {
  const [events, setEvents] = useState<
    Array<{ key: string; ts: number; type: string; id: string }>
  >([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = orcWs.subscribe((e: OrcEvent) => {
      setEvents((p) => [
        ...p.slice(-99),
        {
          key: `${e.entityId}-${e.eventType}-${e.sequence}-${e.ts}`,
          ts: e.ts,
          type: e.eventType,
          id: e.entityId,
        },
      ]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  });

  return (
    <div className="p-2 overflow-x-hidden">
      <div className="px-2 pt-2 pb-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.15em]">
            Events
          </span>
          {events.length > 0 && (
            <span className="text-[9px] text-gray-700 font-mono">
              {events.length}
            </span>
          )}
        </div>
      </div>

      {events.length === 0 && (
        <div className="px-2 py-4 text-[10px] text-gray-700 text-center italic">
          Waiting for events…
        </div>
      )}

      <div className="space-y-0.5">
        {events.map((e) => {
          const cfg = EVENT_CFG[e.type] ?? {
            bg: "",
            dot: "bg-gray-500",
            label: "text-gray-500",
            short: e.type.slice(0, 4).toUpperCase(),
          };
          return (
            <div
              key={e.key}
              className={`px-2 py-1.5 rounded space-y-0.5 ${cfg.bg}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`}
                />
                <span
                  className={`text-[9px] font-bold tracking-wide flex-shrink-0 ${cfg.label}`}
                >
                  {cfg.short}
                </span>
                <span className="text-[9px] text-gray-700 ml-auto flex-shrink-0 font-mono">
                  {new Date(e.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              <div
                className="font-mono text-[9px] text-gray-500 truncate pl-3"
                title={e.id}
              >
                {e.id}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={bottom} />
    </div>
  );
}
