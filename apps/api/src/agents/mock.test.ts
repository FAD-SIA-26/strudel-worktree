import { describe, expect, it } from "vitest";
import { MockAgent } from "./mock";

const ctx = {
  worktreePath: "/tmp/wt",
  branch: "feat/x",
  baseBranch: "main",
  entityId: "w1",
  planPath: "",
  leadPlanPath: "",
  runPlanPath: "",
};
const task = { id: "w1", prompt: "test", maxRetries: 1, errorHistory: [] };

describe("MockAgent", () => {
  it("returns done", async () => {
    const r = await new MockAgent({ delayMs: 0, outcome: "done" }).run(
      task,
      ctx,
    );
    expect(r.status).toBe("done");
    expect(r.branch).toBe("feat/x");
  });
  it("returns failed with retryable=true", async () => {
    const r = await new MockAgent({ delayMs: 0, outcome: "failed" }).run(
      task,
      ctx,
    );
    expect(r.status).toBe("failed");
    expect(r.retryable).toBe(true);
  });
});
