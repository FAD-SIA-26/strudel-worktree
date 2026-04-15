import type { OrcEvent } from "@orc/types";
import { afterAll, describe, expect, it } from "vitest";
import { MockAgent } from "./agents/mock";
import { createTestDb } from "./db/client";
import { eventBus } from "./events/eventBus";
import { ConcurrencyGovernor } from "./orchestrator/concurrency";
import { MastermindStateMachine } from "./orchestrator/mastermind";
import { cleanupTestRepo, initTestRepo } from "./test-helpers/initTestRepo";

let repoDir: string;
afterAll(() => cleanupTestRepo(repoDir));

describe("Full orchestration (MockAgent)", () => {
  it("5-lane Strudel template: drums+bass parallel, chords after bass, melody after chords, arrangement last", async () => {
    repoDir = initTestRepo("integration");
    const db = createTestDb();
    const gov = new ConcurrencyGovernor(4);
    const emitted: string[] = [];
    const leadDoneOrder: string[] = [];
    const handler = (e: OrcEvent) => {
      emitted.push(e.eventType);
      if (e.eventType === "LeadDone")
        leadDoneOrder.push(e.payload?.sectionId ?? e.entityId);
    };
    eventBus.on("event", handler);

    const m = new MastermindStateMachine({
      repoRoot: repoDir,
      db,
      governor: gov,
      runId: "int-run",
      baseBranch: "main",
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: "done" }),
      llmCall: async (p) => {
        if (p.includes("Decompose"))
          return JSON.stringify([
            {
              id: "drums",
              goal: "Write drum pattern",
              numWorkers: 1,
              dependsOn: [],
            },
            {
              id: "bass",
              goal: "Write bass line",
              numWorkers: 1,
              dependsOn: [],
            },
            {
              id: "chords",
              goal: "Write chord pattern",
              numWorkers: 1,
              dependsOn: ["bass"],
            },
            {
              id: "melody",
              goal: "Write lead melody",
              numWorkers: 1,
              dependsOn: ["chords"],
            },
            {
              id: "arrangement",
              goal: "Write final arrangement",
              numWorkers: 1,
              dependsOn: ["drums", "bass", "chords", "melody"],
            },
          ]);
        if (p.includes("Generate")) return JSON.stringify(["write it"]);
        const match = p.match(/([\w-]+-v1)/);
        return JSON.stringify({
          winnerId: match?.[1] ?? "drums-v1",
          reasoning: "only one",
        });
      },
    });

    const result = await m.run({ userGoal: "Build lo-fi track" });
    eventBus.off("event", handler);

    expect(result.status).toBe("done");
    expect(emitted).toContain("WorkerDone");
    expect(emitted).toContain("ReviewComplete");
    expect(emitted).toContain("OrchestrationComplete");
    expect(leadDoneOrder.at(-1)).toBe("arrangement");
    expect(leadDoneOrder.indexOf("chords")).toBeGreaterThan(
      leadDoneOrder.indexOf("bass"),
    );
    expect(leadDoneOrder.indexOf("melody")).toBeGreaterThan(
      leadDoneOrder.indexOf("chords"),
    );
  }, 60_000);
});
