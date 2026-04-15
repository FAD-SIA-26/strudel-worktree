import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildStrudelPromptAppendix,
  buildStrudelTemplateParams,
  resolveStrudelGenre,
  validateStrudelWorktree,
} from "./strudel";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orc-strudel-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  return dir;
}

describe("resolveStrudelGenre", () => {
  it("defaults generic music goals to synthwave", () => {
    expect(resolveStrudelGenre("create a song")).toBe("synthwave");
    expect(resolveStrudelGenre("build strudel track")).toBe("synthwave");
  });

  it("honors explicit genre mentions", () => {
    expect(resolveStrudelGenre("create lofi song")).toBe("lofi");
    expect(resolveStrudelGenre("make house beat")).toBe("house");
  });
});

describe("buildStrudelTemplateParams", () => {
  it("overrides template style from the user goal", () => {
    expect(
      buildStrudelTemplateParams("create synthwave song", {
        tempo: 90,
        key: "Dm",
        style: "lofi",
      }),
    ).toMatchObject({
      key: "Dm",
      style: "synthwave",
      tempo: 90,
    });

    expect(
      buildStrudelTemplateParams("create lofi song", {
        tempo: 90,
        key: "Dm",
        style: "synthwave",
      }),
    ).toMatchObject({
      style: "lofi",
    });
  });
});

describe("buildStrudelPromptAppendix", () => {
  it("makes repo examples the primary reference and docs secondary", async () => {
    const appendix = await buildStrudelPromptAppendix({
      sectionGoal:
        "Write a Strudel.js lead melody. Output to src/melody.js ONLY.",
      sectionId: "melody",
      userGoal: "create synthwave song",
    });

    expect(appendix).toContain("Genre target: synthwave");
    expect(appendix).toContain("Repo examples are your primary creative reference");
    expect(appendix).toContain(
      "Use the docs only to understand or correctly apply instruments/effects suggested by the examples",
    );
    expect(appendix).toContain("https://strudel.cc/learn/samples/");
    expect(appendix).toContain("https://strudel.cc/learn/synths/");
    expect(appendix).toContain("https://strudel.cc/learn/effects/");
    expect(appendix).toContain("Steal the melodic contour");
    expect(appendix).toContain("src/melody.js");
  });

  it("uses 3-5 synthwave examples for synthwave goals when available", async () => {
    const appendix = await buildStrudelPromptAppendix({
      sectionGoal:
        "Write a Strudel.js lead melody. Output to src/melody.js ONLY.",
      sectionId: "melody",
      userGoal: "create synthwave song",
    });

    const exampleMatches = appendix.match(
      /data\/strudel-examples\/synthwave\/[^\n]+/g,
    );
    expect(exampleMatches).not.toBeNull();
    expect(exampleMatches?.length).toBeGreaterThanOrEqual(3);
    expect(exampleMatches?.length).toBeLessThanOrEqual(5);
  });

  it("prefers arrangement-like examples for arrangement sections", async () => {
    const appendix = await buildStrudelPromptAppendix({
      sectionGoal: "Write src/index.js that imports and stacks all instruments.",
      sectionId: "arrangement",
      userGoal: "create synthwave song",
    });

    expect(appendix).toContain(
      "data/strudel-examples/synthwave/10-stranger-things-whole-theme.js",
    );
    expect(appendix).toContain(
      "Borrow the full-song structure, stacked layers, and transitions",
    );
  });
});

describe("validateStrudelWorktree", () => {
  it("accepts a valid melody worktree", async () => {
    const worktreePath = await makeTempWorktree();
    await fs.writeFile(
      path.join(worktreePath, "src", "melody.js"),
      "export const melody = note(\"c3 e3 g3\").sound(\"sawtooth\")\n",
    );

    await expect(
      validateStrudelWorktree(worktreePath, {
        exportName: "melody",
        ownedFile: "src/melody.js",
        sectionId: "melody",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects wrong exports and extra file edits", async () => {
    const worktreePath = await makeTempWorktree();
    await fs.writeFile(
      path.join(worktreePath, "src", "melody.js"),
      "export const lead = note(\"c3 e3 g3\")\n",
    );
    await fs.writeFile(path.join(worktreePath, "src", "bass.js"), "extra\n");

    await expect(
      validateStrudelWorktree(worktreePath, {
        exportName: "melody",
        ownedFile: "src/melody.js",
        sectionId: "melody",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Unexpected files changed"),
    });
  });

  it("rejects invalid arrangement files", async () => {
    const worktreePath = await makeTempWorktree();
    await fs.writeFile(
      path.join(worktreePath, "src", "index.js"),
      "import { drums } from './drums.js'\nexport const song = drums\n",
    );

    await expect(
      validateStrudelWorktree(worktreePath, {
        ownedFile: "src/index.js",
        sectionId: "arrangement",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/import \{ bass \}|stack\(/),
    });
  });
});
