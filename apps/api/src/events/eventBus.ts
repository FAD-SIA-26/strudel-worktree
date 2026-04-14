import { EventEmitter } from "node:events";
import type { OrcEvent } from "@orc/types";

class OrcEventBus extends EventEmitter {
  /** Publish-only — NEVER use for command delivery */
  publish(event: OrcEvent): void {
    this.emit("event", event);
  }
}

export const eventBus = new OrcEventBus();
eventBus.setMaxListeners(200);
