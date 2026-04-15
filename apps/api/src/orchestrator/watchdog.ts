import { EventEmitter } from "node:events";
import type { OrcEvent } from "@orc/types";
import { type Db, getSQLite } from "../db/client";
import { nextSeq, writeEvent } from "../db/journal";

export class Watchdog extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: {
      db: Db;
      intervalMs: number;
      stalledThresholdMs: number;
    },
  ) {
    super();
  }

  start(): void {
    this.timer = setInterval(() => this.poll(), this.cfg.intervalMs);
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    const now = Date.now();
    const cutoff = now - this.cfg.stalledThresholdMs;
    const sqlite = getSQLite(this.cfg.db);
    const workers = sqlite
      .prepare(`
      SELECT t.id, r.last_seen_at, r.pid
      FROM tasks t LEFT JOIN runs r ON r.entity_id = t.id
      WHERE t.type='worker' AND t.state='running'
    `)
      .all() as Array<{
      id: string;
      last_seen_at: number | null;
      pid: number | null;
    }>;

    for (const w of workers) {
      const lastSeen = w.last_seen_at ?? 0;
      if (lastSeen >= cutoff) {
        sqlite
          .prepare("UPDATE runs SET last_seen_at=? WHERE entity_id=?")
          .run(now, w.id);
        continue;
      }
      // If we have a pid, check whether the process is still running
      let pidAlive = false;
      if (w.pid) {
        try {
          process.kill(w.pid, 0);
          pidAlive = true;
        } catch {}
      }

      if (w.pid && pidAlive) {
        // Process is alive but not making progress — stalled
        sqlite
          .prepare("UPDATE tasks SET state='stalled', updated_at=? WHERE id=?")
          .run(now, w.id);
        writeEvent(
          this.cfg.db,
          {
            entityId: w.id,
            entityType: "worker",
            eventType: "WorkerStalled",
            sequence: nextSeq(w.id),
            ts: now,
            payload: { lastSeenAt: lastSeen },
          } as OrcEvent,
          () => {},
        );
        this.emit("WorkerStalled", w.id);
      } else if (w.pid && !pidAlive) {
        // Process registered a pid but is no longer running — zombie
        sqlite
          .prepare("UPDATE tasks SET state='zombie', updated_at=? WHERE id=?")
          .run(now, w.id);
        writeEvent(
          this.cfg.db,
          {
            entityId: w.id,
            entityType: "worker",
            eventType: "WorkerZombie",
            sequence: nextSeq(w.id),
            ts: now,
            payload: { pid: w.pid },
          } as OrcEvent,
          () => {},
        );
        this.emit("WorkerZombie", w.id);
      } else {
        // No pid registered — heartbeat timed out, mark stalled
        sqlite
          .prepare("UPDATE tasks SET state='stalled', updated_at=? WHERE id=?")
          .run(now, w.id);
        writeEvent(
          this.cfg.db,
          {
            entityId: w.id,
            entityType: "worker",
            eventType: "WorkerStalled",
            sequence: nextSeq(w.id),
            ts: now,
            payload: { lastSeenAt: lastSeen },
          } as OrcEvent,
          () => {},
        );
        this.emit("WorkerStalled", w.id);
      }
    }
  }
}
