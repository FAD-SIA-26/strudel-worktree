import type {
  WorkerAgent,
  WorkerContext,
  WorkerResult,
  WorkerTask,
} from "./types";

export class MockAgent implements WorkerAgent {
  private aborted = false;
  constructor(private opts: { delayMs: number; outcome: "done" | "failed" }) {}
  async run(_task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    await ctx.onHeartbeat?.({ ts: Date.now(), output: "mock agent started" });
    if (this.opts.delayMs > 0)
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.aborted)
      return {
        status: "failed",
        branch: ctx.branch,
        error: "aborted",
        retryable: false,
      };
    if (this.opts.outcome === "failed")
      return {
        status: "failed",
        branch: ctx.branch,
        error: "mock failure",
        retryable: true,
      };
    return {
      status: "done",
      branch: ctx.branch,
      diff: "+ mock diff",
      retryable: false,
    };
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
}
