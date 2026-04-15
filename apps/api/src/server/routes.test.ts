import type { OrcCommand } from "@orc/types";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestDb, getSQLite } from "../db/client";
import { upsertTask, upsertWorktree } from "../db/queries";
import { CommandQueue } from "../events/commandQueues";
import { createApp } from "./app";

describe("routes", () => {
  it("GET /api/orchestration returns sections array", async () => {
    const db = createTestDb();
    const app = createApp({ db, leadQueues: new Map() });
    const res = await request(app).get("/api/orchestration");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sections");
  });

  it("GET /api/orchestration includes workers and previews for each lead", async () => {
    const db = createTestDb();
    upsertTask(db, "mastermind", "mastermind", null, "monitoring");
    upsertTask(db, "main-lead", "lead", "mastermind", "running");
    upsertTask(db, "main-v1", "worker", "main-lead", "running");
    upsertWorktree(
      db,
      "main-v1",
      "main-v1",
      "/tmp/main-v1",
      "feat/main-v1",
      "main",
    );
    getSQLite(db)
      .prepare(`
        INSERT INTO previews(id, worktree_id, preview_url, status, launched_at)
        VALUES(?,?,?,?,?)
      `)
      .run(
        "preview-main-v1",
        "main-v1",
        "https://example.test/preview",
        "active",
        Date.now(),
      );

    const app = createApp({ db, leadQueues: new Map() });
    const res = await request(app).get("/api/orchestration");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      runId: "current",
      mastermindState: "monitoring",
      sections: [
        {
          id: "main",
          state: "running",
          workers: [
            {
              id: "main-v1",
              state: "running",
              branch: "feat/main-v1",
              previewUrl: "https://example.test/preview",
            },
          ],
        },
      ],
    });
  });

  it("GET / redirects to the dashboard when configured", async () => {
    const db = createTestDb();
    const app = createApp({
      db,
      leadQueues: new Map(),
      dashboardUrl: "http://localhost:3000",
    });

    const res = await request(app).get("/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000");
  });

  it("POST /api/approve enqueues ForceApprove to lead queue", async () => {
    const db = createTestDb();
    const leadQ = new CommandQueue<OrcCommand>();
    const leadQueues = new Map([["drums-lead", leadQ]]);
    const app = createApp({ db, leadQueues });
    const res = await request(app)
      .post("/api/approve")
      .send({ workerId: "drums-v1", leadId: "drums-lead" });
    expect(res.status).toBe(202);
    expect(leadQ.size).toBe(1);
  });
});
