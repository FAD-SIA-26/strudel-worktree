# Dashboard Entity Detail Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's placeholder worker/lead detail tabs with real inline plan rendering, real diff rendering, and live logs sourced from artifact paths, worker session files, and lead journal events.

**Architecture:** Keep `GET /api/orchestration` as the lightweight tree and preview snapshot. Add dedicated backend detail/log endpoints backed by `artifacts`, `worktrees`, `merge_candidates`, git diff helpers, and SSE log streams. On the web side, keep preview actions on orchestration data, but fetch entity detail and live logs separately inside `DetailPanel`.

**Tech Stack:** TypeScript, Express, Better-SQLite3, Zod, Vitest, Next.js App Router, TanStack Query, Server-Sent Events, Testing Library, jsdom.

---

## File Map

- Modify: `packages/types/src/api.ts`
  Add shared schemas and types for `EntityDetail`, `LogEntry`, and `LogsResponse`.
- Modify: `apps/api/src/db/queries.ts`
  Add artifact/task lookup helpers needed by detail/log resolution.
- Modify: `apps/api/src/orchestrator/mastermind.ts`
  Register `run_plan` artifacts after run plan creation.
- Modify: `apps/api/src/orchestrator/lead.ts`
  Register `lead_plan` artifacts after lead plan creation.
- Modify: `apps/api/src/orchestrator/worker.ts`
  Register `worker_plan` artifacts and thread session-log registration through worker context.
- Modify: `apps/api/src/agents/types.ts`
  Extend `WorkerContext` with a session-log registration callback.
- Modify: `apps/api/src/agents/codex-cli.ts`
  Notify the orchestrator when `.orc/.orc-session.jsonl` is opened.
- Modify: `apps/api/src/git/worktree.ts`
  Add a full-patch helper for dashboard diff rendering without changing the existing reviewer/stat diff helper.
- Create: `apps/api/src/server/entityDetails.ts`
  Resolve worker and lead detail payloads from DB + filesystem + git.
- Create: `apps/api/src/server/entityLogs.ts`
  Read worker session logs, read lead journal windows, and attach SSE streams.
- Modify: `apps/api/src/server/routes.ts`
  Add `/api/entities/:entityId/detail`, `/api/entities/:entityId/logs`, and `/api/entities/:entityId/logs/stream`.
- Modify: `apps/api/src/server/routes.test.ts`
  Add API coverage for detail payloads and initial log windows.
- Create: `apps/api/src/server/entityLogs.test.ts`
  Add unit coverage for worker log parsing/cursors and lead log filtering.
- Create: `apps/api/src/orchestrator/artifactRegistration.test.ts`
  Add focused coverage for `run_plan`, `lead_plan`, and `worker_plan` artifact registration.
- Modify: `apps/api/src/agents/codex-cli.test.ts`
  Assert session-log registration callback behavior.
- Modify: `apps/web/package.json`
  Add web test dependencies required for jsdom component tests.
- Create: `apps/web/vitest.config.ts`
  Enable jsdom + setup file for web component tests.
- Create: `apps/web/src/test/setup.ts`
  Install Testing Library DOM matchers.
- Create: `apps/web/src/hooks/useEntityDetail.ts`
  Fetch entity detail payloads.
- Create: `apps/web/src/hooks/useEntityLogs.ts`
  Fetch the initial log window and append SSE entries.
- Modify: `apps/web/src/components/DetailPanel.tsx`
  Replace placeholder plan/log panels with real plan, diff, and live log views.
- Create: `apps/web/src/components/DetailPanel.test.tsx`
  Verify worker and lead detail rendering with mocked hooks.

---

### Task 1: Register Artifact Paths When Plans And Session Logs Are Created

**Files:**
- Create: `apps/api/src/orchestrator/artifactRegistration.test.ts`
- Modify: `apps/api/src/agents/types.ts`
- Modify: `apps/api/src/agents/codex-cli.ts`
- Modify: `apps/api/src/agents/codex-cli.test.ts`
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Modify: `apps/api/src/orchestrator/lead.ts`
- Modify: `apps/api/src/orchestrator/worker.ts`
- Modify: `apps/api/src/db/queries.ts`
- Test: `apps/api/src/orchestrator/artifactRegistration.test.ts`
- Test: `apps/api/src/agents/codex-cli.test.ts`

- [ ] **Step 1: Write the failing artifact-registration tests**

Create `apps/api/src/orchestrator/artifactRegistration.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { createTestDb, getSQLite } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MastermindStateMachine } from './mastermind'
import { MockAgent } from '../agents/mock'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('artifact registration', () => {
  it('registers run, lead, and worker plans in the artifacts table', async () => {
    repoDir = initTestRepo('artifact-registration')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(2)

    const mastermind = new MastermindStateMachine({
      repoRoot: repoDir,
      db,
      governor: gov,
      runId: 'r7',
      baseBranch: 'main',
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async prompt => {
        if (prompt.includes('Decompose')) {
          return JSON.stringify([{ id: 'main', goal: 'Build landing page', numWorkers: 1, dependsOn: [] }])
        }
        if (prompt.includes('Generate')) {
          return JSON.stringify(['build landing page'])
        }
        return JSON.stringify({ winnerId: 'r7-main-v1', reasoning: 'only worker' })
      },
    })

    await mastermind.run({ userGoal: 'Build landing page' })

    const rows = getSQLite(db)
      .prepare(`
        SELECT entity_id AS entityId, artifact_type AS artifactType, path
        FROM artifacts
        ORDER BY entity_id, artifact_type
      `)
      .all() as Array<{ entityId: string; artifactType: string; path: string }>

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'r7',
        artifactType: 'run_plan',
        path: expect.stringContaining('/.orc/runs/r7/run-plan.md'),
      }),
      expect.objectContaining({
        entityId: 'main-lead',
        artifactType: 'lead_plan',
        path: expect.stringContaining('/.orc/runs/r7/leads/main.md'),
      }),
      expect.objectContaining({
        entityId: 'r7-main-v1',
        artifactType: 'worker_plan',
        path: expect.stringContaining('/.orc/worktrees/r7-main-v1/.orc/worker-plan.md'),
      }),
    ]))
  })
})
```

Extend `apps/api/src/agents/codex-cli.test.ts` inside `uses codex exec JSON mode and returns a successful result`:

```ts
const onSessionLogOpened = vi.fn()

const runPromise = new CodexCLIAdapter().run(
  { id: 'w1', prompt: 'do the thing', maxRetries: 1, errorHistory: [] },
  {
    worktreePath,
    branch: 'feat/w1',
    baseBranch: 'main',
    entityId: 'w1',
    planPath: 'worker-plan.md',
    leadPlanPath: 'lead-plan.md',
    runPlanPath: 'run-plan.md',
    onHeartbeat,
    onSessionLogOpened,
  },
)

expect(onSessionLogOpened).toHaveBeenCalledWith(path.join(worktreePath, '.orc', '.orc-session.jsonl'))
```

- [ ] **Step 2: Run the focused API tests and confirm they fail**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/orchestrator/artifactRegistration.test.ts src/agents/codex-cli.test.ts
```

Expected:
- `artifactRegistration.test.ts` fails because no artifact rows are written today
- `codex-cli.test.ts` fails because `WorkerContext` has no session-log callback and `CodexCLIAdapter` never emits one

- [ ] **Step 3: Add artifact lookup helpers and session-log callback plumbing**

Modify `apps/api/src/db/queries.ts` to add a path lookup helper:

```ts
export function getArtifactPath(db: Db, entityId: string, artifactType: string): string | null {
  const row = getSQLite(db)
    .prepare(`
      SELECT path
      FROM artifacts
      WHERE entity_id=? AND artifact_type=?
    `)
    .get(entityId, artifactType) as { path: string } | undefined

  return row?.path ?? null
}
```

Modify `apps/api/src/agents/types.ts`:

```ts
export interface WorkerContext {
  worktreePath: string
  branch: string
  baseBranch: string
  entityId: string
  planPath: string
  leadPlanPath: string
  runPlanPath: string
  onHeartbeat?: (heartbeat: WorkerHeartbeat) => void | Promise<void>
  onSessionLogOpened?: (sessionPath: string) => void | Promise<void>
}
```

Modify `apps/api/src/agents/codex-cli.ts` directly after opening the session file:

```ts
const sessionPath = path.join(ctx.worktreePath, '.orc', '.orc-session.jsonl')
const session = await fs.open(sessionPath, 'a')
await ctx.onSessionLogOpened?.(sessionPath)
```

Modify `apps/api/src/orchestrator/mastermind.ts` after `createRunPlan()` resolves:

```ts
import { upsertArtifact, upsertTask } from '../db/queries'

const runPlanPath = await createRunPlan(this.cfg.repoRoot, this.cfg.runId, {
  userGoal: opts.userGoal,
  sections: sections.map(s => s.id),
}).catch(() => '')

if (runPlanPath) {
  upsertArtifact(this.cfg.db, this.cfg.runId, 'run_plan', runPlanPath)
}
```

Modify `apps/api/src/orchestrator/lead.ts` after `createLeadPlan()` resolves:

```ts
import { upsertArtifact, upsertTask } from '../db/queries'

const leadPlanPath = await createLeadPlan(this.cfg.repoRoot, this.cfg.runId, {
  sectionId: this.cfg.sectionId,
  sectionGoal: this.cfg.sectionGoal,
  workerVariants: workerPrompts,
}).catch(() => '')

if (leadPlanPath) {
  upsertArtifact(this.cfg.db, this.cfg.id, 'lead_plan', leadPlanPath)
}
```

Modify `apps/api/src/orchestrator/worker.ts` after `createWorkerPlan()` resolves and when building worker context:

```ts
import { upsertArtifact, upsertTask, upsertWorktree } from '../db/queries'

const planPath = await createWorkerPlan(wtPath, {
  workerId: this.cfg.id,
  objective: task.prompt,
  strategy: task.strategy ?? 'default',
})

upsertArtifact(this.cfg.db, this.cfg.id, 'worker_plan', planPath)

const result = await this.agent.run(task, {
  worktreePath: wtPath,
  branch: this.cfg.branch,
  baseBranch: this.cfg.baseBranch,
  entityId: this.cfg.id,
  planPath,
  leadPlanPath: this.cfg.leadPlanPath ?? '',
  runPlanPath: this.cfg.runPlanPath ?? '',
  onHeartbeat: heartbeat => this.recordHeartbeat(heartbeat),
  onSessionLogOpened: sessionPath => upsertArtifact(this.cfg.db, this.cfg.id, 'session_log', sessionPath),
})
```

- [ ] **Step 4: Re-run the focused API tests and confirm they pass**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/orchestrator/artifactRegistration.test.ts src/agents/codex-cli.test.ts
```

Expected:
- both test files pass
- the new artifact test proves `run_plan`, `lead_plan`, and `worker_plan` rows exist
- the updated adapter test proves the session-log callback fires with the real `.orc/.orc-session.jsonl` path

- [ ] **Step 5: Commit the artifact-registration slice**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && git add apps/api/src/db/queries.ts apps/api/src/agents/types.ts apps/api/src/agents/codex-cli.ts apps/api/src/agents/codex-cli.test.ts apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/lead.ts apps/api/src/orchestrator/worker.ts apps/api/src/orchestrator/artifactRegistration.test.ts && git commit -m "feat: register dashboard detail artifacts"
```

Expected:
- one commit containing only artifact-registration and session-log callback changes

---

### Task 2: Add Shared Detail Contracts And The Entity Detail API

**Files:**
- Modify: `packages/types/src/api.ts`
- Modify: `apps/api/src/db/queries.ts`
- Modify: `apps/api/src/git/worktree.ts`
- Create: `apps/api/src/server/entityDetails.ts`
- Modify: `apps/api/src/server/routes.ts`
- Modify: `apps/api/src/server/routes.test.ts`
- Test: `apps/api/src/server/routes.test.ts`

- [ ] **Step 1: Add failing route coverage for worker and lead detail payloads**

Append these tests to `apps/api/src/server/routes.test.ts`:

```ts
it('GET /api/entities/:entityId/detail returns worker plan, diff, and resolved paths', async () => {
  const repoDir = initTestRepo('worker-detail-route')
  const db = createTestDb()
  const wtPath = path.join(repoDir, '.orc', 'worktrees', 'main-v1')

  await createWorktree(repoDir, wtPath, 'feat/main-v1')
  await fs.writeFile(path.join(wtPath, 'README.md'), '# worker branch change\n')
  await fs.writeFile(path.join(wtPath, '.orc', 'worker-plan.md'), '# Worker Plan\n\n- [ ] inspect\n')
  await fs.writeFile(path.join(wtPath, '.orc', '.orc-session.jsonl'), '{"ts":1,"output":"hello"}\n')

  upsertTask(db, 'main-lead', 'lead', 'mastermind', 'running')
  upsertTask(db, 'main-v1', 'worker', 'main-lead', 'running')
  upsertWorktree(db, 'main-v1', 'main-v1', wtPath, 'feat/main-v1', 'main')
  upsertArtifact(db, 'main-v1', 'worker_plan', path.join(wtPath, '.orc', 'worker-plan.md'))
  upsertArtifact(db, 'main-v1', 'session_log', path.join(wtPath, '.orc', '.orc-session.jsonl'))

  const app = createApp({ db, leadQueues: new Map() })
  const res = await request(app).get('/api/entities/main-v1/detail')

  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({
    entityId: 'main-v1',
    entityType: 'worker',
    resolvedPaths: {
      worktreePath: wtPath,
      planPath: path.join(wtPath, '.orc', 'worker-plan.md'),
      logPath: path.join(wtPath, '.orc', '.orc-session.jsonl'),
    },
    plan: {
      status: 'ready',
      content: '# Worker Plan\n\n- [ ] inspect\n',
    },
    diff: {
      status: 'ready',
      branch: 'feat/main-v1',
      baseBranch: 'main',
    },
  })
  expect(String(res.body.diff.content)).toContain('diff --git')
})
```

```ts
it('GET /api/entities/:entityId/detail returns the selected winner diff for a lead', async () => {
  const repoDir = initTestRepo('lead-detail-route')
  const db = createTestDb()
  const wtPath = path.join(repoDir, '.orc', 'worktrees', 'melody-v2')

  await createWorktree(repoDir, wtPath, 'feat/melody-v2')
  await fs.writeFile(path.join(wtPath, 'README.md'), '# winner branch change\n')
  await fs.mkdir(path.join(repoDir, '.orc', 'runs', 'r5', 'leads'), { recursive: true })
  await fs.writeFile(path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'), '# Lead Plan\n')

  upsertTask(db, 'melody-lead', 'lead', 'mastermind', 'reviewing')
  upsertTask(db, 'melody-v2', 'worker', 'melody-lead', 'done')
  upsertWorktree(db, 'melody-v2', 'melody-v2', wtPath, 'feat/melody-v2', 'main')
  upsertArtifact(db, 'melody-lead', 'lead_plan', path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'))

  const sqlite = getSQLite(db)
  sqlite.prepare(`
    INSERT INTO merge_candidates(id, lead_id, winner_worker_id, target_branch, reviewer_reasoning, selection_source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('melody-lead', 'melody-lead', 'melody-v2', 'run/r5', 'winner selected', 'user')

  const app = createApp({ db, leadQueues: new Map() })
  const res = await request(app).get('/api/entities/melody-lead/detail')

  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({
    entityId: 'melody-lead',
    entityType: 'lead',
    resolvedPaths: {
      planPath: path.join(repoDir, '.orc', 'runs', 'r5', 'leads', 'melody.md'),
      winnerWorktreePath: wtPath,
    },
    plan: {
      status: 'ready',
      content: '# Lead Plan\n',
    },
    diff: {
      status: 'ready',
      winnerWorkerId: 'melody-v2',
      branch: 'feat/melody-v2',
      baseBranch: 'main',
    },
  })
  expect(String(res.body.diff.content)).toContain('diff --git')
})
```

- [ ] **Step 2: Run the route tests and confirm they fail on missing detail endpoints**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/server/routes.test.ts
```

Expected:
- the new tests fail with `404` or `Cannot GET /api/entities/.../detail`

- [ ] **Step 3: Add the shared Zod contracts and full-patch git helper**

Modify `packages/types/src/api.ts` by adding these schemas below `OrchStateSchema`:

```ts
const ContentStatusSchema = z.enum(['ready', 'empty', 'missing', 'error'])

const ContentBlockSchema = z.object({
  status: ContentStatusSchema,
  content: z.string().nullable(),
  message: z.string().optional(),
})

export const LogEntrySchema = z.object({
  id: z.string(),
  ts: z.number().int(),
  kind: z.enum(['stdout', 'stderr', 'codex_event', 'lead_event']),
  title: z.string(),
  body: z.string(),
  raw: z.string(),
})

export const LogsResponseSchema = z.object({
  entries: z.array(LogEntrySchema),
  tailCursor: z.string().nullable(),
})

export const WorkerDetailSchema = z.object({
  entityId: z.string(),
  entityType: z.literal('worker'),
  title: z.string(),
  resolvedPaths: z.object({
    worktreePath: z.string(),
    planPath: z.string().nullable(),
    logPath: z.string().nullable(),
  }),
  plan: ContentBlockSchema,
  diff: ContentBlockSchema.extend({
    branch: z.string().optional(),
    baseBranch: z.string().optional(),
  }),
})

export const LeadDetailSchema = z.object({
  entityId: z.string(),
  entityType: z.literal('lead'),
  title: z.string(),
  resolvedPaths: z.object({
    planPath: z.string().nullable(),
    winnerWorktreePath: z.string().nullable(),
  }),
  plan: ContentBlockSchema,
  diff: ContentBlockSchema.extend({
    winnerWorkerId: z.string().nullable(),
    branch: z.string().optional(),
    baseBranch: z.string().optional(),
  }),
})

export const EntityDetailSchema = z.discriminatedUnion('entityType', [
  WorkerDetailSchema,
  LeadDetailSchema,
])

export type LogEntry = z.infer<typeof LogEntrySchema>
export type LogsResponse = z.infer<typeof LogsResponseSchema>
export type WorkerDetail = z.infer<typeof WorkerDetailSchema>
export type LeadDetail = z.infer<typeof LeadDetailSchema>
export type EntityDetail = z.infer<typeof EntityDetailSchema>
```

Modify `apps/api/src/git/worktree.ts` by adding a full-patch helper without changing `getWorktreeDiff()`:

```ts
export async function getWorktreePatch(wtPath: string, baseBranch: string): Promise<string> {
  try {
    return await git(wtPath, ['diff', baseBranch])
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Implement entity detail resolution and wire the route**

Create `apps/api/src/server/entityDetails.ts`:

```ts
import * as fs from 'node:fs/promises'
import type { Db } from '../db/client'
import { getArtifactPath, getAllTasks, getMergeCandidates, getWorktrees } from '../db/queries'
import { getWorktreePatch } from '../git/worktree'
import type { EntityDetail } from '@orc/types'

async function readText(pathValue: string | null): Promise<{ status: 'ready' | 'missing' | 'error'; content: string | null; message?: string }> {
  if (!pathValue) return { status: 'missing', content: null, message: 'artifact path not registered' }
  try {
    return { status: 'ready', content: await fs.readFile(pathValue, 'utf8') }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { status: 'missing', content: null, message: 'file does not exist yet' }
    return { status: 'error', content: null, message: error?.message ?? 'failed to read file' }
  }
}

export async function getEntityDetail(db: Db, entityId: string): Promise<EntityDetail | null> {
  const tasks = getAllTasks(db)
  const task = tasks.find(t => t.id === entityId)
  if (!task) return null

  if (task.type === 'worker') {
    const worktree = getWorktrees(db).find(wt => wt.workerId === entityId)
    if (!worktree) {
      return {
        entityId,
        entityType: 'worker',
        title: entityId,
        resolvedPaths: { worktreePath: '', planPath: null, logPath: null },
        plan: { status: 'missing', content: null, message: 'worktree metadata missing' },
        diff: { status: 'missing', content: null, message: 'worktree metadata missing' },
      }
    }

    const planPath = getArtifactPath(db, entityId, 'worker_plan') ?? `${worktree.path}/.orc/worker-plan.md`
    const logPath = getArtifactPath(db, entityId, 'session_log') ?? `${worktree.path}/.orc/.orc-session.jsonl`
    const plan = await readText(planPath)
    const patch = await getWorktreePatch(worktree.path, worktree.baseBranch)

    return {
      entityId,
      entityType: 'worker',
      title: entityId,
      resolvedPaths: { worktreePath: worktree.path, planPath, logPath },
      plan,
      diff: patch
        ? { status: 'ready', content: patch, branch: worktree.branch, baseBranch: worktree.baseBranch }
        : { status: 'empty', content: '', branch: worktree.branch, baseBranch: worktree.baseBranch, message: 'no diff yet' },
    }
  }

  if (task.type === 'lead') {
    const planPath = getArtifactPath(db, entityId, 'lead_plan')
    const plan = await readText(planPath)
    const winner = getMergeCandidates(db).find(candidate => candidate.leadId === entityId)

    if (!winner) {
      return {
        entityId,
        entityType: 'lead',
        title: entityId,
        resolvedPaths: { planPath, winnerWorktreePath: null },
        plan,
        diff: { status: 'missing', content: null, winnerWorkerId: null, message: 'no selected winner yet' },
      }
    }

    const worktree = getWorktrees(db).find(wt => wt.workerId === winner.winnerWorkerId)
    if (!worktree) {
      return {
        entityId,
        entityType: 'lead',
        title: entityId,
        resolvedPaths: { planPath, winnerWorktreePath: null },
        plan,
        diff: { status: 'missing', content: null, winnerWorkerId: winner.winnerWorkerId, message: 'winner worktree metadata missing' },
      }
    }

    const patch = await getWorktreePatch(worktree.path, worktree.baseBranch)
    return {
      entityId,
      entityType: 'lead',
      title: entityId,
      resolvedPaths: { planPath, winnerWorktreePath: worktree.path },
      plan,
      diff: patch
        ? { status: 'ready', content: patch, winnerWorkerId: winner.winnerWorkerId, branch: worktree.branch, baseBranch: worktree.baseBranch }
        : { status: 'empty', content: '', winnerWorkerId: winner.winnerWorkerId, branch: worktree.branch, baseBranch: worktree.baseBranch, message: 'winner diff is empty' },
    }
  }

  return null
}
```

Modify `apps/api/src/server/routes.ts`:

```ts
import { getEntityDetail } from './entityDetails'

r.get('/entities/:entityId/detail', async (req, res) => {
  const detail = await getEntityDetail(db, req.params.entityId)
  if (!detail) {
    res.status(404).json({ error: `entity not found: ${req.params.entityId}` })
    return
  }
  res.json(detail)
})
```

- [ ] **Step 5: Re-run the route tests and confirm they pass**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/server/routes.test.ts
```

Expected:
- `GET /api/entities/:entityId/detail` worker and lead tests pass
- existing orchestration and preview route tests still pass

- [ ] **Step 6: Commit the entity detail API slice**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && git add packages/types/src/api.ts apps/api/src/db/queries.ts apps/api/src/git/worktree.ts apps/api/src/server/entityDetails.ts apps/api/src/server/routes.ts apps/api/src/server/routes.test.ts && git commit -m "feat: add entity detail api"
```

Expected:
- one commit containing detail contracts, detail resolver, route wiring, and route coverage

---

### Task 3: Add Initial Log Windows And Live SSE Streams

**Files:**
- Create: `apps/api/src/server/entityLogs.ts`
- Create: `apps/api/src/server/entityLogs.test.ts`
- Modify: `apps/api/src/server/routes.ts`
- Modify: `apps/api/src/server/routes.test.ts`
- Test: `apps/api/src/server/entityLogs.test.ts`
- Test: `apps/api/src/server/routes.test.ts`

- [ ] **Step 1: Write failing log-reader tests for worker cursors and lead filtering**

Create `apps/api/src/server/entityLogs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createTestDb, getSQLite } from '../db/client'
import { readLeadLogWindow, readWorkerLogWindow } from './entityLogs'

describe('entityLogs', () => {
  it('returns worker log entries oldest-first with line-based ids and cursor', async () => {
    const logPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'orc-worker-log-')), '.orc-session.jsonl')
    await fs.writeFile(logPath, [
      JSON.stringify({ ts: 1, output: '{"type":"thread.started"}\n' }),
      JSON.stringify({ ts: 2, error: 'boom\n' }),
      JSON.stringify({ ts: 3, output: 'plain stdout\n' }),
    ].join('\n') + '\n')

    const result = await readWorkerLogWindow('main-v1', logPath, 2)

    expect(result).toEqual({
      entries: [
        expect.objectContaining({ id: 'main-v1:line:2', kind: 'stderr', ts: 2 }),
        expect.objectContaining({ id: 'main-v1:line:3', kind: 'stdout', ts: 3 }),
      ],
      tailCursor: 'line:3',
    })
  })

  it('returns only lead events for the selected lead id', () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    sqlite.prepare(`
      INSERT INTO event_log(entity_id, entity_type, event_type, sequence, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('melody-lead', 'lead', 'ReviewComplete', 1, '{"winnerId":"melody-v2"}', 10)
    sqlite.prepare(`
      INSERT INTO event_log(entity_id, entity_type, event_type, sequence, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('melody-v2', 'worker', 'WorkerDone', 1, '{"branch":"feat/melody-v2","diff":"+x"}', 11)

    const result = readLeadLogWindow(db, 'melody-lead', 50)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      id: 'melody-lead:event:1',
      kind: 'lead_event',
      title: 'ReviewComplete',
    })
    expect(result.tailCursor).toBe('event:1')
  })
})
```

Append this initial-window route test to `apps/api/src/server/routes.test.ts`:

```ts
it('GET /api/entities/:entityId/logs returns the latest worker log window oldest-first', async () => {
  const db = createTestDb()
  const repoDir = initTestRepo('worker-logs-route')
  const wtPath = path.join(repoDir, '.orc', 'worktrees', 'main-v1')
  await createWorktree(repoDir, wtPath, 'feat/main-v1')
  await fs.writeFile(path.join(wtPath, '.orc', '.orc-session.jsonl'), [
    JSON.stringify({ ts: 1, output: 'first\n' }),
    JSON.stringify({ ts: 2, output: 'second\n' }),
    JSON.stringify({ ts: 3, output: 'third\n' }),
  ].join('\n') + '\n')

  upsertTask(db, 'main-lead', 'lead', 'mastermind', 'running')
  upsertTask(db, 'main-v1', 'worker', 'main-lead', 'running')
  upsertWorktree(db, 'main-v1', 'main-v1', wtPath, 'feat/main-v1', 'main')
  upsertArtifact(db, 'main-v1', 'session_log', path.join(wtPath, '.orc', '.orc-session.jsonl'))

  const app = createApp({ db, leadQueues: new Map() })
  const res = await request(app).get('/api/entities/main-v1/logs?limit=2')

  expect(res.status).toBe(200)
  expect(res.body).toEqual({
    entries: [
      expect.objectContaining({ id: 'main-v1:line:2', body: 'second' }),
      expect.objectContaining({ id: 'main-v1:line:3', body: 'third' }),
    ],
    tailCursor: 'line:3',
  })
})
```

- [ ] **Step 2: Run the log tests and confirm they fail**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/server/entityLogs.test.ts src/server/routes.test.ts
```

Expected:
- `entityLogs.test.ts` fails because `entityLogs.ts` does not exist
- the new logs route test fails because `/api/entities/:entityId/logs` is not implemented

- [ ] **Step 3: Implement worker/lead log readers with concrete cursor behavior**

Create `apps/api/src/server/entityLogs.ts`:

```ts
import * as fs from 'node:fs/promises'
import type { Response } from 'express'
import type { Db } from '../db/client'
import { getSQLite } from '../db/client'
import { eventBus } from '../events/eventBus'
import type { LogEntry, LogsResponse, OrcEvent } from '@orc/types'

function normalizeWorkerLine(entityId: string, rawLine: string, lineNumber: number): LogEntry | null {
  if (!rawLine.trim()) return null
  const parsed = JSON.parse(rawLine) as { ts?: number; output?: string; error?: string }
  if (typeof parsed.error === 'string') {
    return {
      id: `${entityId}:line:${lineNumber}`,
      ts: parsed.ts ?? 0,
      kind: 'stderr',
      title: 'stderr',
      body: parsed.error.trim(),
      raw: rawLine,
    }
  }
  if (typeof parsed.output === 'string' && parsed.output.trim().startsWith('{')) {
    return {
      id: `${entityId}:line:${lineNumber}`,
      ts: parsed.ts ?? 0,
      kind: 'codex_event',
      title: 'codex_event',
      body: parsed.output.trim(),
      raw: rawLine,
    }
  }
  return {
    id: `${entityId}:line:${lineNumber}`,
    ts: parsed.ts ?? 0,
    kind: 'stdout',
    title: 'stdout',
    body: (parsed.output ?? '').trim(),
    raw: rawLine,
  }
}

export async function readWorkerLogWindow(entityId: string, logPath: string, limit: number): Promise<LogsResponse> {
  let content = ''
  try {
    content = await fs.readFile(logPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { entries: [], tailCursor: null }
    throw error
  }

  const lines = content.split('\n').filter(Boolean)
  const startIndex = Math.max(0, lines.length - limit)
  const entries = lines
    .slice(startIndex)
    .map((line, offset) => normalizeWorkerLine(entityId, line, startIndex + offset + 1))
    .filter((entry): entry is LogEntry => Boolean(entry))

  return {
    entries,
    tailCursor: lines.length > 0 ? `line:${lines.length}` : null,
  }
}

export function readLeadLogWindow(db: Db, entityId: string, limit: number): LogsResponse {
  const rows = getSQLite(db)
    .prepare(`
      SELECT id, event_type AS eventType, payload, ts
      FROM event_log
      WHERE entity_id=? AND entity_type='lead'
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(entityId, limit) as Array<{ id: number; eventType: string; payload: string; ts: number }>

  const entries = rows
    .reverse()
    .map(row => ({
      id: `${entityId}:event:${row.id}`,
      ts: row.ts,
      kind: 'lead_event' as const,
      title: row.eventType,
      body: row.payload,
      raw: row.payload,
    }))

  const tailId = rows[0]?.id
  return {
    entries,
    tailCursor: tailId ? `event:${tailId}` : null,
  }
}

export function streamLeadLogs(res: Response, entityId: string, afterEventId: number): () => void {
  const handler = (event: OrcEvent) => {
    if (event.entityId !== entityId || event.entityType !== 'lead') return
    if (event.sequence <= afterEventId) return
    const payload = JSON.stringify({
      id: `${entityId}:event:${event.sequence}`,
      ts: event.ts,
      kind: 'lead_event',
      title: event.eventType,
      body: JSON.stringify(event.payload),
      raw: JSON.stringify(event.payload),
    })
    res.write(`data: ${payload}\n\n`)
  }

  eventBus.on('event', handler)
  return () => eventBus.off('event', handler)
}

export function streamWorkerLogs(res: Response, entityId: string, logPath: string, afterLine: number): () => void {
  let lastLine = afterLine
  const timer = setInterval(async () => {
    let content = ''
    try {
      content = await fs.readFile(logPath, 'utf8')
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      return
    }

    const lines = content.split('\n').filter(Boolean)
    if (lines.length <= lastLine) return

    const additions = lines.slice(lastLine)
    additions.forEach((line, index) => {
      const entry = normalizeWorkerLine(entityId, line, lastLine + index + 1)
      if (entry) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`)
      }
    })
    lastLine = lines.length
  }, 500)

  return () => clearInterval(timer)
}
```

- [ ] **Step 4: Wire the initial-window and SSE routes**

Modify `apps/api/src/server/routes.ts`:

```ts
import { getArtifactPath, getAllTasks, getMergeCandidates, getPreviews, getTaskEdges, getWorktrees } from '../db/queries'
import { readLeadLogWindow, readWorkerLogWindow, streamLeadLogs, streamWorkerLogs } from './entityLogs'

function parseLimit(value: unknown): number {
  const numeric = Number(value ?? 500)
  if (!Number.isFinite(numeric) || numeric <= 0) return 500
  return Math.min(1000, Math.floor(numeric))
}

r.get('/entities/:entityId/logs', async (req, res) => {
  const entityId = req.params.entityId
  const limit = parseLimit(req.query.limit)
  const task = getAllTasks(db).find(t => t.id === entityId)
  if (!task) {
    res.status(404).json({ error: `entity not found: ${entityId}` })
    return
  }

  if (task.type === 'lead') {
    res.json(readLeadLogWindow(db, entityId, limit))
    return
  }

  if (task.type === 'worker') {
    const worktree = getWorktrees(db).find(wt => wt.workerId === entityId)
    if (!worktree) {
      res.status(404).json({ error: `worktree not found for ${entityId}` })
      return
    }
    const logPath = getArtifactPath(db, entityId, 'session_log') ?? `${worktree.path}/.orc/.orc-session.jsonl`
    res.json(await readWorkerLogWindow(entityId, logPath, limit))
    return
  }

  res.status(400).json({ error: `unsupported entity type for logs: ${task.type}` })
})

r.get('/entities/:entityId/logs/stream', (req, res) => {
  const entityId = req.params.entityId
  const task = getAllTasks(db).find(t => t.id === entityId)
  if (!task) {
    res.status(404).end()
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const afterValue = String(req.query.after ?? '')
  let cleanup = () => {}

  if (task.type === 'lead') {
    const afterEventId = afterValue.startsWith('event:') ? Number(afterValue.slice(6)) : 0
    cleanup = streamLeadLogs(res, entityId, Number.isFinite(afterEventId) ? afterEventId : 0)
  } else if (task.type === 'worker') {
    const worktree = getWorktrees(db).find(wt => wt.workerId === entityId)
    if (!worktree) {
      res.end()
      return
    }
    const logPath = getArtifactPath(db, entityId, 'session_log') ?? `${worktree.path}/.orc/.orc-session.jsonl`
    const afterLine = afterValue.startsWith('line:') ? Number(afterValue.slice(5)) : 0
    cleanup = streamWorkerLogs(res, entityId, logPath, Number.isFinite(afterLine) ? afterLine : 0)
  }

  req.on('close', () => {
    cleanup()
    res.end()
  })
})
```

- [ ] **Step 5: Re-run the log tests and confirm they pass**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run src/server/entityLogs.test.ts src/server/routes.test.ts
```

Expected:
- the worker log window test passes with `line:<n>` cursors
- the lead log window test passes with `event:<id>` cursors
- the new logs route test passes
- detail route tests from Task 2 continue to pass

- [ ] **Step 6: Commit the log API slice**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && git add apps/api/src/server/entityLogs.ts apps/api/src/server/entityLogs.test.ts apps/api/src/server/routes.ts apps/api/src/server/routes.test.ts && git commit -m "feat: stream dashboard entity logs"
```

Expected:
- one commit containing log normalization, initial window routes, and SSE route wiring

---

### Task 4: Add Web Test Harness, Entity Hooks, And Real Detail Rendering

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/hooks/useEntityDetail.ts`
- Create: `apps/web/src/hooks/useEntityLogs.ts`
- Modify: `apps/web/src/components/DetailPanel.tsx`
- Create: `apps/web/src/components/DetailPanel.test.tsx`
- Test: `apps/web/src/components/DetailPanel.test.tsx`

- [ ] **Step 1: Add web test dependencies and jsdom configuration**

Modify `apps/web/package.json` `devDependencies` to include:

```json
{
  "@tailwindcss/postcss": "^4",
  "@testing-library/jest-dom": "^6.6.3",
  "@testing-library/react": "^16.3.0",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "jsdom": "^26.1.0",
  "tailwindcss": "^4",
  "typescript": "^5",
  "vitest": "^2.0.0"
}
```

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

Create `apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && pnpm install
```

Expected:
- lockfile updates to include Testing Library + jsdom
- no source-code tests are run yet

- [ ] **Step 2: Write the failing `DetailPanel` rendering tests**

Create `apps/web/src/components/DetailPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DetailPanel } from './DetailPanel'

const useEntityDetailMock = vi.fn()
const useEntityLogsMock = vi.fn()

vi.mock('../hooks/useEntityDetail', () => ({
  useEntityDetail: (entityId: string | null) => useEntityDetailMock(entityId),
}))

vi.mock('../hooks/useEntityLogs', () => ({
  useEntityLogs: (entityId: string | null) => useEntityLogsMock(entityId),
}))

function renderPanel(selectedId: string) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <DetailPanel
        selectedId={selectedId}
        sections={[
          {
            id: 'main',
            state: 'running',
            workers: [
              {
                id: 'main-v1',
                state: 'running',
                branch: 'feat/main-v1',
                selected: false,
                contextAvailable: false,
                previewArtifacts: [{ mode: 'solo', previewUrl: 'https://example.test/solo' }],
              },
            ],
          },
        ]}
      />
    </QueryClientProvider>,
  )
}

describe('DetailPanel', () => {
  beforeEach(() => {
    useEntityDetailMock.mockReset()
    useEntityLogsMock.mockReset()
  })

  it('renders worker plan, logs, diff, and preview tabs with inline content', () => {
    useEntityDetailMock.mockReturnValue({
      data: {
        entityId: 'main-v1',
        entityType: 'worker',
        title: 'main-v1',
        resolvedPaths: {
          worktreePath: '/repo/.orc/worktrees/main-v1',
          planPath: '/repo/.orc/worktrees/main-v1/.orc/worker-plan.md',
          logPath: '/repo/.orc/worktrees/main-v1/.orc/.orc-session.jsonl',
        },
        plan: { status: 'ready', content: '# Worker Plan\n\n- [ ] inspect\n' },
        diff: { status: 'ready', content: 'diff --git a/README.md b/README.md', branch: 'feat/main-v1', baseBranch: 'main' },
      },
      isLoading: false,
    })
    useEntityLogsMock.mockReturnValue({
      entries: [{ id: 'main-v1:line:1', ts: 1, kind: 'stdout', title: 'stdout', body: 'hello worker', raw: '{"ts":1,"output":"hello worker"}' }],
      status: 'ready',
      error: null,
    })

    renderPanel('main-v1')

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText('/repo/.orc/worktrees/main-v1/.orc/worker-plan.md')).toBeInTheDocument()
    expect(screen.getByText('# Worker Plan')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText('/repo/.orc/worktrees/main-v1/.orc/.orc-session.jsonl')).toBeInTheDocument()
    expect(screen.getByText('hello worker')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByText(/diff --git a\/README.md b\/README.md/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
  })

  it('renders lead plan, lead-only logs, and selected winner diff', () => {
    useEntityDetailMock.mockReturnValue({
      data: {
        entityId: 'main-lead',
        entityType: 'lead',
        title: 'main-lead',
        resolvedPaths: {
          planPath: '/repo/.orc/runs/r1/leads/main.md',
          winnerWorktreePath: '/repo/.orc/worktrees/main-v1',
        },
        plan: { status: 'ready', content: '# Lead Plan\n' },
        diff: { status: 'ready', content: 'diff --git a/README.md b/README.md', winnerWorkerId: 'main-v1', branch: 'feat/main-v1', baseBranch: 'main' },
      },
      isLoading: false,
    })
    useEntityLogsMock.mockReturnValue({
      entries: [{ id: 'main-lead:event:41', ts: 41, kind: 'lead_event', title: 'ReviewComplete', body: '{"winnerId":"main-v1"}', raw: '{"winnerId":"main-v1"}' }],
      status: 'ready',
      error: null,
    })

    renderPanel('main-lead')

    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diff' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText('/repo/.orc/runs/r1/leads/main.md')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText('ReviewComplete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByText(/diff --git a\/README.md b\/README.md/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the web test and confirm it fails**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web && pnpm vitest run src/components/DetailPanel.test.tsx
```

Expected:
- the test fails because `useEntityDetail` and `useEntityLogs` do not exist yet
- the test also fails because `DetailPanel` has no `Diff` tab and still renders placeholder plan/log panels

- [ ] **Step 4: Implement the new hooks and refactor `DetailPanel` to use them**

Create `apps/web/src/hooks/useEntityDetail.ts`:

```ts
'use client'
import { useQuery } from '@tanstack/react-query'
import type { EntityDetail } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function useEntityDetail(entityId: string | null) {
  return useQuery<EntityDetail>({
    queryKey: ['entity-detail', entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const res = await fetch(`${API}/api/entities/${entityId}/detail`)
      if (!res.ok) throw new Error(`failed to load detail for ${entityId}`)
      return res.json()
    },
  })
}
```

Create `apps/web/src/hooks/useEntityLogs.ts`:

```ts
'use client'
import { useEffect, useState } from 'react'
import type { LogEntry, LogsResponse } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function useEntityLogs(entityId: string | null) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entityId) {
      setEntries([])
      setStatus('idle')
      setError(null)
      return
    }

    let closed = false
    let eventSource: EventSource | null = null

    setStatus('loading')
    setError(null)

    ;(async () => {
      const res = await fetch(`${API}/api/entities/${entityId}/logs`)
      if (!res.ok) throw new Error(`failed to load logs for ${entityId}`)
      const payload = await res.json() as LogsResponse
      if (closed) return

      setEntries(payload.entries)
      setStatus('ready')

      const suffix = payload.tailCursor ? `?after=${encodeURIComponent(payload.tailCursor)}` : ''
      eventSource = new EventSource(`${API}/api/entities/${entityId}/logs/stream${suffix}`)
      eventSource.onmessage = event => {
        const entry = JSON.parse(event.data) as LogEntry
        setEntries(prev => prev.some(existing => existing.id === entry.id) ? prev : [...prev, entry])
      }
    })().catch((err: any) => {
      if (closed) return
      setStatus('error')
      setError(err?.message ?? 'failed to load logs')
    })

    return () => {
      closed = true
      eventSource?.close()
    }
  }, [entityId])

  return { entries, status, error }
}
```

Refactor `apps/web/src/components/DetailPanel.tsx` around these additions:

```tsx
import { useEntityDetail } from '../hooks/useEntityDetail'
import { useEntityLogs } from '../hooks/useEntityLogs'

function TextPanel({
  label,
  pathValue,
  content,
  emptyMessage,
}: {
  label: string
  pathValue?: string | null
  content: string | null | undefined
  emptyMessage: string
}) {
  return (
    <div className="max-w-3xl space-y-3">
      {pathValue ? (
        <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
          <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">{label} path</span>
          <CodeBlock>{pathValue}</CodeBlock>
        </div>
      ) : null}
      <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
        <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-300 font-mono leading-relaxed">
          {content && content.length > 0 ? content : emptyMessage}
        </pre>
      </div>
    </div>
  )
}

const { data: detail } = useEntityDetail(selectedId)
const logs = useEntityLogs(selectedId)

const tabs = isLead
  ? (['compare', 'plan', 'logs', 'diff'] as const)
  : (['plan', 'logs', 'diff', 'preview'] as const)

const TAB_LABEL: Record<string, string> = {
  compare: 'Compare',
  plan: 'Plan',
  logs: 'Logs',
  diff: 'Diff',
  preview: 'Preview',
}
```

Replace the placeholder plan/log rendering blocks with:

```tsx
{tab === 'plan' && detail && (
  <TextPanel
    label="Plan"
    pathValue={detail.entityType === 'worker' ? detail.resolvedPaths.planPath : detail.resolvedPaths.planPath}
    content={detail.plan.content}
    emptyMessage={detail.plan.message ?? 'Plan not available yet.'}
  />
)}

{tab === 'logs' && detail && (
  <div className="max-w-3xl space-y-3">
    {detail.entityType === 'worker' && detail.resolvedPaths.logPath ? (
      <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4 space-y-2">
        <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-[0.12em]">Log path</span>
        <CodeBlock>{detail.resolvedPaths.logPath}</CodeBlock>
      </div>
    ) : null}
    <div className="bg-[#0f1420] border border-[#1c2738] rounded-lg p-4">
      <div className="space-y-2">
        {logs.entries.length > 0 ? logs.entries.map(entry => (
          <div key={entry.id} className="border border-[#1c2738] rounded px-3 py-2 bg-[#0b0e14]">
            <div className="text-[10px] text-gray-500 font-mono">{entry.title}</div>
            <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-300 font-mono leading-relaxed">{entry.body}</pre>
          </div>
        )) : (
          <p className="text-[11px] text-gray-600">
            {logs.status === 'loading' ? 'Loading logs…' : 'No logs available yet.'}
          </p>
        )}
      </div>
    </div>
  </div>
)}

{tab === 'diff' && detail && (
  <TextPanel
    label="Diff"
    pathValue={detail.entityType === 'worker' ? detail.resolvedPaths.worktreePath : detail.resolvedPaths.winnerWorktreePath}
    content={detail.diff.content}
    emptyMessage={detail.diff.message ?? 'No diff available yet.'}
  />
)}
```

- [ ] **Step 5: Re-run the web tests and verify the Next.js build still works**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web && pnpm vitest run src/components/DetailPanel.test.tsx
```

Expected:
- both worker and lead detail tests pass

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web && pnpm build
```

Expected:
- `next build` exits `0`
- no type errors from the new hooks or `DetailPanel` refactor

- [ ] **Step 6: Commit the dashboard detail rendering slice**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/hooks/useEntityDetail.ts apps/web/src/hooks/useEntityLogs.ts apps/web/src/components/DetailPanel.tsx apps/web/src/components/DetailPanel.test.tsx pnpm-lock.yaml && git commit -m "feat: render real dashboard entity details"
```

Expected:
- one commit containing web test harness, hooks, and `DetailPanel` rendering changes

---

### Task 5: Full Verification And Regression Check

**Files:**
- Modify: none
- Verify: `apps/api/src/server/routes.ts`
- Verify: `apps/api/src/server/entityDetails.ts`
- Verify: `apps/api/src/server/entityLogs.ts`
- Verify: `apps/web/src/components/DetailPanel.tsx`
- Verify: `packages/types/src/api.ts`

- [ ] **Step 1: Run the complete API suite**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api && pnpm vitest run
```

Expected:
- all API/unit tests pass, including routes, artifact registration, and log reader coverage

- [ ] **Step 2: Run the shared types test suite**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/packages/types && pnpm test
```

Expected:
- shared type tests pass

- [ ] **Step 3: Run the web detail test and build one more time**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web && pnpm vitest run src/components/DetailPanel.test.tsx && pnpm build
```

Expected:
- detail-panel tests pass
- `next build` exits `0`

- [ ] **Step 4: Perform the manual runtime acceptance check**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && pnpm dev
```

Then verify manually in the browser:

```text
1. Start or resume a run so at least one worker is active.
2. Click a worker in the tree.
3. Confirm Plan shows the real worker plan file path and file contents.
4. Confirm Logs shows the real `.orc/.orc-session.jsonl` path and appends new entries live.
5. Confirm Diff shows a real git patch, not a placeholder path.
6. Click a lead in the tree.
7. Confirm Logs shows only lead-owned activity events.
8. Confirm Diff shows only the selected winner's patch.
9. Confirm worker and lead paths display `.orc/worktrees/...` when that is the active runtime layout.
```

Expected:
- worker logs append without manual refresh
- lead logs do not include worker events
- plan/diff surfaces display real content inline

- [ ] **Step 5: Commit the verified feature**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree && git add packages/types/src/api.ts apps/api/src/db/queries.ts apps/api/src/agents/types.ts apps/api/src/agents/codex-cli.ts apps/api/src/agents/codex-cli.test.ts apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/lead.ts apps/api/src/orchestrator/worker.ts apps/api/src/orchestrator/artifactRegistration.test.ts apps/api/src/git/worktree.ts apps/api/src/server/entityDetails.ts apps/api/src/server/entityLogs.ts apps/api/src/server/entityLogs.test.ts apps/api/src/server/routes.ts apps/api/src/server/routes.test.ts apps/web/package.json apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/hooks/useEntityDetail.ts apps/web/src/hooks/useEntityLogs.ts apps/web/src/components/DetailPanel.tsx apps/web/src/components/DetailPanel.test.tsx pnpm-lock.yaml && git commit -m "feat: add live dashboard entity detail views"
```

Expected:
- one final feature commit after all verification evidence is green

---

## Self-Review

- Spec coverage:
  - artifact-backed path registration is implemented in Task 1
  - worker/lead detail API coverage is implemented in Task 2
  - log window + SSE behavior is implemented in Task 3
  - dashboard rendering and web tests are implemented in Task 4
  - verification and manual acceptance are covered in Task 5
- Placeholder scan:
  - no `TODO`, `TBD`, or “implement later” markers remain
  - every task lists exact file paths
  - every code-changing step includes concrete code
- Type consistency:
  - `entityId` remains `tasks.id`
  - worker log cursors use `line:<n>`
  - lead log cursors use `event:<id>`
  - preview URLs stay on `/api/orchestration` while detail/log content moves to `/api/entities/:entityId/...`
