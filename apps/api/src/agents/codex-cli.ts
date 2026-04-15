import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeDoneMarker } from "../git/reconcile";
import { getWorktreeDiff } from "../git/worktree";
import type {
  WorkerAgent,
  WorkerContext,
  WorkerResult,
  WorkerTask,
} from "./types";

export class CodexCLIAdapter implements WorkerAgent {
  private proc: ReturnType<typeof spawn> | null = null;

  private buildChildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    env.CODEX_THREAD_ID = undefined;
    env.CODEX_CI = undefined;
    return env;
  }

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    const sessionPath = path.join(
      ctx.worktreePath,
      ".orc",
      ".orc-session.jsonl",
    );
    const session = await fs.open(sessionPath, "a");
    const prompt = [
      "You are an ORC worker subagent running unattended inside a git worktree.",
      "Execute the assigned implementation task directly.",
      "Do not ask the user questions, do not wait for approval, and do not offer options.",
      "Do not use brainstorming, design review, or any workflow that requires user back-and-forth.",
      "Do not invoke process skills such as using-superpowers, brainstorming, writing-plans, test-driven-development, or verification-before-completion.",
      "Do not stop after writing tests or scaffolding. Finish the actual feature.",
      "Do not run pnpm install, npm install, yarn install, or other dependency bootstrapping unless the task explicitly requires dependency changes.",
      "Inside a worktree, prefer package-local binaries like ./apps/web/node_modules/.bin/next or ./apps/api/node_modules/.bin/vitest instead of workspace package-manager commands.",
      "Read the provided plan files, make the code changes, validate them, and finish autonomously.",
      "Update .orc/worker-plan.md before finishing.",
      "",
      `Task: ${task.prompt}`,
      task.strategy ? `Approach: ${task.strategy}` : "",
      task.errorHistory.length
        ? `Prior failures:\n${task.errorHistory.join("\n")}`
        : "",
      `Your plan: ${ctx.planPath}`,
      `Lead plan: ${ctx.leadPlanPath}`,
      `Run plan: ${ctx.runPlanPath}`,
    ].join("\n");

    return new Promise<WorkerResult>((resolve) => {
      const failureDetails: string[] = [];
      let heartbeatTimer: NodeJS.Timeout | null = null;
      this.proc = spawn(
        "codex",
        [
          "exec",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          prompt,
        ],
        {
          cwd: ctx.worktreePath,
          env: this.buildChildEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      void ctx.onHeartbeat?.({
        pid: this.proc.pid,
        ts: Date.now(),
        output: "codex process started",
      });
      heartbeatTimer = setInterval(() => {
        void ctx.onHeartbeat?.({ pid: this.proc?.pid, ts: Date.now() });
      }, 5_000);

      const captureFailureDetails = (line: string) => {
        for (const rawLine of line.split("\n")) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === "error" && typeof parsed.message === "string") {
              failureDetails.push(parsed.message);
            }
            if (
              parsed.type === "turn.failed" &&
              typeof parsed.error?.message === "string"
            ) {
              failureDetails.push(parsed.error.message);
            }
          } catch {}
        }
      };

      this.proc.stdout?.on("data", async (chunk: Buffer) => {
        const line = chunk.toString();
        await session.write(
          `${JSON.stringify({ ts: Date.now(), output: line })}\n`,
        );
        captureFailureDetails(line);
        void ctx.onHeartbeat?.({
          pid: this.proc?.pid,
          output: line,
          ts: Date.now(),
        });
      });

      this.proc.stderr?.on("data", async (chunk: Buffer) => {
        const line = chunk.toString();
        if (line.trim()) failureDetails.push(line.trim());
        await session.write(
          `${JSON.stringify({ ts: Date.now(), error: line })}\n`,
        );
        void ctx.onHeartbeat?.({
          pid: this.proc?.pid,
          output: line,
          ts: Date.now(),
        });
      });

      const finish = async (code: number | null) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await session.close();
        const status = code === 0 ? ("done" as const) : ("failed" as const);
        await writeDoneMarker(ctx.worktreePath, {
          status,
          exitCode: code ?? 1,
          ts: Date.now(),
        });
        if (status === "done") {
          resolve({
            status: "done",
            branch: ctx.branch,
            diff: await getWorktreeDiff(ctx.worktreePath, ctx.baseBranch),
            retryable: false,
          });
        } else {
          const details = [
            ...new Set(
              failureDetails.map((line) => line.trim()).filter(Boolean),
            ),
          ].join("\n");
          resolve({
            status: "failed",
            branch: ctx.branch,
            error: details
              ? `exit code ${code}: ${details}`
              : `exit code ${code}`,
            retryable: true,
          });
        }
      };
      this.proc.on("close", finish);
      this.proc.on("error", async (err) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await session.close();
        resolve({
          status: "failed",
          branch: ctx.branch,
          error: err.message,
          retryable: true,
        });
      });
    });
  }

  async abort(): Promise<void> {
    this.proc?.kill("SIGTERM");
  }
}
