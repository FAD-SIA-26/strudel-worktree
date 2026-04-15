import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, getWorktreeDiffMock, writeDoneMarkerMock, openMock } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    getWorktreeDiffMock: vi.fn(),
    writeDoneMarkerMock: vi.fn(),
    openMock: vi.fn(),
  }));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../git/worktree", () => ({
  getWorktreeDiff: getWorktreeDiffMock,
}));

vi.mock("../git/reconcile", () => ({
  writeDoneMarker: writeDoneMarkerMock,
}));

vi.mock("node:fs/promises", () => ({
  default: {},
  open: openMock,
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
}));

import { CodexCLIAdapter } from "./codex-cli";

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 4242;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe("CodexCLIAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete process.env.CODEX_THREAD_ID;
    delete process.env.CODEX_CI;
    spawnMock.mockReset();
    getWorktreeDiffMock.mockReset();
    writeDoneMarkerMock.mockReset();
    openMock.mockReset();
  });

  it("uses codex exec JSON mode and returns a successful result", async () => {
    process.env.CODEX_THREAD_ID = "thread-for-parent-session";
    process.env.CODEX_CI = "1";
    const proc = makeProc();
    spawnMock.mockReturnValue(proc);
    getWorktreeDiffMock.mockResolvedValue("+ diff");
    writeDoneMarkerMock.mockResolvedValue(undefined);

    const worktreePath = path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`);
    openMock.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const onHeartbeat = vi.fn();
    const onSessionLogOpened = vi.fn();

    const runPromise = new CodexCLIAdapter().run(
      { id: "w1", prompt: "do the thing", maxRetries: 1, errorHistory: [] },
      {
        worktreePath,
        branch: "feat/w1",
        baseBranch: "main",
        entityId: "w1",
        planPath: "worker-plan.md",
        leadPlanPath: "lead-plan.md",
        runPlanPath: "run-plan.md",
        domainSkillName: "strudel",
        domainSkillContent: "# Strudel contract\n- lane only\n",
        onHeartbeat,
        onSessionLogOpened,
      },
    );

    setImmediate(() => {
      proc.stdout.emit("data", Buffer.from("worker output\n"));
      proc.emit("close", 0);
    });

    const result = await runPromise;
    const prompt = spawnMock.mock.calls[0]?.[1]?.[3];

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        expect.stringContaining("do the thing"),
      ]),
      expect.objectContaining({
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.not.objectContaining({
          CODEX_THREAD_ID: expect.anything(),
          CODEX_CI: expect.anything(),
        }),
      }),
    );
    expect(prompt).toContain(
      "You are an ORC worker subagent running unattended inside a git worktree.",
    );
    expect(prompt).toContain("Do not ask the user questions");
    expect(prompt).toContain("Do not use brainstorming");
    expect(prompt).toContain(
      "Do not invoke process skills such as using-superpowers",
    );
    expect(prompt).toContain(
      "Do not run pnpm install, npm install, yarn install",
    );
    expect(prompt).toContain(
      "prefer package-local binaries like ./apps/web/node_modules/.bin/next",
    );
    expect(prompt).toContain("Update .orc/worker-plan.md");
    expect(prompt).toContain("Domain skill: strudel");
    expect(prompt).toContain("# Strudel contract");
    expect(onHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: expect.any(Number),
        output: "codex process started",
      }),
    );
    expect(onHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ output: "worker output\n" }),
    );
    expect(onSessionLogOpened).toHaveBeenCalledWith(
      path.join(worktreePath, ".orc", ".orc-session.jsonl"),
    );
    expect(result).toEqual({
      status: "done",
      branch: "feat/w1",
      diff: "+ diff",
      retryable: false,
    });
    delete process.env.CODEX_THREAD_ID;
    delete process.env.CODEX_CI;
  });

  it("omits domain skill prompt block when no domain skill content is provided", async () => {
    const proc = makeProc();
    spawnMock.mockReturnValue(proc);
    getWorktreeDiffMock.mockResolvedValue("+ diff");
    writeDoneMarkerMock.mockResolvedValue(undefined);

    const worktreePath = path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`);
    openMock.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const runPromise = new CodexCLIAdapter().run(
      { id: "w4", prompt: "do the thing", maxRetries: 1, errorHistory: [] },
      {
        worktreePath,
        branch: "feat/w4",
        baseBranch: "main",
        entityId: "w4",
        planPath: "worker-plan.md",
        leadPlanPath: "lead-plan.md",
        runPlanPath: "run-plan.md",
      },
    );

    setImmediate(() => {
      proc.stdout.emit("data", Buffer.from("worker output\n"));
      proc.emit("close", 0);
    });

    await runPromise;
    const prompt = spawnMock.mock.calls[0]?.[1]?.[3];
    expect(prompt).not.toContain("Domain skill:");
  });

  it("emits periodic heartbeats while codex is still running", async () => {
    vi.useFakeTimers();
    const proc = makeProc();
    spawnMock.mockReturnValue(proc);
    getWorktreeDiffMock.mockResolvedValue("+ diff");
    writeDoneMarkerMock.mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const onHeartbeat = vi.fn();
    const runPromise = new CodexCLIAdapter().run(
      { id: "w2", prompt: "keep going", maxRetries: 1, errorHistory: [] },
      {
        worktreePath: path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`),
        branch: "feat/w2",
        baseBranch: "main",
        entityId: "w2",
        planPath: "worker-plan.md",
        leadPlanPath: "lead-plan.md",
        runPlanPath: "run-plan.md",
        onHeartbeat,
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    proc.emit("close", 0);
    await runPromise;

    expect(onHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: expect.any(Number),
        output: "codex process started",
      }),
    );
    expect(onHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: expect.any(Number),
        ts: expect.any(Number),
      }),
    );
    expect(onHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces structured Codex error messages on failure", async () => {
    const proc = makeProc();
    spawnMock.mockReturnValue(proc);
    openMock.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const runPromise = new CodexCLIAdapter().run(
      {
        id: "w3",
        prompt: "fail meaningfully",
        maxRetries: 1,
        errorHistory: [],
      },
      {
        worktreePath: path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`),
        branch: "feat/w3",
        baseBranch: "main",
        entityId: "w3",
        planPath: "worker-plan.md",
        leadPlanPath: "lead-plan.md",
        runPlanPath: "run-plan.md",
      },
    );

    setImmediate(() => {
      proc.stderr.emit(
        "data",
        Buffer.from("Reading additional input from stdin...\n"),
      );
      proc.stdout.emit(
        "data",
        Buffer.from('{"type":"error","message":"You hit a usage limit."}\n'),
      );
      proc.emit("close", 1);
    });

    await expect(runPromise).resolves.toEqual({
      status: "failed",
      branch: "feat/w3",
      error:
        "exit code 1: Reading additional input from stdin...\nYou hit a usage limit.",
      retryable: true,
    });
  });
});
