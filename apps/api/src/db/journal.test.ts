import type { OrcEvent } from "@orc/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getEventsSince, writeEvent } from "./journal";

describe("journal", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  it("appends and retrieves an event", () => {
    writeEvent(
      db,
      {
        entityId: "rhythm-v1",
        entityType: "worker",
        eventType: "WorkerDone",
        sequence: 1,
        ts: Date.now(),
        payload: { branch: "feat/rhythm-v1", diff: "+x" },
      },
      () => {},
    );
    expect(getEventsSince(db, 0)).toHaveLength(1);
  });

  it("rejects duplicate (entityId, sequence)", () => {
    const e: OrcEvent = {
      entityId: "w1",
      entityType: "worker",
      eventType: "WorkerDone",
      sequence: 1,
      ts: 1,
      payload: { branch: "b", diff: "d" },
    };
    writeEvent(db, e, () => {});
    expect(() => writeEvent(db, e, () => {})).toThrow();
  });
});
