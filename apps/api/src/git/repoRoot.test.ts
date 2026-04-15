import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestRepo, initTestRepo } from "../test-helpers/initTestRepo";
import { findRepoRootSync, hasCommittedHeadSync } from "./worktree";

let repoDir = "";

afterEach(() => {
  if (repoDir) cleanupTestRepo(repoDir);
  repoDir = "";
});

describe("findRepoRootSync", () => {
  it("resolves the git root from a nested directory", () => {
    repoDir = initTestRepo("repo-root");
    const nestedDir = path.join(repoDir, "apps", "api");
    fs.mkdirSync(nestedDir, { recursive: true });

    expect(findRepoRootSync(nestedDir)).toBe(repoDir);
  });
});

describe("hasCommittedHeadSync", () => {
  it("returns true when the repository has an initial commit", () => {
    repoDir = initTestRepo("repo-root-head");

    expect(hasCommittedHeadSync(repoDir)).toBe(true);
  });

  it("returns false for an unborn HEAD", () => {
    repoDir = path.join(process.cwd(), ".tmp", `orc-unborn-${Date.now()}`);
    fs.mkdirSync(repoDir, { recursive: true });
    execSync("git init", { cwd: repoDir, stdio: "pipe" });

    expect(hasCommittedHeadSync(repoDir)).toBe(false);
  });
});
