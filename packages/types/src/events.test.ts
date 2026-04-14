import { describe, expect, it } from "vitest";
import { OrcEventSchema } from "./events";

describe("OrcEventSchema", () => {
  it("parses WorkerDone", () => {
    expect(
      OrcEventSchema.parse({
        entityId: "rhythm-v1",
        entityType: "worker",
        eventType: "WorkerDone",
        sequence: 1,
        ts: 1,
        payload: { branch: "feat/rhythm-v1", diff: "+x" },
      }).entityId,
    ).toBe("rhythm-v1");
  });
  it("rejects unknown eventType", () => {
    expect(() =>
      OrcEventSchema.parse({
        entityId: "x",
        entityType: "worker",
        eventType: "NoSuchEvent",
        sequence: 1,
        ts: 1,
        payload: {},
      }),
    ).toThrow();
  });
});
