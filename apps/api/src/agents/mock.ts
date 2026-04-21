import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  WorkerAgent,
  WorkerContext,
  WorkerResult,
  WorkerTask,
} from "./types";

/**
 * MockAgent now writes template Strudel code files to worktree
 * to prevent preview crashes when files don't exist.
 *
 * Fixes Issue #1: "MockAgent Creates No Files - Preview Crashes"
 */
export class MockAgent implements WorkerAgent {
  private aborted = false;
  constructor(private opts: { delayMs: number; outcome: "done" | "failed" }) {}

  /**
   * Infer section name from worker task context
   * Examples: "drums-v1" -> "drums", "synth-v2" -> "synth"
   */
  private inferSectionFromContext(task: WorkerTask, ctx: WorkerContext): string {
    // Try to extract from entityId first (e.g., "run-123-drums-v1" -> "drums")
    const entityMatch = ctx.entityId.match(/-([^-]+)-v\d+(?:-r\d+)?$/);
    if (entityMatch?.[1]) {
      return entityMatch[1];
    }

    // Fallback: try to extract from prompt (look for keywords)
    const promptLower = task.prompt.toLowerCase();
    const knownSections = ["drums", "synth", "chords", "lead", "arp", "arrangement"];
    for (const section of knownSections) {
      if (promptLower.includes(section)) {
        return section;
      }
    }

    // Last resort: extract from branch name or use generic
    const branchMatch = ctx.branch.match(/-([^-]+)-v\d+(?:-r\d+)?$/);
    if (branchMatch?.[1]) {
      return branchMatch[1];
    }

    return "generic";
  }

  /**
   * Generate template Strudel code based on section type
   */
  private generateTemplateCode(section: string): string {
    const templates: Record<string, string> = {
      drums: `setcpm(90 / 4);

export const drums = stack(
  s("bd:6").euclidLegato(3, 8).duckorbit(2).duckattack(0.25),
  s("sd:4").euclidLegacy(2, 8, 1),
  s("hh:1").euclidLegacy(6, 8).orbit(2).gain(0.5)
)._scope();
`,
      synth: `setcpm(90 / 4);

export const synth = note("f2 d2!6 d#2!3 d2!5 d1")
  .s("supersaw")
  .orbit(2)
  .lpf(500)
  .gain(0.8)
  ._pianoroll();
`,
      chords: `setcpm(90 / 4);

export const chords = note("<[a#3,a#4] [g3,g4] [d3,d4]@2>")
  .s("gm_synth_brass_2")
  .orbit(2)
  .trans(-12)
  .room(0.8)
  .rsize(4)
  ._pianoroll();
`,
      lead: `setcpm(90 / 4);

export const lead = note("<d4@0.75 f4@0.25 e4@0.5 a#4@0.25 a4@0.25 -@2>")
  .orbit(2)
  .s("gm_lead_8_bass_lead")
  .gain(0.6)
  .room(0.8)
  .rsize(6)
  ._pianoroll();
`,
      arp: `setcpm(90 / 4);

export const arp = note("<[d5 a5 a#5 d6]*4 [[d5 a5 a#5 f6] [d5 a5 a#5 e6]]*2>")
  .trans(-12)
  .s("sawtooth")
  .orbit(2)
  .distort(0.5)
  .lpenv(perlin.slow(3).range(1, 5))
  .lpf(perlin.slow(2).range(100, 3000))
  .gain(0.3)
  .room(0.8)
  .rsize(6)
  ._pianoroll();
`,
      arrangement: `import { drums } from './drums.js';
import { synth } from './synth.js';
import { chords } from './chords.js';
import { lead } from './lead.js';
import { arp } from './arp.js';

stack(
  drums,
  synth,
  chords,
  lead,
  arp
).slow(4)
 .room(0.5)
 .gain(0.9);
`,
      generic: `// Mock implementation
setcpm(90 / 4);

export const pattern = s("bd sd").fast(2);
`,
    };

    return templates[section] || templates.generic;
  }

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    await ctx.onHeartbeat?.({ ts: Date.now(), output: "mock agent started" });

    if (this.opts.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }

    if (this.aborted) {
      return {
        status: "failed",
        branch: ctx.branch,
        error: "aborted",
        retryable: false,
      };
    }

    if (this.opts.outcome === "failed") {
      return {
        status: "failed",
        branch: ctx.branch,
        error: "mock failure",
        retryable: true,
      };
    }

    // Write template files to worktree to support preview functionality
    try {
      const section = this.inferSectionFromContext(task, ctx);
      const srcDir = path.join(ctx.worktreePath, "src");

      // Ensure src directory exists
      await fs.mkdir(srcDir, { recursive: true });

      // Determine output filename based on section
      const filename = section === "arrangement" ? "index.js" : `${section}.js`;
      const filePath = path.join(srcDir, filename);

      // Generate and write template code
      const templateCode = this.generateTemplateCode(section);
      await fs.writeFile(filePath, templateCode, "utf-8");

      await ctx.onHeartbeat?.({
        ts: Date.now(),
        output: `mock agent wrote template to src/${filename}`,
      });

      return {
        status: "done",
        branch: ctx.branch,
        diff: `+ ${filePath}\n+ ${templateCode.split("\n").length} lines`,
        retryable: false,
      };
    } catch (error) {
      // If file writing fails, still return success but with a note
      return {
        status: "done",
        branch: ctx.branch,
        diff: `+ mock diff (file write skipped: ${error instanceof Error ? error.message : String(error)})`,
        retryable: false,
      };
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }
}
