# Strudel Worker Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-only `--skill strudel` runtime contract that auto-selects the Strudel template, injects Strudel guidance into worker prompts, and passes real upstream winner code into downstream Strudel workers.

**Architecture:** Keep ORC generic by adding a small runtime resolver for domain skills and by threading optional `skillName` / `skillContent` through the existing `cli -> mastermind -> lead -> worker -> codex` pipeline. Reuse a shared source-file helper for both preview generation and dependency-context prompt building so Strudel code lookup stays in one place.

**Tech Stack:** TypeScript, Vitest, NodeNext ESM modules, Commander, existing ORC orchestrator/runtime code

---

## File Map

- Create: `apps/api/src/orchestrator/domainSkill.ts`
- Create: `apps/api/src/orchestrator/domainSkill.test.ts`
- Create: `apps/api/src/orchestrator/workerSource.ts`
- Create: `apps/api/src/orchestrator/workerSource.test.ts`
- Create: `skills/domains/strudel.md`
- Modify: `apps/api/src/cli.ts`
- Modify: `apps/api/src/agents/types.ts`
- Modify: `apps/api/src/agents/codex-cli.ts`
- Modify: `apps/api/src/agents/codex-cli.test.ts`
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Modify: `apps/api/src/orchestrator/mastermind.test.ts`
- Modify: `apps/api/src/orchestrator/lead.ts`
- Modify: `apps/api/src/orchestrator/worker.ts`
- Modify: `apps/api/src/orchestrator/preview.ts`
- Modify: `README.md`

### Task 1: Domain Skill and Template Resolution

**Files:**
- Create: `apps/api/src/orchestrator/domainSkill.ts`
- Test: `apps/api/src/orchestrator/domainSkill.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

```ts
// apps/api/src/orchestrator/domainSkill.test.ts
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveDomainSkill, resolveTemplateSelection } from './domainSkill'

async function makeRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-domain-skill-'))
  await fs.mkdir(path.join(repoRoot, 'skills', 'domains'), { recursive: true })
  await fs.mkdir(path.join(repoRoot, 'templates'), { recursive: true })
  await fs.writeFile(path.join(repoRoot, 'skills', 'domains', 'strudel.md'), '# Strudel\n- stay in lane\n')
  await fs.writeFile(path.join(repoRoot, 'templates', 'strudel-track.toml'), '[template]\nname = "strudel-track"\nversion = "1.0"\ndescription = "demo"\n')
  await fs.writeFile(path.join(repoRoot, 'templates', 'explicit.toml'), '[template]\nname = "explicit"\nversion = "1.0"\ndescription = "demo"\n')
  return repoRoot
}

describe('domainSkill', () => {
  it('loads the strudel skill file and its default template', async () => {
    const repoRoot = await makeRepo()

    await expect(resolveDomainSkill(repoRoot, 'strudel')).resolves.toMatchObject({
      name: 'strudel',
      defaultTemplateName: 'strudel-track',
      filePath: path.join(repoRoot, 'skills', 'domains', 'strudel.md'),
      content: '# Strudel\n- stay in lane\n',
    })
  })

  it('prefers explicit template over skill default over goal auto-detect', async () => {
    const repoRoot = await makeRepo()

    await expect(resolveTemplateSelection({
      repoRoot,
      userGoal: 'lo-fi beat',
      explicitTemplateName: 'explicit',
      skillName: 'strudel',
    })).resolves.toBe(path.join(repoRoot, 'templates', 'explicit.toml'))

    await expect(resolveTemplateSelection({
      repoRoot,
      userGoal: 'lo-fi beat',
      skillName: 'strudel',
    })).resolves.toBe(path.join(repoRoot, 'templates', 'strudel-track.toml'))
  })

  it('rejects unknown skills before the run starts', async () => {
    const repoRoot = await makeRepo()
    await expect(resolveDomainSkill(repoRoot, 'nope')).rejects.toThrow('Unknown skill "nope"')
  })
})
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/orchestrator/domainSkill.test.ts
```

Expected: FAIL with module-not-found errors for `./domainSkill` and missing exported symbols.

- [ ] **Step 3: Implement the resolver and template-selection helper**

```ts
// apps/api/src/orchestrator/domainSkill.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const DOMAIN_SKILLS = {
  strudel: {
    relativePath: path.join('skills', 'domains', 'strudel.md'),
    defaultTemplateName: 'strudel-track',
  },
} as const

export type DomainSkillName = keyof typeof DOMAIN_SKILLS

export interface ResolvedDomainSkill {
  name: DomainSkillName
  filePath: string
  content: string
  defaultTemplateName: string
}

function autoDetectTemplateName(userGoal: string): string | undefined {
  return /\b(track|song|beat|melody|chords|bass|drums|strudel|arrangement)\b/i.test(userGoal)
    ? 'strudel-track'
    : undefined
}

export async function resolveDomainSkill(repoRoot: string, skillName?: string): Promise<ResolvedDomainSkill | null> {
  if (!skillName) return null

  const record = DOMAIN_SKILLS[skillName as DomainSkillName]
  if (!record) {
    throw new Error(`Unknown skill "${skillName}". Supported skills: ${Object.keys(DOMAIN_SKILLS).join(', ')}`)
  }

  const filePath = path.join(repoRoot, record.relativePath)
  const content = await fs.readFile(filePath, 'utf8')

  return {
    name: skillName as DomainSkillName,
    filePath,
    content,
    defaultTemplateName: record.defaultTemplateName,
  }
}

export async function resolveTemplateSelection(opts: {
  repoRoot: string
  userGoal: string
  explicitTemplateName?: string
  skillName?: string
}): Promise<string | undefined> {
  const skill = await resolveDomainSkill(opts.repoRoot, opts.skillName)
  const templateName = opts.explicitTemplateName
    ?? skill?.defaultTemplateName
    ?? autoDetectTemplateName(opts.userGoal)

  if (!templateName) return undefined
  return path.join(opts.repoRoot, 'templates', `${templateName}.toml`)
}
```

- [ ] **Step 4: Re-run the resolver test and verify it passes**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/orchestrator/domainSkill.test.ts
```

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the resolver slice**

```bash
cd /home/cbosle/hackatons/strudel-worktree
git add apps/api/src/orchestrator/domainSkill.ts apps/api/src/orchestrator/domainSkill.test.ts
git commit -m "feat: add domain skill resolution"
```

### Task 2: CLI Wiring and Worker Skill Injection

**Files:**
- Modify: `apps/api/src/cli.ts`
- Modify: `apps/api/src/agents/types.ts`
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Modify: `apps/api/src/orchestrator/lead.ts`
- Modify: `apps/api/src/orchestrator/worker.ts`
- Modify: `apps/api/src/agents/codex-cli.ts`
- Test: `apps/api/src/agents/codex-cli.test.ts`
- Create: `skills/domains/strudel.md`

- [ ] **Step 1: Write the failing Codex prompt-injection test**

```ts
// add to apps/api/src/agents/codex-cli.test.ts
it('injects domain skill guidance into the worker prompt when configured', async () => {
  const proc = makeProc()
  spawnMock.mockReturnValue(proc)
  getWorktreeDiffMock.mockResolvedValue('+ diff')
  writeDoneMarkerMock.mockResolvedValue(undefined)
  openMock.mockResolvedValue({ write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) })

  const runPromise = new CodexCLIAdapter().run(
    { id: 'w4', prompt: 'write a bass line', maxRetries: 1, errorHistory: [] },
    {
      worktreePath: path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`),
      branch: 'feat/w4',
      baseBranch: 'main',
      entityId: 'w4',
      planPath: 'worker-plan.md',
      leadPlanPath: 'lead-plan.md',
      runPlanPath: 'run-plan.md',
      domainSkillName: 'strudel',
      domainSkillContent: '# Strudel\n- Export exactly one lane const\n- Do not add imports in lane files\n',
    },
  )

  setImmediate(() => proc.emit('close', 0))
  await runPromise

  const prompt = spawnMock.mock.calls[0]?.[1]?.[3]
  expect(prompt).toContain('Domain skill: strudel')
  expect(prompt).toContain('Export exactly one lane const')
  expect(prompt).toContain('Do not add imports in lane files')
})
```

- [ ] **Step 2: Run the Codex adapter test and verify it fails**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/agents/codex-cli.test.ts
```

Expected: FAIL because `WorkerContext` does not yet accept `domainSkillName` / `domainSkillContent`, and the prompt does not include the domain-skill block.

- [ ] **Step 3: Implement CLI parsing, runtime plumbing, and prompt injection**

```ts
// apps/api/src/agents/types.ts
export interface WorkerContext {
  worktreePath: string
  branch: string
  baseBranch: string
  entityId: string
  planPath: string
  leadPlanPath: string
  runPlanPath: string
  domainSkillName?: string
  domainSkillContent?: string
  onHeartbeat?: (heartbeat: WorkerHeartbeat) => void | Promise<void>
  onSessionLogOpened?: (sessionPath: string) => void | Promise<void>
}
```

```ts
// apps/api/src/agents/codex-cli.ts
const prompt = [
  'You are an ORC worker subagent running unattended inside a git worktree.',
  'Execute the assigned implementation task directly.',
  'Do not ask the user questions, do not wait for approval, and do not offer options.',
  'Do not invoke process skills such as using-superpowers, brainstorming, writing-plans, test-driven-development, or verification-before-completion.',
  ctx.domainSkillContent ? `Domain skill: ${ctx.domainSkillName}\n${ctx.domainSkillContent}` : '',
  '',
  `Task: ${task.prompt}`,
  task.strategy ? `Approach: ${task.strategy}` : '',
  `Your plan: ${ctx.planPath}`,
  `Lead plan: ${ctx.leadPlanPath}`,
  `Run plan: ${ctx.runPlanPath}`,
].filter(Boolean).join('\n')
```

```ts
// apps/api/src/cli.ts
import { resolveDomainSkill, resolveTemplateSelection } from './orchestrator/domainSkill'

program
  .command('run <goal>')
  .option('--skill <name>', 'domain skill bundle for workers')
  .option('--template <name>', 'workflow template name')
  .option('-m, --max-workers <n>', 'max concurrent workers', '4')
  .option('--mock', 'use MockAgent (deterministic, no real Codex)')
  .option('--run-id <id>', 'custom run ID', `run-${Date.now()}`)
  .action(async (goal: string, opts) => {
    const skill = await resolveDomainSkill(REPO_ROOT, opts.skill)
    const templatePath = await resolveTemplateSelection({
      repoRoot: REPO_ROOT,
      userGoal: goal,
      explicitTemplateName: opts.template,
      skillName: opts.skill,
    })
    const llmCall = opts.mock
      ? async (prompt: string) => {
          if (prompt.includes('Decompose') || prompt.includes('decompose')) {
            return JSON.stringify([
              { id: 'drums', goal: 'Write drum pattern in Strudel.js', numWorkers: 2, dependsOn: [] },
              { id: 'bass', goal: 'Write bass line in Strudel.js', numWorkers: 2, dependsOn: [] },
              { id: 'chords', goal: 'Write chord pattern in Strudel.js', numWorkers: 2, dependsOn: ['bass'] },
              { id: 'melody', goal: 'Write lead melody in Strudel.js', numWorkers: 3, dependsOn: ['chords'] },
              { id: 'arrangement', goal: 'Write final Strudel.js arrangement', numWorkers: 1, dependsOn: ['drums', 'bass', 'chords', 'melody'] },
            ])
          }
          if (prompt.includes('Generate') || prompt.includes('prompts')) {
            return JSON.stringify(['Write a minimal lo-fi pattern', 'Write a rhythmic groove pattern'])
          }
          const match = prompt.match(/([\w-]+-v1)/)
          return JSON.stringify({ winnerId: match?.[1] ?? 'drums-v1', reasoning: 'mock reviewer selected v1' })
        }
      : createLLMClientFromEnv()

    const m = new MastermindStateMachine({
      repoRoot: REPO_ROOT,
      db,
      governor: gov,
      runId: opts.runId,
      baseBranch,
      agentFactory: opts.mock ? () => new MockAgent({ delayMs: 200, outcome: 'done' }) : () => new CodexCLIAdapter(),
      llmCall,
      leadQueues: leadQs,
      templatePath,
      domainSkillName: skill?.name,
      domainSkillContent: skill?.content,
      maxConcurrentWorkers: parseInt(opts.maxWorkers),
    })
  })
```

```ts
// apps/api/src/orchestrator/mastermind.ts
interface MastermindConfig {
  repoRoot: string
  db: Db
  governor: ConcurrencyGovernor
  runId: string
  baseBranch: string
  agentFactory: () => WorkerAgent
  llmCall: (prompt: string) => Promise<string>
  leadQueues?: Map<string, CommandQueue<OrcCommand>>
  doMerge?: (targetWorktreePath: string, sourceBranch: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  templatePath?: string
  domainSkillName?: string
  domainSkillContent?: string
  maxConcurrentWorkers?: number
}
```

```ts
// apps/api/src/orchestrator/worker.ts
const result = await this.agent.run(task, {
  worktreePath: wtPath,
  branch: this.cfg.branch,
  baseBranch: this.cfg.baseBranch,
  entityId: this.cfg.id,
  planPath,
  leadPlanPath: this.cfg.leadPlanPath ?? '',
  runPlanPath: this.cfg.runPlanPath ?? '',
  domainSkillName: this.cfg.domainSkillName,
  domainSkillContent: this.cfg.domainSkillContent,
  onHeartbeat: heartbeat => this.recordHeartbeat(heartbeat),
})
```

```md
<!-- skills/domains/strudel.md -->
# Strudel Worker Skill

You are writing Strudel code for a workflow-template lane.

Rules:
- Modify only the file named in the task.
- Lane sections must export exactly one named const: `export const <lane> = <pattern>`.
- Do not add imports in lane files such as `src/drums.js`, `src/bass.js`, `src/chords.js`, or `src/melody.js`.
- Do not add extra exports, helper files, or unrelated refactors.
- Keep lane files preview-safe for the existing ORC Strudel preview flow.
- `src/index.js` is the only place allowed to import lane files and call `stack(...)`.

Examples:
- `export const drums = s("bd sd ~ sd")`
- `export const bass = note("c2 ~ g1 ~").sound("sawtooth")`
- `export const chords = note("<c4 e4 g4>").slow(2)`
- `export const melody = note("e4 g4 a4 g4").sound("triangle")`
- Arrangement files may import lane modules and export nothing.
```

- [ ] **Step 4: Re-run the Codex adapter test and verify it passes**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/agents/codex-cli.test.ts
```

Expected: PASS with the new domain-skill injection assertion green.

- [ ] **Step 5: Commit the CLI and worker-prompt slice**

```bash
cd /home/cbosle/hackatons/strudel-worktree
git add apps/api/src/cli.ts apps/api/src/agents/types.ts apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/lead.ts apps/api/src/orchestrator/worker.ts apps/api/src/agents/codex-cli.ts apps/api/src/agents/codex-cli.test.ts skills/domains/strudel.md
git commit -m "feat: wire runtime strudel worker skill"
```

### Task 3: Shared Worker Source Lookup and Dependency Context

**Files:**
- Create: `apps/api/src/orchestrator/workerSource.ts`
- Test: `apps/api/src/orchestrator/workerSource.test.ts`
- Modify: `apps/api/src/orchestrator/preview.ts`
- Modify: `apps/api/src/orchestrator/lead.ts`
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Test: `apps/api/src/orchestrator/mastermind.test.ts`

- [ ] **Step 1: Write the failing source-helper and dependency-context tests**

```ts
// apps/api/src/orchestrator/workerSource.test.ts
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { codeFileForWorker, sectionIdForWorker } from './workerSource'

describe('workerSource', () => {
  it('derives section ids from namespaced worker ids', () => {
    expect(sectionIdForWorker('run77-bass-v1')).toBe('bass')
    expect(sectionIdForWorker('run77-arrangement-v1')).toBe('arrangement')
  })

  it('prefers the section file before falling back to src/index.js', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-worker-source-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src', 'bass.js'), 'export const bass = note("c2")\n')
    await fs.writeFile(path.join(worktreePath, 'src', 'index.js'), 'stack(bass)\n')

    await expect(codeFileForWorker(worktreePath, 'run77-bass-v1')).resolves.toBe('src/bass.js')
  })
})
```

```ts
// add to apps/api/src/orchestrator/mastermind.test.ts
it('passes upstream winner code into downstream worker prompts for dependent Strudel sections', async () => {
  repoDir = initTestRepo('mastermind-strudel-context-test')
  const db = createTestDb()
  const gov = new ConcurrencyGovernor(4)
  const prompts = new Map<string, string>()

  class CapturingAgent implements WorkerAgent {
    async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
      prompts.set(task.id, task.prompt)
      await fs.mkdir(`${ctx.worktreePath}/src`, { recursive: true })
      if (task.id.includes('-bass-')) {
        await fs.writeFile(`${ctx.worktreePath}/src/bass.js`, 'export const bass = note("c2 ~ g1 ~")\n')
      } else {
        await fs.writeFile(`${ctx.worktreePath}/src/melody.js`, 'export const melody = note("e4 g4 a4")\n')
      }
      return { status: 'done', branch: ctx.branch, diff: '', retryable: false }
    }

    async abort(): Promise<void> {}
  }

  const m = new MastermindStateMachine({
    repoRoot: repoDir,
    db,
    governor: gov,
    runId: 'ctx-run',
    baseBranch: 'main',
    domainSkillName: 'strudel',
    domainSkillContent: '# Strudel\n- stay in lane\n',
    agentFactory: () => new CapturingAgent(),
    llmCall: async prompt => {
      if (prompt.includes('Decompose')) {
        return JSON.stringify([
          { id: 'bass', goal: 'Write bass', numWorkers: 1, dependsOn: [] },
          { id: 'melody', goal: 'Write melody', numWorkers: 1, dependsOn: ['bass'] },
        ])
      }
      if (prompt.includes('Generate')) return JSON.stringify(['write it'])
      return JSON.stringify({ winnerId: prompt.includes('melody') ? 'ctx-run-melody-v1' : 'ctx-run-bass-v1', reasoning: 'only worker' })
    },
  })

  await m.run({ userGoal: 'Build a track with bass and melody' })

  expect(prompts.get('ctx-run-melody-v1')).toContain('Dependency context')
  expect(prompts.get('ctx-run-melody-v1')).toContain('upstream section: bass')
  expect(prompts.get('ctx-run-melody-v1')).toContain('export const bass = note("c2 ~ g1 ~")')
})
```

- [ ] **Step 2: Run the focused orchestration tests and verify they fail**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/orchestrator/workerSource.test.ts src/orchestrator/mastermind.test.ts
```

Expected: FAIL because `workerSource.ts` does not exist and downstream worker prompts do not yet include a dependency-context block.

- [ ] **Step 3: Implement shared source lookup and dependency-context prompt building**

```ts
// apps/api/src/orchestrator/workerSource.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export function sectionIdForWorker(workerId: string): string {
  const namespacedMatch = workerId.match(/-([^-]+)-v\d+(?:-r\d+)?$/)
  if (namespacedMatch?.[1]) return namespacedMatch[1]
  return workerId.replace(/-v\d+(-r\d+)?$/, '')
}

export async function codeFileForWorker(worktreePath: string, workerId: string): Promise<string> {
  const sectionId = sectionIdForWorker(workerId)
  const preferred = sectionId === 'arrangement'
    ? ['src/index.js']
    : [`src/${sectionId}.js`, 'src/index.js']

  for (const candidate of preferred) {
    try {
      await fs.access(path.join(worktreePath, candidate))
      return candidate
    } catch {}
  }

  const entries = await fs.readdir(path.join(worktreePath, 'src')).catch(() => [])
  const jsFiles = entries.filter(entry => entry.endsWith('.js')).sort()
  return jsFiles.includes('index.js') ? 'src/index.js' : `src/${jsFiles[0]}`
}

export async function loadWorkerSource(worktreePath: string, workerId: string): Promise<{ filePath: string; source: string }> {
  const filePath = await codeFileForWorker(worktreePath, workerId)
  const source = await fs.readFile(path.join(worktreePath, filePath), 'utf8')
  return { filePath, source }
}
```

```ts
// inside apps/api/src/orchestrator/lead.ts
async function buildDependencyContext(): Promise<string> {
  if (this.cfg.dependsOn.length === 0) return ''

  const winners = getMergeCandidates(this.cfg.db)
  const worktrees = getWorktrees(this.cfg.db)
  const blocks = await Promise.all(this.cfg.dependsOn.map(async sectionId => {
    const leadId = `${sectionId}-lead`
    const winner = winners.find(candidate => candidate.leadId === leadId)
    if (!winner) return `upstream section: ${sectionId}\nwarning: no selected winner yet`

    const worktree = worktrees.find(candidate => candidate.workerId === winner.winnerWorkerId)
    if (!worktree) return `upstream section: ${sectionId}\nwarning: winner worktree missing`

    const { filePath, source } = await loadWorkerSource(worktree.path, winner.winnerWorkerId)
    return [
      `upstream section: ${sectionId}`,
      `winner worker: ${winner.winnerWorkerId}`,
      `source file: ${filePath}`,
      source,
    ].join('\n')
  }))

  return `Dependency context\n${blocks.join('\n\n')}`.trim()
}

const dependencyContext = await buildDependencyContext()
const workerPromptsWithContext = workerPrompts.map(prompt =>
  dependencyContext ? `${prompt}\n\n${dependencyContext}` : prompt
)
```

```ts
// apps/api/src/orchestrator/mastermind.ts
const lead = new LeadStateMachine({
  id: leadId,
  sectionId: section.id,
  sectionGoal: section.goal,
  dependsOn: section.dependsOn,
  numWorkers: section.numWorkers,
  baseBranch: this.cfg.baseBranch,
  runBranch: `run/${this.cfg.runId}`,
  runId: this.cfg.runId,
  repoRoot: this.cfg.repoRoot,
  db: this.cfg.db,
  governor: this.cfg.governor,
  agentFactory: this.cfg.agentFactory,
  llmCall: this.cfg.llmCall,
  commandQueue: leadCommandQueue,
  runPlanPath,
  domainSkillName: this.cfg.domainSkillName,
  domainSkillContent: this.cfg.domainSkillContent,
})
```

- [ ] **Step 4: Re-run the source-helper and mastermind tests and verify they pass**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/orchestrator/workerSource.test.ts src/orchestrator/mastermind.test.ts
```

Expected: PASS with helper coverage green and the dependent-worker prompt containing upstream winner code.

- [ ] **Step 5: Commit the dependency-context slice**

```bash
cd /home/cbosle/hackatons/strudel-worktree
git add apps/api/src/orchestrator/workerSource.ts apps/api/src/orchestrator/workerSource.test.ts apps/api/src/orchestrator/preview.ts apps/api/src/orchestrator/lead.ts apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/mastermind.test.ts
git commit -m "feat: add strudel dependency context for workers"
```

### Task 4: Documentation and Regression Verification

**Files:**
- Modify: `README.md`
- Test: `apps/api/src/integration.test.ts`
- Test: `apps/api/src/agents/codex-cli.test.ts`
- Test: `apps/api/src/orchestrator/domainSkill.test.ts`
- Test: `apps/api/src/orchestrator/workerSource.test.ts`
- Test: `apps/api/src/orchestrator/mastermind.test.ts`

- [ ] **Step 1: Add the README usage examples for the new runtime flag**

```md
<!-- README.md -->
### Run with the Strudel skill

~~~bash
orc run "lo-fi hip-hop track, 90bpm, key Dm" --skill strudel
~~~

`--skill strudel` activates the worker-only Strudel guidance bundle and auto-selects the `strudel-track` template when `--template` is not provided.

### Override the template explicitly

~~~bash
orc run "lo-fi hip-hop track" --skill strudel --template strudel-track
~~~
```

- [ ] **Step 2: Run the focused API regression suite**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 ./node_modules/.bin/vitest run src/orchestrator/domainSkill.test.ts src/agents/codex-cli.test.ts src/orchestrator/workerSource.test.ts src/orchestrator/mastermind.test.ts src/integration.test.ts
```

Expected: PASS with the new skill, prompt, and dependency-context coverage all green.

- [ ] **Step 3: Run the full API Vitest suite**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm test
```

Expected: PASS for the Strudel-skill changes. If unrelated pre-existing failures remain, note them explicitly instead of masking them.

- [ ] **Step 4: Commit the docs and verification slice**

```bash
cd /home/cbosle/hackatons/strudel-worktree
git add README.md
git commit -m "docs: document strudel worker skill usage"
```

## Self-Review

- Spec coverage:
  - `--skill <name>`: Task 1 + Task 2
  - worker-only injection: Task 2
  - Strudel markdown skill asset: Task 2
  - auto-template selection from skill: Task 1 + Task 2
  - upstream winner code for downstream workers: Task 3
  - docs and verification: Task 4
- Placeholder scan:
  - No unresolved placeholders or undefined helper names remain.
- Type consistency:
  - `domainSkillName` / `domainSkillContent` are introduced once in `WorkerContext` and threaded through all downstream tasks using the same names.
