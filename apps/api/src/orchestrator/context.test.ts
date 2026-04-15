import { describe, expect, it } from "vitest";
import { ContextManager } from "./context";

describe("ContextManager", () => {
  it("injects synthwave Strudel guidance into PM prompts", async () => {
    const ctx = new ContextManager(process.cwd());

    const prompt = await ctx.buildPMPrompt(
      "melody",
      "Write a Strudel.js lead melody. Output to src/melody.js ONLY.\nExport: export const melody = <pattern>",
      2,
      [],
      "create synthwave song",
    );

    expect(prompt).toContain("Genre target: synthwave");
    expect(prompt).toContain("Repo examples are your primary creative reference");
    expect(prompt).toContain(
      "Use the docs only to understand or correctly apply instruments/effects suggested by the examples",
    );
    expect(prompt).toContain("What to borrow:");
    expect(prompt).toContain(
      "data/strudel-examples/synthwave/10-stranger-things-whole-theme.js",
    );
    expect(prompt).toContain("https://strudel.cc/learn/samples/");
    expect(prompt).toContain("https://strudel.cc/learn/synths/");
    expect(prompt).toContain("https://strudel.cc/learn/effects/");
    expect(prompt).toContain("# Strudel ORC Reference");
  });
});
