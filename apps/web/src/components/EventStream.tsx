"use client";
import type { OrcEvent } from "@orc/types";
import { useEffect, useRef, useState } from "react";
import { orcWs } from "../ws/client";
import { useToast } from "./ui/Toast";

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
  const [filter, setFilter] = useState<string>('all');
  const bottom = useRef<HTMLDivElement>(null);
  const { success, error, info } = useToast();

  useEffect(() => {
    const unsub = orcWs.subscribe((e: OrcEvent) => {
      const newEvent = {
        key: `${e.entityId}-${e.eventType}-${e.sequence}-${e.ts}`,
        ts: e.ts,
        type: e.eventType,
        id: e.entityId,
      };

      setEvents((p) => [...p.slice(-99), newEvent]);

      // Show toast notifications for important events
      if (e.eventType === 'WorkerDone') {
        success(`Worker completed: ${e.entityId.split('-').pop()}`);
      } else if (e.eventType === 'WorkerFailed') {
        error(`Worker failed: ${e.entityId}`);
      } else if (e.eventType === 'OrchestrationComplete') {
        success('🎉 Orchestration complete!');
      } else if (e.eventType === 'ReviewComplete') {
        info('Review ready for approval');
      }
    });
    return unsub;
  }, [success, error, info]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  });

  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => {
        if (filter === 'worker') return e.type.startsWith('Worker');
        if (filter === 'lead') return e.type.startsWith('Lead');
        if (filter === 'system') return e.type === 'OrchestrationComplete' || e.type === 'ReviewComplete';
        return true;
      });

  return (
    <div className="flex flex-col h-full bg-[var(--surface-hover)]">
      {/* Header with filter */}
      <div className="px-3 py-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Events
          </span>
          {events.length > 0 && (
            <span className="text-xs text-[var(--text-tertiary)] font-mono">
              {filteredEvents.length}/{events.length}
            </span>
          )}
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1">
          {['all', 'worker', 'lead', 'system'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                filter === f
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredEvents.length === 0 && (
          <div className="px-2 py-6 text-sm text-[var(--text-tertiary)] text-center italic">
            {events.length === 0 ? 'Waiting for events…' : 'No events match filter'}
          </div>
        )}

        <div className="space-y-1">
          {filteredEvents.map((e) => {
            const cfg = EVENT_CFG[e.type] ?? {
              bg: "bg-[var(--surface)]",
              dot: "bg-gray-500",
              label: "text-gray-500",
              short: e.type.slice(0, 4).toUpperCase(),
            };
            return (
              <div
                key={e.key}
                className={`px-2.5 py-2 rounded-lg space-y-1 ${cfg.bg} border border-transparent hover:border-[var(--border)] transition-all animate-slide-in`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`}
                  />
                  <span
                    className={`text-xs font-bold tracking-wide flex-shrink-0 ${cfg.label}`}
                  >
                    {cfg.short}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)] ml-auto flex-shrink-0 font-mono">
                    {new Date(e.ts).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className="font-mono text-xs text-[var(--text-secondary)] truncate pl-4"
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
    </div>
  );
}
