import * as fs from "node:fs/promises";
import * as TOML from "toml";

export interface SectionTemplate {
  id: string;
  label: string;
  depends_on: string[];
  workers: number;
  prompt_hint: string;
}

export interface WorkflowTemplate {
  template: { name: string; version: string; description: string };
  sections: SectionTemplate[];
  params: Record<string, unknown>;
}

export async function loadTemplate(
  filePath: string,
): Promise<WorkflowTemplate> {
  return TOML.parse(await fs.readFile(filePath, "utf-8")) as WorkflowTemplate;
}

export function renderPromptHint(
  hint: string,
  params: Record<string, unknown>,
  sectionOutputs: Record<string, string>,
): string {
  let r = hint;
  for (const [k, v] of Object.entries(params))
    r = r.replaceAll(`{${k}}`, String(v));
  for (const [s, code] of Object.entries(sectionOutputs))
    r = r.replaceAll(`{${s}.winner_code}`, code);
  return r.trim();
}

export function topologicalSort(
  sections: SectionTemplate[],
): SectionTemplate[][] {
  const resolved = new Set<string>();
  const groups: SectionTemplate[][] = [];
  const remaining = [...sections];
  while (remaining.length > 0) {
    const batch = remaining.filter((s) =>
      s.depends_on.every((d) => resolved.has(d)),
    );
    if (batch.length === 0)
      throw new Error("Circular or unsatisfied dependency in template");
    groups.push(batch);
    for (const s of batch) {
      resolved.add(s.id);
      remaining.splice(remaining.indexOf(s), 1);
    }
  }
  return groups;
}
