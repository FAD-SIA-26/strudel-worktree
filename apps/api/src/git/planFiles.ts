import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export async function createRunPlan(repoRoot: string, runId: string, opts: { userGoal: string; sections: string[] }): Promise<string> {
  const p = path.join(repoRoot, '.orc', 'runs', runId, 'run-plan.md')
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `# Run Plan — ${opts.userGoal}\n\n**Goal:** ${opts.userGoal}\n**Run ID:** ${runId}\n**Merge target:** run/${runId} → main\n\n## Sections\n${opts.sections.map(s => `- ${s}: queued`).join('\n')}\n\n## Success Criteria\n- [ ] all sections integrated\n- [ ] preview works\n`)
  return p
}

export async function createLeadPlan(repoRoot: string, runId: string, opts: { sectionId: string; sectionGoal: string; workerVariants: string[] }): Promise<string> {
  const p = path.join(repoRoot, '.orc', 'runs', runId, 'leads', `${opts.sectionId}.md`)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `# Lead Plan — ${opts.sectionId}\n\n**Goal:** ${opts.sectionGoal}\n\n## Worker Variants\n${opts.workerVariants.map((v, i) => `- ${opts.sectionId}-v${i + 1}: ${v}`).join('\n')}\n\n## Status\n${opts.workerVariants.map((_, i) => `- ${opts.sectionId}-v${i + 1}: queued`).join('\n')}\n`)
  return p
}

export async function createWorkerPlan(wtPath: string, opts: { workerId: string; objective: string; strategy: string; filesToChange?: string[] }): Promise<string> {
  const p = path.join(wtPath, '.orc', 'worker-plan.md')
  await fs.writeFile(p, `# Worker Plan — ${opts.workerId}\n\n**Objective:** ${opts.objective}\n**Strategy:** ${opts.strategy}\n\n## Checklist\n- [ ] inspect current structure\n- [ ] implement\n- [ ] validate\n- [ ] summarize\n\n## Files Likely To Change\n${(opts.filesToChange ?? ['(to be determined)']).map(f => `- ${f}`).join('\n')}\n\n## Progress Notes\n_empty_\n\n## Result Summary\n_pending_\n`)
  return p
}
