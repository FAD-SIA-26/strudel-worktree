import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent } from "./mock";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("MockAgent", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-agent-test-"));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("basic behavior", () => {
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

  describe("file creation (Issue #1 fix)", () => {
    it("creates drums.js when section is drums", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "run-123-drums-v1",
        baseBranch: "main",
        entityId: "run-123-drums-v1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
      };
      const task = {
        id: "drums-v1",
        prompt: "Create drums pattern",
        maxRetries: 1,
        errorHistory: [],
      };

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      const result = await agent.run(task, ctx);

      expect(result.status).toBe("done");

      // Verify file was created
      const drumsPath = path.join(tempDir, "src", "drums.js");
      const fileExists = await fs
        .access(drumsPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const content = await fs.readFile(drumsPath, "utf-8");
      expect(content).toContain("export const drums");
      expect(content).toContain("setcpm(90 / 4)");
    });

    it("creates synth.js when section is synth", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "run-123-synth-v1",
        baseBranch: "main",
        entityId: "run-123-synth-v1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
      };
      const task = {
        id: "synth-v1",
        prompt: "Create synth bass line",
        maxRetries: 1,
        errorHistory: [],
      };

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      const result = await agent.run(task, ctx);

      expect(result.status).toBe("done");

      const synthPath = path.join(tempDir, "src", "synth.js");
      const fileExists = await fs
        .access(synthPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(synthPath, "utf-8");
      expect(content).toContain("export const synth");
      expect(content).toContain('s("supersaw")');
    });

    it("creates index.js when section is arrangement", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "run-123-arrangement-v1",
        baseBranch: "main",
        entityId: "run-123-arrangement-v1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
      };
      const task = {
        id: "arrangement-v1",
        prompt: "Create final arrangement",
        maxRetries: 1,
        errorHistory: [],
      };

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      const result = await agent.run(task, ctx);

      expect(result.status).toBe("done");

      const indexPath = path.join(tempDir, "src", "index.js");
      const fileExists = await fs
        .access(indexPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(indexPath, "utf-8");
      expect(content).toContain("import { drums }");
      expect(content).toContain("import { synth }");
      expect(content).toContain("stack(");
    });

    it("infers section from prompt when entityId is ambiguous", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "feat/test",
        baseBranch: "main",
        entityId: "worker-1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
      };
      const task = {
        id: "w1",
        prompt: "Create lead melody for the track",
        maxRetries: 1,
        errorHistory: [],
      };

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      await agent.run(task, ctx);

      const leadPath = path.join(tempDir, "src", "lead.js");
      const fileExists = await fs
        .access(leadPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      const content = await fs.readFile(leadPath, "utf-8");
      expect(content).toContain("export const lead");
    });

    it("creates src directory if it doesn't exist", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "run-123-chords-v1",
        baseBranch: "main",
        entityId: "run-123-chords-v1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
      };
      const task = {
        id: "chords-v1",
        prompt: "Create chord progression",
        maxRetries: 1,
        errorHistory: [],
      };

      // Ensure src doesn't exist
      const srcDir = path.join(tempDir, "src");
      const srcExists = await fs
        .access(srcDir)
        .then(() => true)
        .catch(() => false);
      expect(srcExists).toBe(false);

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      await agent.run(task, ctx);

      // Verify src was created
      const srcExistsAfter = await fs
        .access(srcDir)
        .then(() => true)
        .catch(() => false);
      expect(srcExistsAfter).toBe(true);

      // Verify file was created inside
      const chordsPath = path.join(srcDir, "chords.js");
      const fileExists = await fs
        .access(chordsPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });

    it("includes all known section templates", async () => {
      const sections = ["drums", "synth", "chords", "lead", "arp", "arrangement"];

      for (const section of sections) {
        const sectionTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), `mock-agent-${section}-`),
        );

        try {
          const ctx = {
            worktreePath: sectionTempDir,
            branch: `run-123-${section}-v1`,
            baseBranch: "main",
            entityId: `run-123-${section}-v1`,
            planPath: "",
            leadPlanPath: "",
            runPlanPath: "",
          };
          const task = {
            id: `${section}-v1`,
            prompt: `Create ${section}`,
            maxRetries: 1,
            errorHistory: [],
          };

          const agent = new MockAgent({ delayMs: 0, outcome: "done" });
          const result = await agent.run(task, ctx);

          expect(result.status).toBe("done");

          const expectedFile =
            section === "arrangement" ? "index.js" : `${section}.js`;
          const filePath = path.join(sectionTempDir, "src", expectedFile);
          const fileExists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false);

          expect(fileExists).toBe(
            true,
            `Expected ${expectedFile} to exist for section ${section}`,
          );
        } finally {
          await fs.rm(sectionTempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("heartbeat reporting", () => {
    it("reports file creation via heartbeat", async () => {
      const ctx = {
        worktreePath: tempDir,
        branch: "run-123-arp-v1",
        baseBranch: "main",
        entityId: "run-123-arp-v1",
        planPath: "",
        leadPlanPath: "",
        runPlanPath: "",
        onHeartbeat: async (hb: { ts?: number; output?: string }) => {
          if (hb.output?.includes("wrote template")) {
            expect(hb.output).toContain("src/arp.js");
          }
        },
      };
      const task = {
        id: "arp-v1",
        prompt: "Create arpeggio",
        maxRetries: 1,
        errorHistory: [],
      };

      const agent = new MockAgent({ delayMs: 0, outcome: "done" });
      await agent.run(task, ctx);
    });
  });
});
