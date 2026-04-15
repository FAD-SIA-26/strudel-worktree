import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveOrcAssetPath } from "../runtime/paths";

export type StrudelGenre =
  | "synthwave"
  | "lofi"
  | "house"
  | "electro"
  | "rock"
  | "pop"
  | "8bits";

export interface StrudelContract {
  ownedFile: string;
  exportName?: string;
  sectionId: string;
}

interface ExampleReference {
  genre: StrudelGenre;
  path: string;
  summary: string;
}

const MUSIC_GOAL_RE =
  /\b(track|song|beat|melody|chords|bass|drums|strudel|arrangement)\b/i;
const GENRE_PATTERNS: Array<{ genre: StrudelGenre; pattern: RegExp }> = [
  { genre: "synthwave", pattern: /\b(synthwave|retro wave|retrowave)\b/i },
  { genre: "lofi", pattern: /\b(lofi|lo-fi)\b/i },
  { genre: "house", pattern: /\bhouse\b/i },
  { genre: "electro", pattern: /\b(electro|techno|dnb|drum.?n.?bass)\b/i },
  { genre: "rock", pattern: /\brock\b/i },
  { genre: "pop", pattern: /\bpop\b/i },
  { genre: "8bits", pattern: /\b(8bit|8-bit|chiptune)\b/i },
];

const DOC_URLS = [
  "https://strudel.cc/learn/samples/",
  "https://strudel.cc/learn/synths/",
  "https://strudel.cc/learn/effects/",
] as const;

const SECTION_RULES: Record<string, string> = {
  arrangement:
    "Write only src/index.js. Import drums, bass, chords, and melody, then combine them with stack(...).",
  bass: "Favor a stable synth bass voice with restrained effects and clear low-end repetition.",
  chords:
    "Favor wide synth harmony with filter motion and spacious effects that support the lead.",
  drums:
    "Favor sample-driven drum programming with built-in samples or named banks. Keep the groove punchy and loopable.",
  melody:
    "Favor a synth lead or arpeggio voice, using built-in synth waveforms and tempo-synced effects.",
};

function isStrudelGoal(text: string): boolean {
  return MUSIC_GOAL_RE.test(text) || /Strudel\.js/i.test(text);
}

export function resolveStrudelGenre(goal: string): StrudelGenre {
  for (const { genre, pattern } of GENRE_PATTERNS) {
    if (pattern.test(goal)) return genre;
  }
  return isStrudelGoal(goal) ? "synthwave" : "synthwave";
}

export function buildStrudelTemplateParams(
  userGoal: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const genre = resolveStrudelGenre(userGoal);
  return {
    ...params,
    style: genre,
  };
}

async function loadSkillAsset(): Promise<string> {
  const skillPath = resolveOrcAssetPath(import.meta.url, "skills", "strudel-orc.md");
  if (!skillPath) return "";
  return fs.readFile(skillPath, "utf-8");
}

function summarizeExample(
  sectionId: string,
  relativePath: string,
  source: string,
): string {
  const lowerPath = relativePath.toLowerCase();
  const lowerSource = source.toLowerCase();

  if (sectionId === "arrangement") {
    return "Borrow the full-song structure, stacked layers, and transitions.";
  }
  if (sectionId === "drums") {
    return lowerSource.includes("bank(")
      ? "Borrow the drum patterning, sample-bank usage, and groove density."
      : "Borrow the kick/snare/hat phrasing and loopable groove structure.";
  }
  if (sectionId === "bass") {
    return "Borrow the bass motion, low-end repetition, and synth-voice choices.";
  }
  if (sectionId === "chords") {
    return "Borrow the pad/chord voicing, harmonic movement, and spatial effects.";
  }
  if (
    lowerPath.includes("arpeggio") ||
    lowerPath.includes("theme") ||
    lowerSource.includes("$lead") ||
    lowerSource.includes("$lead_arp") ||
    lowerSource.includes("$arp")
  ) {
    return "Steal the melodic contour, arp shape, synth timbre, and tempo-synced effects.";
  }
  return "Borrow the synthwave phrasing, instrument choices, and effect shaping.";
}

function scoreExample(sectionId: string, relativePath: string, source: string): number {
  const lowerPath = relativePath.toLowerCase();
  const lowerSource = source.toLowerCase();
  let score = 0;

  if (sectionId === "arrangement") {
    score += (source.match(/\$/g) ?? []).length;
    if (lowerPath.includes("whole-theme")) score += 20;
    if (lowerSource.includes("stack(")) score += 10;
    if (lowerSource.includes("$bass")) score += 4;
    if (lowerSource.includes("$chords")) score += 4;
    if (lowerSource.includes("$lead") || lowerSource.includes("$arp")) score += 4;
    return score;
  }

  const keywordGroups: Record<string, string[]> = {
    bass: ["bass", "synth_bass", "ostinato", "sub"],
    chords: ["chord", "chords", "pad", "brass", "openingpad"],
    drums: ["bd", "sd", "hh", "kick", "snare", "hat", "bank("],
    melody: ["lead", "arp", "arpeggio", "melody", "supersaw", "flute", "juice"],
  };
  for (const keyword of keywordGroups[sectionId] ?? []) {
    if (lowerPath.includes(keyword)) score += 6;
    if (lowerSource.includes(keyword)) score += 3;
  }
  if (sectionId === "melody" && lowerPath.includes("arpeggio")) score += 12;
  if (sectionId === "melody" && lowerPath.includes("theme")) score += 10;
  if (lowerSource.includes("sound(") || lowerSource.includes(".s(")) score += 1;
  return score;
}

async function loadGenreExamples(
  genre: StrudelGenre,
  sectionId: string,
): Promise<ExampleReference[]> {
  const genreDir = resolveOrcAssetPath(
    import.meta.url,
    "data",
    "strudel-examples",
    genre,
  );
  if (!genreDir) return [];
  const entries = await fs.readdir(genreDir);
  const references = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".js"))
      .sort()
      .map(async (entry) => {
        const relativePath = `data/strudel-examples/${genre}/${entry}`;
        const fullPath = path.join(genreDir, entry);
        const source = await fs.readFile(fullPath, "utf-8");
        return {
          genre,
          path: relativePath,
          score: scoreExample(sectionId, relativePath, source),
          summary: summarizeExample(sectionId, relativePath, source),
        };
      }),
  );
  const desiredCount = Math.min(Math.max(3, Math.min(5, references.length)), 4);
  return references
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, desiredCount)
    .map(({ genre: exampleGenre, path: examplePath, summary }) => ({
      genre: exampleGenre,
      path: examplePath,
      summary,
    }));
}

export async function buildStrudelPromptAppendix({
  sectionGoal,
  sectionId,
  userGoal,
}: {
  sectionGoal: string;
  sectionId: string;
  userGoal: string;
}): Promise<string> {
  if (!isStrudelGoal(sectionGoal) && !isStrudelGoal(userGoal)) return "";

  const genre = resolveStrudelGenre(userGoal);
  const skillText = (await loadSkillAsset()).trim();
  const examples = await loadGenreExamples(genre, sectionId);
  const docs = DOC_URLS.map((url) => `- ${url}`).join("\n");

  return [
    "## Strudel Skill Addendum",
    `Genre target: ${genre}`,
    `Section target: ${sectionId}`,
    SECTION_RULES[sectionId] ?? "Keep the section focused, loopable, and stylistically coherent.",
    "",
    "Repo examples are your primary creative reference. Study them first and reuse as much as possible before inventing new material.",
    "Use the docs only to understand or correctly apply instruments/effects suggested by the examples.",
    "",
    "Ranked repo examples:",
    ...examples.flatMap((example, index) => [
      `${index + 1}. ${example.path} (${example.genre})`,
      `What to borrow: ${example.summary}`,
    ]),
    "",
    "Reference docs:",
    docs,
    "",
    "Repo skill reference:",
    skillText,
    "",
    "Preserve the exact file ownership and export requirements from the task prompt.",
    `Current section brief: ${sectionGoal}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function inferStrudelContract(
  sectionId: string,
  prompt: string,
): StrudelContract | null {
  if (!isStrudelGoal(prompt)) return null;

  const ownedFileMatch = prompt.match(/Output to ([^\s]+) ONLY/i);
  const exportMatch = prompt.match(/export const (\w+)\s*=/i);
  if (sectionId === "arrangement") {
    if (!/src\/index\.js/i.test(prompt)) return null;
    return { ownedFile: "src/index.js", sectionId };
  }
  if (!ownedFileMatch || !exportMatch) return null;
  return {
    exportName: exportMatch[1],
    ownedFile: ownedFileMatch[1],
    sectionId,
  };
}

async function listChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const output = execFileSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      {
        cwd: worktreePath,
        encoding: "utf8",
      },
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((file) => !file.startsWith(".orc/"));
  } catch {
    const files: string[] = [];
    async function walk(dir: string, prefix = ""): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".orc") continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, rel);
        } else {
          files.push(rel);
        }
      }
    }
    await walk(worktreePath);
    return files.sort();
  }
}

export async function validateStrudelWorktree(
  worktreePath: string,
  contract: StrudelContract,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const changedFiles = await listChangedFiles(worktreePath);
  const unexpectedFiles = changedFiles.filter((file) => file !== contract.ownedFile);
  if (unexpectedFiles.length > 0) {
    return {
      ok: false,
      error: `Unexpected files changed: ${unexpectedFiles.join(", ")}`,
    };
  }

  const ownedFilePath = path.join(worktreePath, contract.ownedFile);
  let source = "";
  try {
    source = await fs.readFile(ownedFilePath, "utf-8");
  } catch {
    return {
      ok: false,
      error: `Missing required output file: ${contract.ownedFile}`,
    };
  }

  if (!source.trim()) {
    return { ok: false, error: "Strudel output must not be empty" };
  }

  if (contract.sectionId === "arrangement") {
    const requiredImports = [
      "import { drums }",
      "import { bass }",
      "import { chords }",
      "import { melody }",
    ];
    for (const requiredImport of requiredImports) {
      if (!source.includes(requiredImport)) {
        return {
          ok: false,
          error: `Arrangement must include ${requiredImport}`,
        };
      }
    }
    if (!source.includes("stack(")) {
      return { ok: false, error: "Arrangement must compose parts with stack(" };
    }
    return { ok: true };
  }

  if (contract.exportName) {
    const exportPattern = new RegExp(
      `export\\s+const\\s+${contract.exportName}\\s*=`,
      "m",
    );
    if (!exportPattern.test(source)) {
      return {
        ok: false,
        error: `Expected export const ${contract.exportName} = ... in ${contract.ownedFile}`,
      };
    }
  }

  return { ok: true };
}
