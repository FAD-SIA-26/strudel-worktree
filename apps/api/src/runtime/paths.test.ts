import { describe, expect, it } from "vitest";
import { getOrcPaths } from "./paths";

describe("getOrcPaths", () => {
  it("stores runtime state under .orc in the target repo", () => {
    const paths = getOrcPaths("/tmp/cow-site");

    expect(paths.stateDir).toBe("/tmp/cow-site/.orc");
    expect(paths.dbPath).toBe("/tmp/cow-site/.orc/orc.db");
    expect(paths.worktreesDir).toBe("/tmp/cow-site/.orc/worktrees");
    expect(paths.runsDir).toBe("/tmp/cow-site/.orc/runs");
  });
});
