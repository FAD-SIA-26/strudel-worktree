import { Router } from "express";
import { getSQLite } from "../db/client";
import { getAllTasks, getPreviews, getWorktrees } from "../db/queries";
import { launchPreview, stopPreview } from "../orchestrator/preview";
import type { AppDeps } from "./app";

export function createRoutes({ db, leadQueues }: AppDeps): Router {
  const r = Router();

  r.get("/orchestration", (_req, res) => {
    const tasks = getAllTasks(db);
    const worktrees = getWorktrees(db);
    const previews = getPreviews(db);
    const sections = tasks
      .filter((t) => t.type === "lead")
      .map((lead) => ({
        id: lead.id.replace("-lead", ""),
        state: lead.state,
        workers: tasks
          .filter((t) => t.type === "worker" && t.parentId === lead.id)
          .map((w) => {
            const wt = worktrees.find((x) => x.workerId === w.id);
            const prev = previews.find((p) => p.worktreeId === w.id);
            return {
              id: w.id,
              state: w.state,
              branch: wt?.branch,
              previewUrl: prev?.previewUrl,
            };
          }),
      }));
    res.json({
      runId: "current",
      mastermindState:
        tasks.find((t) => t.id === "mastermind")?.state ?? "idle",
      sections,
    });
  });

  r.get("/events", (_req, res) => {
    const sqlite = getSQLite(db);
    res.json({
      events: sqlite
        .prepare("SELECT * FROM event_log ORDER BY id DESC LIMIT 100")
        .all(),
    });
  });

  r.post("/approve", (req, res) => {
    const { workerId, leadId } = req.body;
    if (!workerId || !leadId) {
      res.status(400).json({ error: "workerId and leadId required" });
      return;
    }
    const q = leadQueues.get(leadId);
    if (q) {
      q.enqueue({ commandType: "ForceApprove", winnerId: workerId });
    }
    res.status(202).json({ ok: true });
  });

  r.post("/drop", (req, res) => {
    const { workerId, leadId } = req.body;
    if (!workerId || !leadId) {
      res.status(400).json({ error: "workerId and leadId required" });
      return;
    }
    const q = leadQueues.get(leadId);
    if (q) {
      q.enqueue({ commandType: "Abort", targetWorkerId: workerId });
    }
    res.status(202).json({ ok: true });
  });

  r.post("/preview/launch", async (req, res) => {
    const { worktreeId } = req.body;
    if (!worktreeId) {
      res.status(400).json({ error: "worktreeId required" });
      return;
    }
    const wts = getWorktrees(db);
    const wt = wts.find((x) => x.workerId === worktreeId);
    if (!wt) {
      res
        .status(404)
        .json({ error: `worktree not found for worker ${worktreeId}` });
      return;
    }
    const url = await launchPreview(db, worktreeId, wt.path);
    res.status(202).json({ previewUrl: url });
  });

  r.post("/preview/stop", (req, res) => {
    const { worktreeId } = req.body;
    if (!worktreeId) {
      res.status(400).json({ error: "worktreeId required" });
      return;
    }
    stopPreview(db, worktreeId);
    res.status(202).json({ ok: true });
  });

  r.post("/steer", (req, res) => {
    const { directive } = req.body;
    if (!directive) {
      res.status(400).json({ error: "directive required" });
      return;
    }
    console.log("[orc] steer directive (not routed):", directive);
    res.status(202).json({ ok: true, note: "NL routing is [POST-DEMO]" });
  });

  return r;
}
