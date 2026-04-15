import { execFile, execFileSync } from "node:child_process";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

function parsePorcelainStatusPaths(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[ MADRCU?!]{2} (.+)$/);
      if (!match?.[1]) return null;
      const rawPath = match[1];
      return rawPath.includes(" -> ")
        ? (rawPath.split(" -> ").at(-1)?.trim() ?? null)
        : rawPath.trim();
    })
    .filter((value): value is string => Boolean(value));
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
}
interface WorktreeOptions {
  hydrateDependencies?: boolean;
}

async function listDependencyDirs(repoRoot: string): Promise<string[]> {
  const relPaths = ["node_modules"];

  for (const parent of ["apps", "packages"]) {
    const parentDir = path.join(repoRoot, parent);
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      relPaths.push(path.join(parent, entry.name, "node_modules"));
    }
  }

  return relPaths;
}

async function symlinkDependencyDir(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  try {
    await fs.lstat(destPath);
    return;
  } catch {}

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const relativeSource = path.relative(path.dirname(destPath), sourcePath);
  await fs.symlink(relativeSource, destPath, "dir");
}

async function hydrateWorktreeDependencies(
  repoRoot: string,
  wtPath: string,
): Promise<void> {
  for (const relPath of await listDependencyDirs(repoRoot)) {
    const sourcePath = path.join(repoRoot, relPath);
    try {
      await fs.lstat(sourcePath);
    } catch {
      continue;
    }
    await symlinkDependencyDir(sourcePath, path.join(wtPath, relPath));
  }
}

/** Create a worktree on a NEW branch (branch must not exist yet) */
export async function createWorktree(
  repoRoot: string,
  wtPath: string,
  branch: string,
  opts: WorktreeOptions = {},
): Promise<void> {
  const resolved = path.resolve(wtPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await git(repoRoot, ["worktree", "add", "-b", branch, resolved, "HEAD"]);
  await fs.mkdir(path.join(resolved, ".orc"), { recursive: true });
  if (opts.hydrateDependencies !== false) {
    await hydrateWorktreeDependencies(repoRoot, resolved);
  }
}

/** Create a worktree for an EXISTING branch (no -b flag) */
export async function addWorktreeForBranch(
  repoRoot: string,
  wtPath: string,
  branch: string,
  opts: WorktreeOptions = {},
): Promise<void> {
  const resolved = path.resolve(wtPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await git(repoRoot, ["worktree", "add", resolved, branch]);
  await fs.mkdir(path.join(resolved, ".orc"), { recursive: true });
  if (opts.hydrateDependencies !== false) {
    await hydrateWorktreeDependencies(repoRoot, resolved);
  }
}

export async function removeWorktree(
  repoRoot: string,
  wtPath: string,
): Promise<void> {
  const resolved = path.resolve(wtPath);
  await git(repoRoot, ["worktree", "remove", "--force", resolved]);
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const out = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const result: WorktreeInfo[] = [];
  let cur: Partial<WorktreeInfo> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) cur.path = line.slice(9);
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch "))
      cur.branch = line.slice(7).replace("refs/heads/", "");
    else if (line === "" && cur.path) {
      result.push(cur as WorktreeInfo);
      cur = {};
    }
  }
  if (cur.path) result.push(cur as WorktreeInfo);
  return result;
}

export async function getWorktreeDiff(
  wtPath: string,
  baseBranch: string,
): Promise<string> {
  try {
    return await git(wtPath, ["diff", baseBranch, "--stat"]);
  } catch {
    return "";
  }
}

export async function hasUncommittedChanges(wtPath: string): Promise<boolean> {
  try {
    return (await git(wtPath, ["status", "--porcelain"])).length > 0;
  } catch {
    return false;
  }
}

export async function commitWorktreeChanges(
  wtPath: string,
  message: string,
): Promise<{ committed: boolean; sha?: string }> {
  const status = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: wtPath },
  )
    .then((result) => String(result.stdout))
    .catch(() => "");
  const changedPaths = parsePorcelainStatusPaths(status).filter(
    (line) => !line.startsWith(".orc/"),
  );

  if (changedPaths.length === 0) return { committed: false };

  await git(wtPath, ["add", "--", ...changedPaths]);
  await git(wtPath, [
    "-c",
    "user.name=ORC",
    "-c",
    "user.email=orc@local",
    "commit",
    "-m",
    message,
  ]);

  return { committed: true, sha: await git(wtPath, ["rev-parse", "HEAD"]) };
}

/** Create a branch at HEAD without switching the working tree — safe when run mid-orchestration */
export async function createBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await git(repoRoot, ["branch", branch]);
}

export function findRepoRootSync(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function hasCommittedHeadSync(repoRoot: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranchSync(repoRoot: string): string | null {
  try {
    const branch = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    return branch || null;
  } catch {
    return null;
  }
}

export function getHeadShaSync(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function getStatusEntriesSync(repoRoot: string): string[] {
  return parsePorcelainStatusPaths(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
}

export function applyRunBranchToCurrentBranchSync(
  repoRoot: string,
  opts: { expectedBranch: string; expectedHead: string; runBranch: string },
): { applied: boolean; reason?: string } {
  const currentBranch = getCurrentBranchSync(repoRoot);
  if (!currentBranch) {
    return { applied: false, reason: "repository is in detached HEAD state" };
  }
  if (currentBranch !== opts.expectedBranch) {
    return {
      applied: false,
      reason: `current branch changed from ${opts.expectedBranch} to ${currentBranch}`,
    };
  }

  const relevantChanges = getStatusEntriesSync(repoRoot).filter(
    (entry) => !entry.startsWith(".orc/"),
  );
  if (relevantChanges.length > 0) {
    return {
      applied: false,
      reason: `repository has local changes: ${relevantChanges.slice(0, 3).join(", ")}`,
    };
  }

  const currentHead = getHeadShaSync(repoRoot);
  if (currentHead !== opts.expectedHead) {
    return {
      applied: false,
      reason: `branch ${opts.expectedBranch} moved during the run (${opts.expectedHead.slice(0, 7)} -> ${currentHead.slice(0, 7)})`,
    };
  }

  try {
    execFileSync("git", ["merge", "--ff-only", opts.runBranch], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return { applied: true };
  } catch (error) {
    const err = error as Error & { stderr?: unknown };
    const stderr =
      typeof err.stderr === "string"
        ? err.stderr.trim()
        : Buffer.isBuffer(err.stderr)
          ? err.stderr.toString("utf8").trim()
          : "";
    return {
      applied: false,
      reason:
        stderr ||
        err.message ||
        `failed to fast-forward ${opts.expectedBranch}`,
    };
  }
}

/**
 * Merge sourceBranch into the worktree at targetWorktreePath.
 * The caller must pass a worktree that is already checked out to the target branch.
 * This never touches the main working directory.
 */
export async function mergeBranch(
  targetWorktreePath: string,
  sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  try {
    await git(targetWorktreePath, [
      "merge",
      sourceBranch,
      "--no-ff",
      "-m",
      `merge: ${sourceBranch}`,
    ]);
    return { success: true, conflictFiles: [] };
  } catch {
    const conflicts = await git(targetWorktreePath, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]).catch(() => "");
    await git(targetWorktreePath, ["merge", "--abort"]).catch(() => {});
    return {
      success: false,
      conflictFiles: conflicts.split("\n").filter(Boolean),
    };
  }
}
