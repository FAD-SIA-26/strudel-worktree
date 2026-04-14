import type { OrcEvent } from "@orc/types";
import { describe, expect, it, vi } from "vitest";
import { CommandQueue } from "./commandQueues";
import { eventBus } from "./eventBus";

describe("eventBus", () => {
  it("publishes to subscribers", () => {
    const fn = vi.fn();
    eventBus.on("event", fn);
    const e = {
      entityId: "w1",
      entityType: "worker",
      eventType: "WorkerDone",
      sequence: 1,
      ts: 1,
      payload: { branch: "b", diff: "d" },
    } as OrcEvent;
    eventBus.publish(e);
    expect(fn).toHaveBeenCalledWith(e);
    eventBus.off("event", fn);
  });
});

describe("CommandQueue", () => {
  it("FIFO order", async () => {
    const q = new CommandQueue<string>();
    q.enqueue("a");
    q.enqueue("b");
    expect(await q.dequeue()).toBe("a");
    expect(await q.dequeue()).toBe("b");
  });
  it("blocks until item available", async () => {
    const q = new CommandQueue<number>();
    const p = q.dequeue();
    q.enqueue(42);
    expect(await p).toBe(42);
  });
});
