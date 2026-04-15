import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateStrudelPreviewUrl } from "./preview";

describe("generateStrudelPreviewUrl", () => {
  it("uses the section id from namespaced worker ids", async () => {
    const worktreePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "orc-preview-"),
    );
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(worktreePath, "src", "drums.js"),
      'export const drums = sound("bd")\n',
    );

    const previewUrl = await generateStrudelPreviewUrl(
      worktreePath,
      "run-123-drums-v2",
    );

    expect(previewUrl).toContain("https://strudel.cc/#");
    expect(
      Buffer.from(previewUrl.split("#")[1] ?? "", "base64").toString("utf8"),
    ).toContain("export const drums");
  });

  it("falls back to src/index.js when it exists", async () => {
    const worktreePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "orc-preview-"),
    );
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(worktreePath, "src", "index.js"),
      'stack(sound("bd"))\n',
    );

    const previewUrl = await generateStrudelPreviewUrl(
      worktreePath,
      "run-123-arrangement-v1",
    );

    expect(
      Buffer.from(previewUrl.split("#")[1] ?? "", "base64").toString("utf8"),
    ).toContain('stack(sound("bd"))');
  });
});
