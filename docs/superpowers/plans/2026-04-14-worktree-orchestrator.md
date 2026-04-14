# WorkTree Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hierarchical multi-agent orchestration system where a Mastermind decomposes a user goal into parallel sections, each handled by a Lead team of Codex workers, with a live Next.js dashboard for visibility and control.

**Architecture:** Single Node.js process (apps/api) with in-memory command queues and event bus. All state written to SQLite (event_log + projections via Drizzle). Express + WebSocket pushes events to Next.js dashboard (apps/web). Zod schemas in @orc/types are the contract between both apps.

**Tech Stack:** Turborepo · pnpm · Biome (ultracite) · Express · Drizzle + SQLite · Zod · Next.js · TanStack Query · Vitest · Codex CLI

---

## File Map

```
apps/api/src/
  db/
    schema.ts          # Drizzle table definitions (event_log, projections)
    journal.ts         # appendEvent() — the one write path
    queries.ts         # read helpers (always hit projections)
    projections/
      tasks.ts         # upsert task state
      runs.ts          # upsert run state
      worktrees.ts     # upsert worktree state
      mergeQueue.ts    # upsert merge_queue rows
      previews.ts      # upsert preview rows
      artifacts.ts     # upsert artifact paths
  events/
    eventBus.ts        # singleton EventEmitter (publish-only, no commands)
    commandQueues.ts   # per-role async queues (command transport)
    types.ts           # re-export from @orc/types
  git/
    worktree.ts        # createWorktree / removeWorktree / listWorktrees
    reconcile.ts       # reconcileWorktrees() — boot-time recovery
    planFiles.ts       # createRunPlan / createLeadPlan / createWorkerPlan
  agents/
    types.ts           # WorkerAgent interface, WorkerTask, WorkerResult
    codex-cli.ts       # CodexCLIAdapter
    mock.ts            # MockAdapter for tests
  orchestrator/
    worker.ts          # Worker state machine
    lead.ts            # Lead state machine (PM + workers + reviewer)
    mastermind.ts      # Mastermind state machine
    context.ts         # ContextManager (buildMastermindCtx etc.)
    concurrency.ts     # maxConcurrentWorkers semaphore
    watchdog.ts        # 5s health polling loop
    mergeCoordinator.ts # serialized FIFO merge queue
    recovery.ts        # boot-time SQLite → in-memory reconstruction
  server/
    app.ts             # Express app factory
    routes.ts          # REST endpoints
    wsHandler.ts       # WebSocket upgrade + event bus subscription
  cli.ts               # orc run / orc status / orc resume

apps/web/src/
  app/
    page.tsx           # dashboard root
    layout.tsx
  components/
    TreePanel.tsx      # orchestration tree: mastermind → leads → workers
    DetailPanel.tsx    # Plan/Logs/Diff/Preview tabs + action buttons
    EventStream.tsx    # right panel: live event feed
    WorkerCard.tsx     # single worker row in tree
  hooks/
    useOrchestration.ts  # TanStack Query initial hydration
    useEventStream.ts    # WebSocket live updates → patch cache
  ws/
    client.ts          # WebSocket client + reconnect

packages/types/src/
  events.ts            # all event Zod schemas
  commands.ts          # all command Zod schemas
  api.ts               # REST request/response schemas
  db.ts                # Drizzle inferred types re-exported

templates/
  strudel-track.toml   # Strudel workflow decomposition template

skills/
  mastermind.md
  lead.md
  pm-agent.md
  implementer.md
  reviewer.md
  run-planner.md
  lead-planner.md
  worker-planner.md
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (workspace root)
- Create: `turbo.json`
- Create: `pnpm-workspace.yaml`
- Create: `biome.json` (root)
- Create: `packages/config/biome.json`
- Create: `packages/config/package.json`
- Create: `packages/types/package.json`
- Create: `packages/types/src/index.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`

- [ ] **Step 1: Create workspace root**

```json
// package.json
{
  "name": "worktree-orchestrator",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "turbo": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "persistent": true, "cache": false },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 2: Create shared Biome config**

```json
// packages/config/biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "extends": ["ultracite"],
  "files": { "ignore": ["node_modules", ".next", "dist", ".turbo"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true },
  "organizeImports": { "enabled": true }
}
```

```json
// packages/config/package.json
{
  "name": "@orc/config",
  "version": "0.0.1",
  "private": true,
  "files": ["biome.json"]
}
```

```json
// biome.json (root — extends shared config)
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "extends": ["./packages/config/biome.json"]
}
```

- [ ] **Step 3: Create @orc/types scaffold**

```json
// packages/types/package.json
{
  "name": "@orc/types",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

```typescript
// packages/types/src/index.ts
export * from './events'
export * from './commands'
export * from './api'
```

- [ ] **Step 4: Create apps/api scaffold**

```json
// apps/api/package.json
{
  "name": "@orc/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/cli.ts",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@orc/types": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.36.0",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "zod": "^3.23.0",
    "toml": "^3.0.0",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@orc/config": "workspace:*",
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.0",
    "@types/ws": "^8.5.0",
    "drizzle-kit": "^0.27.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

```json
// apps/api/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "paths": { "@orc/types": ["../../packages/types/src/index.ts"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create apps/web scaffold**

```bash
cd apps/web && pnpm dlx create-next-app@latest . \
  --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

Then add to `apps/web/package.json` dependencies:
```json
{
  "@orc/types": "workspace:*",
  "@tanstack/react-query": "^5.0.0",
  "zod": "^3.23.0"
}
```

- [ ] **Step 6: Install and verify**

```bash
pnpm install
pnpm build
```

Expected: no errors, workspace links resolved.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffold — turborepo, biome, @orc/types, apps/api, apps/web"
```

---

## Task 2: @orc/types — Zod schemas

**Files:**
- Create: `packages/types/src/events.ts`
- Create: `packages/types/src/commands.ts`
- Create: `packages/types/src/api.ts`
- Create: `packages/types/src/db.ts`
- Test: `packages/types/src/events.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/types/src/events.test.ts
import { describe, it, expect } from 'vitest'
import { WorkerProgressEvent, LeadDoneEvent, OrcEventSchema } from './events'

describe('event schemas', () => {
  it('parses WorkerProgress event', () => {
    const raw = {
      entityId: 'bass-v1', entityType: 'worker',
      eventType: 'WorkerProgress',
      sequence: 1, ts: Date.now(),
      payload: { output: 'Writing bass pattern…', ts: Date.now() }
    }
    expect(OrcEventSchema.parse(raw)).toMatchObject({ entityId: 'bass-v1' })
  })

  it('rejects event with missing entityId', () => {
    expect(() => OrcEventSchema.parse({ eventType: 'WorkerProgress' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/types && pnpm vitest run
```

Expected: `Cannot find module './events'`

- [ ] **Step 3: Implement events.ts**

```typescript
// packages/types/src/events.ts
import { z } from 'zod'

export const EntityTypeSchema = z.enum([
  'mastermind', 'lead', 'worker', 'pm', 'reviewer', 'merge-fix-worker'
])

export const BaseEventSchema = z.object({
  entityId:   z.string(),
  entityType: EntityTypeSchema,
  eventType:  z.string(),
  sequence:   z.number().int().positive(),
  ts:         z.number().int(),
  payload:    z.record(z.unknown()),
})

// --- Worker events ---
export const WorkerProgressEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerProgress'),
  payload:   z.object({ output: z.string(), ts: z.number() }),
})

export const WorkerDoneEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerDone'),
  payload:   z.object({ branch: z.string(), diff: z.string() }),
})

export const WorkerFailedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerFailed'),
  payload:   z.object({ error: z.string(), retryable: z.boolean() }),
})

export const WorkerStalledEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerStalled'),
  payload:   z.object({ lastSeenAt: z.number() }),
})

export const WorkerZombieEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerZombie'),
  payload:   z.object({ pid: z.number() }),
})

export const WorkerRecoveredEventSchema = BaseEventSchema.extend({
  eventType: z.literal('WorkerRecovered'),
  payload:   z.object({}),
})

// --- Lead events ---
export const LeadPlanReadyEventSchema = BaseEventSchema.extend({
  eventType: z.literal('LeadPlanReady'),
  payload:   z.object({ workerPrompts: z.array(z.string()) }),
})

export const ReviewCompleteEventSchema = BaseEventSchema.extend({
  eventType: z.literal('ReviewComplete'),
  payload:   z.object({ winnerId: z.string(), reasoning: z.string() }),
})

export const LeadDoneEventSchema = BaseEventSchema.extend({
  eventType: z.literal('LeadDone'),
  payload:   z.object({ branch: z.string(), sectionId: z.string() }),
})

export const LeadFailedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('LeadFailed'),
  payload:   z.object({ reason: z.string() }),
})

export const MergeRequestedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('MergeRequested'),
  payload:   z.object({ leadId: z.string(), worktreeId: z.string(), targetBranch: z.string() }),
})

export const MergeConflictEventSchema = BaseEventSchema.extend({
  eventType: z.literal('MergeConflict'),
  payload:   z.object({ mergeId: z.string(), conflictFiles: z.array(z.string()) }),
})

export const MergeResolvedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('MergeResolved'),
  payload:   z.object({ mergeId: z.string(), repairBranch: z.string(), summary: z.string(), checksPassed: z.boolean() }),
})

export const MergeCompleteEventSchema = BaseEventSchema.extend({
  eventType: z.literal('MergeComplete'),
  payload:   z.object({ mergeId: z.string(), targetBranch: z.string() }),
})

// --- Mastermind events ---
export const PlanReadyEventSchema = BaseEventSchema.extend({
  eventType: z.literal('PlanReady'),
  payload:   z.object({ sections: z.array(z.string()), runId: z.string() }),
})

export const LeadDelegatedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('LeadDelegated'),
  payload:   z.object({ leadId: z.string(), sectionId: z.string() }),
})

export const OrchestrationCompleteEventSchema = BaseEventSchema.extend({
  eventType: z.literal('OrchestrationComplete'),
  payload:   z.object({ runBranch: z.string() }),
})

export const OrchestrationFailedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('OrchestrationFailed'),
  payload:   z.object({ reason: z.string() }),
})

export const CommandIssuedEventSchema = BaseEventSchema.extend({
  eventType: z.literal('CommandIssued'),
  payload:   z.object({ from: z.string(), to: z.string(), commandType: z.string(), commandPayload: z.record(z.unknown()) }),
})

export const OrcEventSchema = z.discriminatedUnion('eventType', [
  WorkerProgressEventSchema,
  WorkerDoneEventSchema,
  WorkerFailedEventSchema,
  WorkerStalledEventSchema,
  WorkerZombieEventSchema,
  WorkerRecoveredEventSchema,
  LeadPlanReadyEventSchema,
  ReviewCompleteEventSchema,
  LeadDoneEventSchema,
  LeadFailedEventSchema,
  MergeRequestedEventSchema,
  MergeConflictEventSchema,
  MergeResolvedEventSchema,
  MergeCompleteEventSchema,
  PlanReadyEventSchema,
  LeadDelegatedEventSchema,
  OrchestrationCompleteEventSchema,
  OrchestrationFailedEventSchema,
  CommandIssuedEventSchema,
])

export type OrcEvent = z.infer<typeof OrcEventSchema>
export type EntityType = z.infer<typeof EntityTypeSchema>
export type LeadDoneEvent = z.infer<typeof LeadDoneEventSchema>
export type WorkerProgressEvent = z.infer<typeof WorkerProgressEventSchema>
```

- [ ] **Step 4: Implement commands.ts**

```typescript
// packages/types/src/commands.ts
import { z } from 'zod'

export const SpawnWorkerCommandSchema = z.object({
  commandType: z.literal('SpawnWorker'),
  workerId:    z.string(),
  prompt:      z.string(),
  strategy:    z.string().optional(),
  errorHistory: z.array(z.string()).default([]),
})

export const AbortCommandSchema = z.object({
  commandType:    z.literal('Abort'),
  targetWorkerId: z.string().optional(),
})

export const RetryCommandSchema = z.object({
  commandType: z.literal('Retry'),
  workerId:    z.string(),
})

export const ForceApproveCommandSchema = z.object({
  commandType: z.literal('ForceApprove'),
  winnerId:    z.string(),
})

export const InjectConstraintCommandSchema = z.object({
  commandType: z.literal('InjectConstraint'),
  constraint:  z.string(),
})

export const OrcCommandSchema = z.discriminatedUnion('commandType', [
  SpawnWorkerCommandSchema,
  AbortCommandSchema,
  RetryCommandSchema,
  ForceApproveCommandSchema,
  InjectConstraintCommandSchema,
])

export type OrcCommand = z.infer<typeof OrcCommandSchema>
```

- [ ] **Step 5: Implement api.ts and db.ts**

```typescript
// packages/types/src/api.ts
import { z } from 'zod'

export const OrchestrationStateSchema = z.object({
  runId:       z.string(),
  status:      z.enum(['idle','planning','delegating','monitoring','merging','done','failed']),
  sections:    z.array(z.object({
    id:      z.string(),
    state:   z.string(),
    workers: z.array(z.object({
      id:          z.string(),
      state:       z.string(),
      branch:      z.string().optional(),
      previewPort: z.number().optional(),
    })),
  })),
  events:      z.array(z.unknown()),
})

export type OrchestrationState = z.infer<typeof OrchestrationStateSchema>
```

```typescript
// packages/types/src/db.ts
// Drizzle types re-exported after schema is defined in apps/api
// Placeholder — filled in Task 3
export {}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
cd packages/types && pnpm vitest run
```

Expected: 2 passing

- [ ] **Step 7: Commit**

```bash
git add packages/types
git commit -m "feat: @orc/types — Zod schemas for all events, commands, API types"
```

---

## Task 3: SQLite schema + Drizzle

**Files:**
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/journal.ts`
- Create: `apps/api/src/db/queries.ts`
- Create: `apps/api/src/db/projections/tasks.ts`
- Create: `apps/api/src/db/projections/worktrees.ts`
- Create: `apps/api/src/db/projections/mergeQueue.ts`
- Create: `apps/api/src/db/projections/previews.ts`
- Create: `apps/api/drizzle.config.ts`
- Test: `apps/api/src/db/journal.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/db/journal.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, appendEvent, getEventsSince } from './journal'
import Database from 'better-sqlite3'

describe('journal', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('appends an event and retrieves it', () => {
    const event = {
      entityId: 'w1', entityType: 'worker' as const,
      eventType: 'WorkerProgress', sequence: 1, ts: Date.now(),
      payload: { output: 'hello', ts: Date.now() }
    }
    appendEvent(db, event)
    const rows = getEventsSince(db, 0)
    expect(rows).toHaveLength(1)
    expect(rows[0].entityId).toBe('w1')
  })

  it('rejects duplicate sequence for same entity', () => {
    const event = {
      entityId: 'w1', entityType: 'worker' as const,
      eventType: 'WorkerProgress', sequence: 1, ts: Date.now(),
      payload: {}
    }
    appendEvent(db, event)
    expect(() => appendEvent(db, event)).toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/db/journal.test.ts
```

Expected: `Cannot find module './journal'`

- [ ] **Step 3: Implement schema.ts**

```typescript
// apps/api/src/db/schema.ts
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'

export const eventLog = sqliteTable('event_log', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  entityId:   text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  eventType:  text('event_type').notNull(),
  sequence:   integer('sequence').notNull(),
  payload:    text('payload', { mode: 'json' }).notNull(),
  ts:         integer('ts').notNull(),
}, (t) => ({ uniq: { columns: [t.entityId, t.sequence], name: 'entity_seq_uniq' } }))

export const tasks = sqliteTable('tasks', {
  id:              text('id').primaryKey(),
  type:            text('type').notNull(),
  parentId:        text('parent_id'),
  state:           text('state').notNull().default('pending'),
  retryCount:      integer('retry_count').notNull().default(0),
  taskPrompt:      text('task_prompt'),
  strategy:        text('strategy'),
  spawnGeneration: integer('spawn_generation').notNull().default(0),
  metadata:        text('metadata', { mode: 'json' }),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
})

export const runs = sqliteTable('runs', {
  id:           text('id').primaryKey(),
  entityId:     text('entity_id').notNull(),
  adapterType:  text('adapter_type'),
  pid:          integer('pid'),
  startedAt:    integer('started_at').notNull(),
  lastSeenAt:   integer('last_seen_at'),
  lastOutputTs: integer('last_output_ts'),
})

export const worktrees = sqliteTable('worktrees', {
  id:          text('id').primaryKey(),
  workerId:    text('worker_id').notNull(),
  path:        text('path').notNull(),
  branch:      text('branch').notNull(),
  baseBranch:  text('base_branch').notNull(),
  gitStatus:   text('git_status').default('clean'),
  diffSummary: text('diff_summary'),
})

export const taskEdges = sqliteTable('task_edges', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  parentId: text('parent_id').notNull(),
  childId:  text('child_id').notNull(),
  edgeType: text('edge_type').notNull(), // 'spawned' | 'retry_of'
})

export const mergeCandidates = sqliteTable('merge_candidates', {
  id:              text('id').primaryKey(),
  leadId:          text('lead_id').notNull(),
  winnerWorkerId:  text('winner_worker_id').notNull(),
  targetBranch:    text('target_branch').notNull(),
  reviewerReasoning: text('reviewer_reasoning'),
})

export const mergeQueue = sqliteTable('merge_queue', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  leadId:           text('lead_id').notNull(),
  winnerWorktreeId: text('winner_worktree_id').notNull(),
  targetBranch:     text('target_branch').notNull(),
  status:           text('status').notNull().default('pending'),
  conflictDetails:  text('conflict_details', { mode: 'json' }),
  fixWorkerId:      text('fix_worker_id'),
  fixAttempts:      integer('fix_attempts').notNull().default(0),
  createdAt:        integer('created_at').notNull(),
  mergedAt:         integer('merged_at'),
})

export const previews = sqliteTable('previews', {
  id:          text('id').primaryKey(),
  worktreeId:  text('worktree_id').notNull(),
  port:        integer('port').notNull(),
  url:         text('url').notNull(),
  status:      text('status').notNull().default('inactive'), // 'inactive' | 'active'
  launchedAt:  integer('launched_at'),
})

export const artifacts = sqliteTable('artifacts', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  entityId:     text('entity_id').notNull(),
  artifactType: text('artifact_type').notNull(), // 'run_plan'|'lead_plan'|'worker_plan'
  path:         text('path').notNull(),
  updatedAt:    integer('updated_at').notNull(),
})
```

- [ ] **Step 4: Implement journal.ts**

```typescript
// apps/api/src/db/journal.ts
import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'
import { eventLog } from './schema'
import type { OrcEvent } from '@orc/types'
import { eventBus } from '../events/eventBus'

export type Db = BetterSQLite3Database<typeof schema>

export function createDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  // create tables inline for MVP (no migrations file needed)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL,
      UNIQUE(entity_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      parent_id TEXT,
      state TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      task_prompt TEXT,
      strategy TEXT,
      spawn_generation INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      adapter_type TEXT,
      pid INTEGER,
      started_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      last_output_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      git_status TEXT DEFAULT 'clean',
      diff_summary TEXT
    );
    CREATE TABLE IF NOT EXISTS task_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      edge_type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS merge_candidates (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      winner_worker_id TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      reviewer_reasoning TEXT
    );
    CREATE TABLE IF NOT EXISTS merge_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      winner_worktree_id TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      conflict_details TEXT,
      fix_worker_id TEXT,
      fix_attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      merged_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS previews (
      id TEXT PRIMARY KEY,
      worktree_id TEXT NOT NULL,
      port INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inactive',
      launched_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

let _db: Db | null = null

export function getDb(): Db {
  if (!_db) throw new Error('DB not initialised — call initDb() first')
  return _db
}

export function initDb(path: string): Db {
  _db = createDb(path)
  return _db
}

export function appendEvent(db: Db, event: Omit<OrcEvent, never>): void {
  const sqlite = (db as any).session.client as Database.Database
  sqlite.prepare(`
    INSERT INTO event_log (entity_id, entity_type, event_type, sequence, payload, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.entityId,
    event.entityType,
    event.eventType,
    event.sequence,
    JSON.stringify(event.payload),
    event.ts,
  )
}

export function getEventsSince(db: Db, afterId: number) {
  const sqlite = (db as any).session.client as Database.Database
  return sqlite.prepare('SELECT * FROM event_log WHERE id > ? ORDER BY id ASC').all(afterId) as Array<{
    id: number; entityId: string; entityType: string; eventType: string;
    sequence: number; payload: string; ts: number
  }>
}

/** Write event + update projection + emit to event bus — all in one SQLite transaction */
export function writeEvent(db: Db, event: OrcEvent, updateProjection: () => void): void {
  const sqlite = (db as any).session.client as Database.Database
  sqlite.transaction(() => {
    appendEvent(db, event)
    updateProjection()
  })()
  // emit outside transaction — purely observational
  eventBus.emit('event', event)
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/db/journal.test.ts
```

Expected: 2 passing

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db packages/types/src/db.ts
git commit -m "feat: SQLite schema (Drizzle) + journal write path"
```

---

## Task 4: Event bus + command queues

**Files:**
- Create: `apps/api/src/events/eventBus.ts`
- Create: `apps/api/src/events/commandQueues.ts`
- Test: `apps/api/src/events/eventBus.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/events/eventBus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { eventBus } from './eventBus'
import { CommandQueue } from './commandQueues'
import type { OrcEvent } from '@orc/types'

describe('eventBus', () => {
  it('emits events to subscribers', () => {
    const handler = vi.fn()
    eventBus.on('event', handler)
    const e = { entityId: 'x', entityType: 'worker', eventType: 'WorkerProgress',
                 sequence: 1, ts: 1, payload: { output: 'test', ts: 1 } } as OrcEvent
    eventBus.emit('event', e)
    expect(handler).toHaveBeenCalledWith(e)
    eventBus.off('event', handler)
  })
})

describe('CommandQueue', () => {
  it('enqueues and dequeues commands in FIFO order', async () => {
    const q = new CommandQueue<string>()
    q.enqueue('first')
    q.enqueue('second')
    expect(await q.dequeue()).toBe('first')
    expect(await q.dequeue()).toBe('second')
  })

  it('dequeue waits until item available', async () => {
    const q = new CommandQueue<number>()
    const p = q.dequeue()
    q.enqueue(42)
    expect(await p).toBe(42)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/events/eventBus.test.ts
```

- [ ] **Step 3: Implement eventBus.ts**

```typescript
// apps/api/src/events/eventBus.ts
import { EventEmitter } from 'node:events'
import type { OrcEvent } from '@orc/types'

/** Publish-only event bus. Never used for command delivery. */
class OrcEventBus extends EventEmitter {
  publish(event: OrcEvent): void {
    this.emit('event', event)
  }
}

export const eventBus = new OrcEventBus()
eventBus.setMaxListeners(100)
```

- [ ] **Step 4: Implement commandQueues.ts**

```typescript
// apps/api/src/events/commandQueues.ts

type Resolver<T> = (value: T) => void

/** Per-role in-process async queue. Command transport only — not observable. */
export class CommandQueue<T> {
  private readonly buffer: T[] = []
  private readonly waiters: Resolver<T>[] = []

  enqueue(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
    } else {
      this.buffer.push(item)
    }
  }

  dequeue(): Promise<T> {
    const item = this.buffer.shift()
    if (item !== undefined) return Promise.resolve(item)
    return new Promise<T>((resolve) => { this.waiters.push(resolve) })
  }

  get size(): number { return this.buffer.length }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/events/eventBus.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/events
git commit -m "feat: in-memory event bus (publish-only) + per-role command queues"
```

---

## Task 5: Git worktree manager

**Files:**
- Create: `apps/api/src/git/worktree.ts`
- Create: `apps/api/src/git/reconcile.ts`
- Test: `apps/api/src/git/worktree.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/git/worktree.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { createWorktree, listWorktrees, removeWorktree } from './worktree'

const TMP = path.join(os.tmpdir(), `orc-test-${Date.now()}`)

function initRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir })
  execSync('git config user.email "test@test.com"', { cwd: dir })
  execSync('git config user.name "Test"', { cwd: dir })
  fs.writeFileSync(path.join(dir, 'README.md'), '# test')
  execSync('git add . && git commit -m "init"', { cwd: dir })
}

afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }) })

describe('worktree', () => {
  it('creates and lists a worktree', async () => {
    const repoDir = path.join(TMP, 'repo1')
    initRepo(repoDir)
    const wtPath = path.join(TMP, 'wt1')
    await createWorktree(repoDir, wtPath, 'feat/test-v1')
    const wts = await listWorktrees(repoDir)
    expect(wts.some(w => w.path === wtPath)).toBe(true)
    await removeWorktree(repoDir, wtPath)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/git/worktree.test.ts
```

- [ ] **Step 3: Implement worktree.ts**

```typescript
// apps/api/src/git/worktree.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  head: string
}

export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await fs.mkdir(path.dirname(worktreePath), { recursive: true })
  await git(repoRoot, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'])
  // create .orc directory for worker artifacts
  await fs.mkdir(path.join(worktreePath, '.orc'), { recursive: true })
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--force', worktreePath])
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const output = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  const result: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) current.path = line.slice(9)
    else if (line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '')
    else if (line === '') {
      if (current.path) result.push(current as WorktreeInfo)
      current = {}
    }
  }
  if (current.path) result.push(current as WorktreeInfo)
  return result
}

export async function getWorktreeDiff(worktreePath: string, baseBranch: string): Promise<string> {
  try {
    return await git(worktreePath, ['diff', baseBranch, '--stat'])
  } catch {
    return ''
  }
}

export async function hasCommitsAhead(worktreePath: string, baseBranch: string): Promise<boolean> {
  try {
    const out = await git(worktreePath, ['rev-list', '--count', `${baseBranch}..HEAD`])
    return parseInt(out) > 0
  } catch {
    return false
  }
}

export async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  try {
    const out = await git(worktreePath, ['status', '--porcelain'])
    return out.length > 0
  } catch {
    return false
  }
}

export async function mergeWorktree(
  repoRoot: string,
  targetBranch: string,
  sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  try {
    await git(repoRoot, ['checkout', targetBranch])
    await git(repoRoot, ['merge', sourceBranch, '--no-ff', '-m', `merge: ${sourceBranch} into ${targetBranch}`])
    return { success: true, conflictFiles: [] }
  } catch (err) {
    // collect conflict files
    try {
      const conflicts = await git(repoRoot, ['diff', '--name-only', '--diff-filter=U'])
      const files = conflicts.split('\n').filter(Boolean)
      // abort merge to leave repo clean
      await git(repoRoot, ['merge', '--abort']).catch(() => {})
      return { success: false, conflictFiles: files }
    } catch {
      return { success: false, conflictFiles: [] }
    }
  }
}
```

- [ ] **Step 4: Implement reconcile.ts**

```typescript
// apps/api/src/git/reconcile.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { listWorktrees } from './worktree'

export type DoneMarker = { status: 'done' | 'failed'; exitCode: number; ts: number }

export type WorktreeReconcileStatus =
  | 'done'
  | 'failed'
  | 'interrupted'   // no marker + uncommitted changes
  | 'never-started' // no marker + clean
  | 'missing'       // worktree dir does not exist in git list

export async function readDoneMarker(worktreePath: string): Promise<DoneMarker | null> {
  try {
    const raw = await fs.readFile(path.join(worktreePath, '.orc', '.orc-done.json'), 'utf-8')
    return JSON.parse(raw) as DoneMarker
  } catch {
    return null
  }
}

export async function writeDoneMarker(
  worktreePath: string,
  marker: DoneMarker,
): Promise<void> {
  await fs.writeFile(
    path.join(worktreePath, '.orc', '.orc-done.json'),
    JSON.stringify(marker),
  )
}

export async function reconcileWorktree(
  repoRoot: string,
  worktreePath: string,
  baseBranch: string,
): Promise<WorktreeReconcileStatus> {
  const allWt = await listWorktrees(repoRoot)
  const found = allWt.some(w => w.path === worktreePath)
  if (!found) return 'missing'

  const marker = await readDoneMarker(worktreePath)
  if (marker) return marker.status

  // check for uncommitted changes
  const { hasUncommittedChanges } = await import('./worktree')
  const dirty = await hasUncommittedChanges(worktreePath)
  return dirty ? 'interrupted' : 'never-started'
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/git/worktree.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/git
git commit -m "feat: git worktree manager — create/remove/list/merge + reconcile"
```

---

## Task 6: WorkerAgent interface + CodexCLIAdapter

**Files:**
- Create: `apps/api/src/agents/types.ts`
- Create: `apps/api/src/agents/codex-cli.ts`
- Create: `apps/api/src/agents/mock.ts`
- Test: `apps/api/src/agents/mock.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/agents/mock.test.ts
import { describe, it, expect } from 'vitest'
import { MockAgent } from './mock'

describe('MockAgent', () => {
  it('returns done with a diff after delay', async () => {
    const agent = new MockAgent({ delayMs: 10, outcome: 'done' })
    const result = await agent.run(
      { id: 'w1', prompt: 'test', maxRetries: 1, errorHistory: [] },
      { worktreePath: '/tmp/wt', branch: 'feat/x', baseBranch: 'main',
        entityId: 'w1', planPath: '', leadPlanPath: '', runPlanPath: '' }
    )
    expect(result.status).toBe('done')
    expect(result.branch).toBe('feat/x')
  })

  it('returns failed when outcome is fail', async () => {
    const agent = new MockAgent({ delayMs: 10, outcome: 'failed' })
    const result = await agent.run(
      { id: 'w1', prompt: 'test', maxRetries: 1, errorHistory: [] },
      { worktreePath: '/tmp/wt', branch: 'feat/x', baseBranch: 'main',
        entityId: 'w1', planPath: '', leadPlanPath: '', runPlanPath: '' }
    )
    expect(result.status).toBe('failed')
    expect(result.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/agents/mock.test.ts
```

- [ ] **Step 3: Implement types.ts**

```typescript
// apps/api/src/agents/types.ts
export interface WorkerTask {
  id:           string
  prompt:       string
  maxRetries:   number
  strategy?:    string
  errorHistory: string[]
}

export interface WorkerContext {
  worktreePath: string
  branch:       string
  baseBranch:   string
  entityId:     string
  planPath:     string      // .orc/worker-plan.md inside worktreePath
  leadPlanPath: string      // lead's plan (read-only)
  runPlanPath:  string      // mastermind run plan (read-only)
}

export interface WorkerResult {
  status:    'done' | 'failed'
  branch:    string
  diff?:     string
  error?:    string
  retryable: boolean
}

export interface WorkerAgent {
  run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult>
  abort(): Promise<void>
}
```

- [ ] **Step 4: Implement mock.ts**

```typescript
// apps/api/src/agents/mock.ts
import type { WorkerAgent, WorkerTask, WorkerContext, WorkerResult } from './types'

export class MockAgent implements WorkerAgent {
  private aborted = false

  constructor(private readonly opts: { delayMs: number; outcome: 'done' | 'failed' }) {}

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    await new Promise(r => setTimeout(r, this.opts.delayMs))
    if (this.aborted) return { status: 'failed', branch: ctx.branch, error: 'aborted', retryable: false }
    if (this.opts.outcome === 'failed') {
      return { status: 'failed', branch: ctx.branch, error: 'mock failure', retryable: true }
    }
    return { status: 'done', branch: ctx.branch, diff: '+ mock diff', retryable: false }
  }

  async abort(): Promise<void> { this.aborted = true }
}
```

- [ ] **Step 5: Implement codex-cli.ts**

```typescript
// apps/api/src/agents/codex-cli.ts
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { WorkerAgent, WorkerTask, WorkerContext, WorkerResult } from './types'
import { eventBus } from '../events/eventBus'
import { writeDoneMarker } from '../git/reconcile'
import { getWorktreeDiff } from '../git/worktree'

export class CodexCLIAdapter implements WorkerAgent {
  private proc: ReturnType<typeof spawn> | null = null

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    const sessionLogPath = path.join(ctx.worktreePath, '.orc', '.orc-session.jsonl')
    const sessionLog = await fs.open(sessionLogPath, 'a')

    const prompt = this.buildPrompt(task, ctx)

    return new Promise<WorkerResult>((resolve) => {
      this.proc = spawn('codex', ['--prompt', prompt, '--json'], {
        cwd: ctx.worktreePath,
        env: { ...process.env },
      })

      this.proc.stdout?.on('data', async (chunk: Buffer) => {
        const line = chunk.toString()
        await sessionLog.write(JSON.stringify({ ts: Date.now(), output: line }) + '\n')
        eventBus.publish({
          entityId: ctx.entityId, entityType: 'worker',
          eventType: 'WorkerProgress', sequence: Date.now(),
          ts: Date.now(), payload: { output: line, ts: Date.now() },
        } as any)
      })

      this.proc.on('close', async (code) => {
        await sessionLog.close()
        const marker = { status: code === 0 ? 'done' as const : 'failed' as const, exitCode: code ?? 1, ts: Date.now() }
        await writeDoneMarker(ctx.worktreePath, marker)

        if (marker.status === 'done') {
          const diff = await getWorktreeDiff(ctx.worktreePath, ctx.baseBranch)
          resolve({ status: 'done', branch: ctx.branch, diff, retryable: false })
        } else {
          resolve({ status: 'failed', branch: ctx.branch, error: `exit code ${code}`, retryable: true })
        }
      })

      this.proc.on('error', async (err) => {
        await sessionLog.close()
        await writeDoneMarker(ctx.worktreePath, { status: 'failed', exitCode: 1, ts: Date.now() })
        resolve({ status: 'failed', branch: ctx.branch, error: err.message, retryable: true })
      })
    })
  }

  async abort(): Promise<void> {
    this.proc?.kill('SIGTERM')
  }

  private buildPrompt(task: WorkerTask, ctx: WorkerContext): string {
    const parts = [task.prompt]
    if (task.strategy) parts.push(`\nApproach: ${task.strategy}`)
    if (task.errorHistory.length > 0) {
      parts.push('\nPrior attempts failed:\n' + task.errorHistory.map((e, i) => `${i + 1}. ${e}`).join('\n'))
    }
    parts.push(`\nYour plan file: ${ctx.planPath}`)
    parts.push(`\nLead plan: ${ctx.leadPlanPath}`)
    parts.push(`\nRun plan: ${ctx.runPlanPath}`)
    return parts.join('\n')
  }
}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/agents/mock.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents
git commit -m "feat: WorkerAgent interface + CodexCLIAdapter + MockAgent"
```

---

## Task 7: Concurrency governor + Worker state machine

**Files:**
- Create: `apps/api/src/orchestrator/concurrency.ts`
- Create: `apps/api/src/orchestrator/worker.ts`
- Test: `apps/api/src/orchestrator/concurrency.test.ts`
- Test: `apps/api/src/orchestrator/worker.test.ts`

- [ ] **Step 1: Write failing test for concurrency**

```typescript
// apps/api/src/orchestrator/concurrency.test.ts
import { describe, it, expect } from 'vitest'
import { ConcurrencyGovernor } from './concurrency'

describe('ConcurrencyGovernor', () => {
  it('allows workers up to max', async () => {
    const gov = new ConcurrencyGovernor(2)
    const r1 = await gov.tryAcquire()
    const r2 = await gov.tryAcquire()
    expect(r1).toBe(true)
    expect(r2).toBe(true)
  })

  it('blocks when at capacity and releases on release()', async () => {
    const gov = new ConcurrencyGovernor(1)
    await gov.acquire()

    let acquired = false
    const p = gov.acquire().then(() => { acquired = true })
    expect(acquired).toBe(false)

    gov.release()
    await p
    expect(acquired).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/concurrency.test.ts
```

- [ ] **Step 3: Implement concurrency.ts**

```typescript
// apps/api/src/orchestrator/concurrency.ts

export class ConcurrencyGovernor {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return }
    return new Promise<void>((resolve) => { this.waiters.push(resolve) })
  }

  async tryAcquire(): Promise<boolean> {
    if (this.active < this.max) { this.active++; return true }
    return false
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter) { waiter() }
    else { this.active = Math.max(0, this.active - 1) }
  }

  get activeCount(): number { return this.active }
  get waiting(): number { return this.waiters.length }
}

// Singleton — configured at boot
export let governor = new ConcurrencyGovernor(4)
export function configureGovernor(max: number) { governor = new ConcurrencyGovernor(max) }
```

- [ ] **Step 4: Write worker state machine test**

```typescript
// apps/api/src/orchestrator/worker.test.ts
import { describe, it, expect, vi } from 'vitest'
import { WorkerStateMachine } from './worker'
import { MockAgent } from '../agents/mock'
import { createDb } from '../db/journal'
import { ConcurrencyGovernor } from './concurrency'

describe('WorkerStateMachine', () => {
  it('transitions from queued → spawning → running → done', async () => {
    const db = createDb(':memory:')
    const gov = new ConcurrencyGovernor(4)
    const agent = new MockAgent({ delayMs: 10, outcome: 'done' })

    const worker = new WorkerStateMachine({
      id: 'bass-v1', leadId: 'bass-lead', sectionId: 'bass',
      branch: 'feat/bass-v1', baseBranch: 'main',
      repoRoot: '/tmp/repo', db, governor: gov, agentFactory: () => agent,
    })

    const result = await worker.run({
      id: 'bass-v1', prompt: 'Write bass pattern', maxRetries: 1, errorHistory: []
    })

    expect(result.status).toBe('done')
    expect(worker.state).toBe('done')
  })
})
```

- [ ] **Step 5: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/worker.test.ts
```

- [ ] **Step 6: Implement worker.ts**

```typescript
// apps/api/src/orchestrator/worker.ts
import * as path from 'node:path'
import type { WorkerTask } from '../agents/types'
import type { WorkerAgent } from '../agents/types'
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import { createWorktree } from '../git/worktree'
import { ConcurrencyGovernor } from './concurrency'
import type { OrcEvent } from '@orc/types'

export type WorkerState = 'queued' | 'spawning' | 'running' | 'stalled' | 'zombie' | 'done' | 'failed' | 'retrying' | 'cancelled'

interface WorkerConfig {
  id:           string
  leadId:       string
  sectionId:    string
  branch:       string
  baseBranch:   string
  repoRoot:     string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  planPath?:    string
  leadPlanPath?: string
  runPlanPath?:  string
}

export class WorkerStateMachine {
  state: WorkerState = 'queued'
  private seq = 0
  private agent: WorkerAgent | null = null

  constructor(private readonly cfg: WorkerConfig) {}

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event = {
      entityId: this.cfg.id, entityType: 'worker' as const,
      eventType, sequence: ++this.seq, ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event as OrcEvent, () => {
      // projection update — tasks table
      const sqlite = (this.cfg.db as any).session.client
      sqlite.prepare(`
        INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at)
        VALUES (?, 'worker', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
      `).run(this.cfg.id, this.cfg.leadId, this.state, Date.now(), Date.now())
    })
  }

  async run(task: WorkerTask): Promise<{ status: 'done' | 'failed'; branch: string; diff?: string; error?: string }> {
    this.state = 'queued'
    this.emit('CommandIssued', { from: this.cfg.leadId, to: this.cfg.id, commandType: 'SpawnWorker', commandPayload: {} })

    await this.cfg.governor.acquire()
    this.state = 'spawning'
    this.emit('WorkerProgress', { output: 'spawning worktree', ts: Date.now() })

    const wtPath = path.join(this.cfg.repoRoot, '.worktrees', this.cfg.id)
    try {
      await createWorktree(this.cfg.repoRoot, wtPath, this.cfg.branch)
    } catch (err: any) {
      // worktree may already exist on resume
      if (!err.message.includes('already exists')) throw err
    }

    this.state = 'running'
    this.emit('WorkerProgress', { output: 'running agent', ts: Date.now() })

    this.agent = this.cfg.agentFactory()
    const result = await this.agent.run(task, {
      worktreePath: wtPath,
      branch: this.cfg.branch,
      baseBranch: this.cfg.baseBranch,
      entityId: this.cfg.id,
      planPath:     path.join(wtPath, '.orc', 'worker-plan.md'),
      leadPlanPath: this.cfg.leadPlanPath ?? '',
      runPlanPath:  this.cfg.runPlanPath ?? '',
    })

    this.cfg.governor.release()

    if (result.status === 'done') {
      this.state = 'done'
      this.emit('WorkerDone', { branch: result.branch, diff: result.diff ?? '' })
    } else {
      this.state = 'failed'
      this.emit('WorkerFailed', { error: result.error ?? 'unknown', retryable: result.retryable })
    }

    return result
  }

  async abort(): Promise<void> {
    this.state = 'cancelled'
    await this.agent?.abort()
    this.cfg.governor.release()
    this.emit('WorkerFailed', { error: 'aborted', retryable: false })
  }
}
```

- [ ] **Step 7: Run both tests — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/concurrency.test.ts src/orchestrator/worker.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/orchestrator/concurrency.ts apps/api/src/orchestrator/worker.ts
git commit -m "feat: concurrency governor + Worker state machine"
```

---

## Task 8: Lead state machine (PM agent + Reviewer)

**Files:**
- Create: `apps/api/src/orchestrator/context.ts`
- Create: `apps/api/src/orchestrator/lead.ts`
- Test: `apps/api/src/orchestrator/lead.test.ts`

- [ ] **Step 1: Implement context.ts**

```typescript
// apps/api/src/orchestrator/context.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface MastermindCtx {
  userGoal:  string
  fileTree?: string
  gitLog?:   string
  runId:     string
}

export interface LeadCtx {
  sectionId:      string
  sectionGoal:    string
  errorHistory:   string[]
  runPlanContent?: string
}

export interface ReviewerCtx {
  sectionGoal: string
  workerDiffs: Array<{ workerId: string; diff: string; branch: string }>
}

export class ContextManager {
  constructor(private readonly repoRoot: string) {}

  async buildMastermindCtx(userGoal: string, runId: string): Promise<MastermindCtx> {
    let fileTree = ''
    try {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const exec = promisify(execFile)
      const { stdout } = await exec('find', ['.', '-type', 'f', '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*'], { cwd: this.repoRoot })
      fileTree = stdout.trim().split('\n').slice(0, 50).join('\n')
    } catch { /* non-fatal */ }
    return { userGoal, fileTree, runId }
  }

  async buildLeadCtx(sectionId: string, sectionGoal: string, errorHistory: string[], runPlanPath: string): Promise<LeadCtx> {
    let runPlanContent: string | undefined
    try { runPlanContent = await fs.readFile(runPlanPath, 'utf-8') } catch { /* non-fatal */ }
    return { sectionId, sectionGoal, errorHistory, runPlanContent }
  }

  buildReviewerCtx(sectionGoal: string, workerDiffs: ReviewerCtx['workerDiffs']): ReviewerCtx {
    return { sectionGoal, workerDiffs }
  }

  formatMastermindPrompt(ctx: MastermindCtx, skillContent: string): string {
    return `${skillContent}\n\n## Context\nGoal: ${ctx.userGoal}\nRun ID: ${ctx.runId}\n${ctx.fileTree ? `\nFile tree:\n${ctx.fileTree}` : ''}`
  }

  formatPMPrompt(ctx: LeadCtx, skillContent: string, numWorkers: number): string {
    return `${skillContent}\n\n## Section: ${ctx.sectionId}\nGoal: ${ctx.sectionGoal}\nGenerate ${numWorkers} distinct implementation prompts.\n${ctx.errorHistory.length ? `\nPrior errors:\n${ctx.errorHistory.join('\n')}` : ''}`
  }

  formatReviewerPrompt(ctx: ReviewerCtx, skillContent: string): string {
    const diffs = ctx.workerDiffs.map(w => `### ${w.workerId}\n${w.diff}`).join('\n\n')
    return `${skillContent}\n\n## Goal\n${ctx.sectionGoal}\n\n## Worker outputs\n${diffs}\n\nReturn JSON: { "winnerId": string, "reasoning": string }`
  }
}
```

- [ ] **Step 2: Write failing test**

```typescript
// apps/api/src/orchestrator/lead.test.ts
import { describe, it, expect, vi } from 'vitest'
import { LeadStateMachine } from './lead'
import { MockAgent } from '../agents/mock'
import { createDb } from '../db/journal'
import { ConcurrencyGovernor } from './concurrency'

describe('LeadStateMachine', () => {
  it('runs PM → workers in parallel → reviewer → emits LeadDone', async () => {
    const db = createDb(':memory:')
    const gov = new ConcurrencyGovernor(4)

    const lead = new LeadStateMachine({
      id: 'bass-lead', sectionId: 'bass',
      sectionGoal: 'Write a bass pattern',
      numWorkers: 2,
      baseBranch: 'main', runBranch: 'run/test',
      repoRoot: '/tmp/repo', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async (prompt: string) => {
        if (prompt.includes('Generate')) return JSON.stringify(['prompt1', 'prompt2'])
        return JSON.stringify({ winnerId: 'bass-v1', reasoning: 'best diff' })
      },
      skillsDir: '/tmp/skills',
    })

    const result = await lead.run()
    expect(result.status).toBe('done')
    expect(result.winnerBranch).toContain('bass')
  }, 10_000)
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/lead.test.ts
```

- [ ] **Step 4: Implement lead.ts**

```typescript
// apps/api/src/orchestrator/lead.ts
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import { ConcurrencyGovernor } from './concurrency'
import { WorkerStateMachine } from './worker'
import type { WorkerAgent } from '../agents/types'
import type { OrcEvent } from '@orc/types'

interface LeadConfig {
  id:          string
  sectionId:   string
  sectionGoal: string
  numWorkers:  number
  baseBranch:  string
  runBranch:   string
  repoRoot:    string
  db:          Db
  governor:    ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  llmCall:     (prompt: string) => Promise<string>
  skillsDir:   string
  runPlanPath?: string
  maxRetries?:  number
}

export type LeadState = 'idle' | 'planning' | 'running' | 'reviewing' | 'merging' | 'done' | 'failed' | 'escalated'

export interface LeadResult {
  status:       'done' | 'failed'
  winnerBranch: string
  reasoning:    string
}

export class LeadStateMachine {
  state: LeadState = 'idle'
  private seq = 0

  constructor(private readonly cfg: LeadConfig) {}

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event = {
      entityId: this.cfg.id, entityType: 'lead' as const,
      eventType, sequence: ++this.seq, ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event as OrcEvent, () => {
      const sqlite = (this.cfg.db as any).session.client
      sqlite.prepare(`
        INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at)
        VALUES (?, 'lead', 'mastermind', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
      `).run(this.cfg.id, this.state, Date.now(), Date.now())
    })
  }

  async run(): Promise<LeadResult> {
    this.state = 'planning'
    this.emit('CommandIssued', { from: 'mastermind', to: this.cfg.id, commandType: 'SpawnLead', commandPayload: {} })

    // PM agent: generate worker prompts
    const pmPrompt = `Generate ${this.cfg.numWorkers} distinct implementation prompts for: ${this.cfg.sectionGoal}. Return a JSON array of strings.`
    let workerPrompts: string[]
    try {
      const raw = await this.cfg.llmCall(pmPrompt)
      workerPrompts = JSON.parse(raw)
      if (!Array.isArray(workerPrompts)) throw new Error('PM did not return array')
    } catch {
      workerPrompts = Array.from({ length: this.cfg.numWorkers }, (_, i) => `${this.cfg.sectionGoal} (variation ${i + 1})`)
    }
    this.emit('LeadPlanReady', { workerPrompts })

    // spawn workers in parallel
    this.state = 'running'
    const workers = workerPrompts.map((prompt, i) => {
      const wId = `${this.cfg.sectionId}-v${i + 1}`
      return new WorkerStateMachine({
        id: wId, leadId: this.cfg.id, sectionId: this.cfg.sectionId,
        branch: `feat/${this.cfg.sectionId}-v${i + 1}`,
        baseBranch: this.cfg.baseBranch,
        repoRoot: this.cfg.repoRoot,
        db: this.cfg.db,
        governor: this.cfg.governor,
        agentFactory: this.cfg.agentFactory,
        runPlanPath: this.cfg.runPlanPath,
        leadPlanPath: path.join(this.cfg.repoRoot, '.orc', 'runs', 'current', 'leads', `${this.cfg.sectionId}.md`),
      })
    })

    const results = await Promise.allSettled(
      workers.map((w, i) => w.run({ id: w['cfg'].id, prompt: workerPrompts[i], maxRetries: this.cfg.maxRetries ?? 1, errorHistory: [] }))
    )

    const doneWorkers = results
      .map((r, i) => ({ result: r, worker: workers[i] }))
      .filter(({ result }) => result.status === 'fulfilled' && (result as PromiseFulfilledResult<any>).value.status === 'done')
      .map(({ result, worker }) => ({
        workerId: worker['cfg'].id,
        diff: (result as PromiseFulfilledResult<any>).value.diff ?? '',
        branch: (result as PromiseFulfilledResult<any>).value.branch,
      }))

    if (doneWorkers.length === 0) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: 'all workers failed' })
      return { status: 'failed', winnerBranch: '', reasoning: 'all workers failed' }
    }

    // reviewer
    this.state = 'reviewing'
    const reviewPrompt = `Review these implementations for: ${this.cfg.sectionGoal}\n${doneWorkers.map(w => `${w.workerId}:\n${w.diff}`).join('\n\n')}\nReturn JSON: {"winnerId": string, "reasoning": string}`
    let winnerId = doneWorkers[0].workerId
    let reasoning = 'first available'
    try {
      const raw = await this.cfg.llmCall(reviewPrompt)
      const review = JSON.parse(raw)
      winnerId = review.winnerId
      reasoning = review.reasoning
    } catch { /* use fallback */ }

    this.emit('ReviewComplete', { winnerId, reasoning })

    const winner = doneWorkers.find(w => w.workerId === winnerId) ?? doneWorkers[0]

    this.state = 'merging'
    this.emit('MergeRequested', { leadId: this.cfg.id, worktreeId: winnerId, targetBranch: this.cfg.runBranch })
    this.state = 'done'
    this.emit('LeadDone', { branch: winner.branch, sectionId: this.cfg.sectionId })

    return { status: 'done', winnerBranch: winner.branch, reasoning }
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/lead.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/context.ts apps/api/src/orchestrator/lead.ts
git commit -m "feat: ContextManager + Lead state machine (PM → workers → reviewer)"
```

---

## Task 9: Mastermind state machine

**Files:**
- Create: `apps/api/src/orchestrator/mastermind.ts`
- Test: `apps/api/src/orchestrator/mastermind.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/mastermind.test.ts
import { describe, it, expect } from 'vitest'
import { MastermindStateMachine } from './mastermind'
import { MockAgent } from '../agents/mock'
import { createDb } from '../db/journal'
import { ConcurrencyGovernor } from './concurrency'

describe('MastermindStateMachine', () => {
  it('decomposes goal and runs leads, emits OrchestrationComplete', async () => {
    const db = createDb(':memory:')
    const gov = new ConcurrencyGovernor(4)

    const mastermind = new MastermindStateMachine({
      repoRoot: '/tmp/repo', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async (prompt: string) => {
        if (prompt.includes('decompose')) {
          return JSON.stringify([
            { id: 'rhythm', goal: 'Write rhythm section', numWorkers: 1 },
          ])
        }
        if (prompt.includes('Generate')) return JSON.stringify(['write bass pattern'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'only one' })
      },
      skillsDir: '/tmp/skills',
      maxConcurrentWorkers: 4,
    })

    const result = await mastermind.run({ userGoal: 'Build a lo-fi track', runId: 'run-1' })
    expect(result.status).toBe('done')
  }, 15_000)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts
```

- [ ] **Step 3: Implement mastermind.ts**

```typescript
// apps/api/src/orchestrator/mastermind.ts
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import { ConcurrencyGovernor, configureGovernor } from './concurrency'
import { LeadStateMachine } from './lead'
import type { WorkerAgent } from '../agents/types'
import type { OrcEvent } from '@orc/types'

interface SectionPlan {
  id:         string
  goal:       string
  numWorkers: number
  dependsOn?: string[]
}

interface MastermindConfig {
  repoRoot:             string
  db:                   Db
  governor:             ConcurrencyGovernor
  agentFactory:         () => WorkerAgent
  llmCall:              (prompt: string) => Promise<string>
  skillsDir:            string
  maxConcurrentWorkers: number
  templatePath?:        string
}

export type MastermindState = 'idle' | 'planning' | 'delegating' | 'monitoring' | 'merging' | 'done' | 'failed'

export class MastermindStateMachine {
  state: MastermindState = 'idle'
  private seq = 0
  readonly runId: string = `run-${Date.now()}`

  constructor(private readonly cfg: MastermindConfig) {}

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event = {
      entityId: 'mastermind', entityType: 'mastermind' as const,
      eventType, sequence: ++this.seq, ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event as OrcEvent, () => {
      const sqlite = (this.cfg.db as any).session.client
      sqlite.prepare(`
        INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at)
        VALUES ('mastermind', 'mastermind', NULL, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
      `).run(this.state, Date.now(), Date.now())
    })
  }

  async run(opts: { userGoal: string; runId?: string }): Promise<{ status: 'done' | 'failed' }> {
    configureGovernor(this.cfg.maxConcurrentWorkers)
    this.state = 'planning'
    this.emit('CommandIssued', { from: 'user', to: 'mastermind', commandType: 'Run', commandPayload: { goal: opts.userGoal } })

    // create run plan directory
    const runDir = path.join(this.cfg.repoRoot, '.orc', 'runs', opts.runId ?? this.runId)
    await fs.mkdir(path.join(runDir, 'leads'), { recursive: true })

    // decompose goal into sections
    let sections: SectionPlan[]
    const decomposePrompt = `decompose the following goal into implementation sections. Return JSON array of {id, goal, numWorkers}. Goal: ${opts.userGoal}`
    try {
      const raw = await this.cfg.llmCall(decomposePrompt)
      sections = JSON.parse(raw)
      if (!Array.isArray(sections)) throw new Error('not array')
    } catch {
      sections = [{ id: 'main', goal: opts.userGoal, numWorkers: 2 }]
    }

    const runBranch = `run/${opts.runId ?? this.runId}`
    this.emit('PlanReady', { sections: sections.map(s => s.id), runId: opts.runId ?? this.runId })

    this.state = 'delegating'

    // run leads in parallel (respecting depends_on if specified)
    const leadResults = await Promise.allSettled(
      sections.map(section => {
        const lead = new LeadStateMachine({
          id:          `${section.id}-lead`,
          sectionId:   section.id,
          sectionGoal: section.goal,
          numWorkers:  section.numWorkers,
          baseBranch:  'main',
          runBranch,
          repoRoot:    this.cfg.repoRoot,
          db:          this.cfg.db,
          governor:    this.cfg.governor,
          agentFactory: this.cfg.agentFactory,
          llmCall:     this.cfg.llmCall,
          skillsDir:   this.cfg.skillsDir,
          runPlanPath: path.join(runDir, 'run-plan.md'),
        })
        this.emit('LeadDelegated', { leadId: `${section.id}-lead`, sectionId: section.id })
        return lead.run()
      })
    )

    this.state = 'monitoring'

    const failures = leadResults.filter(r => r.status === 'rejected' || (r as PromiseFulfilledResult<any>).value?.status === 'failed')
    if (failures.length > 0) {
      this.state = 'failed'
      this.emit('OrchestrationFailed', { reason: `${failures.length} lead(s) failed` })
      return { status: 'failed' }
    }

    this.state = 'merging'
    // in a full implementation, merge coordinator would be invoked here
    this.state = 'done'
    this.emit('OrchestrationComplete', { runBranch })
    return { status: 'done' }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orchestrator/mastermind.ts
git commit -m "feat: Mastermind state machine — decompose → delegate → monitor → done"
```

---

## Task 10: Watchdog

**Files:**
- Create: `apps/api/src/orchestrator/watchdog.ts`
- Test: `apps/api/src/orchestrator/watchdog.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/watchdog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchdog } from './watchdog'
import { createDb } from '../db/journal'

describe('Watchdog', () => {
  it('marks worker as stalled when no output for threshold', async () => {
    const db = createDb(':memory:')
    const sqlite = (db as any).session.client
    sqlite.prepare(`
      INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at)
      VALUES ('w1', 'worker', 'lead1', 'running', ${Date.now()}, ${Date.now()})
    `).run()
    sqlite.prepare(`
      INSERT INTO runs (id, entity_id, started_at, last_seen_at)
      VALUES ('r1', 'w1', ${Date.now() - 120_000}, ${Date.now() - 120_000})
    `).run()

    const stalled: string[] = []
    const watchdog = new Watchdog({ db, intervalMs: 50, stalledThresholdMs: 60_000 })
    watchdog.on('WorkerStalled', (workerId: string) => stalled.push(workerId))
    watchdog.start()

    await new Promise(r => setTimeout(r, 120))
    watchdog.stop()

    expect(stalled).toContain('w1')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/watchdog.test.ts
```

- [ ] **Step 3: Implement watchdog.ts**

```typescript
// apps/api/src/orchestrator/watchdog.ts
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import type { OrcEvent } from '@orc/types'

interface WatchdogConfig {
  db:                  Db
  intervalMs:          number  // default 5000
  stalledThresholdMs:  number  // default 60_000
}

export class Watchdog extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private seq = 0

  constructor(private readonly cfg: WatchdogConfig) { super() }

  start(): void {
    this.timer = setInterval(() => this.poll(), this.cfg.intervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private poll(): void {
    const sqlite = (this.cfg.db as any).session.client
    const now = Date.now()
    const stalledCutoff = now - this.cfg.stalledThresholdMs

    // find running workers whose last_seen_at is past the stalled threshold
    const runningWorkers = sqlite.prepare(`
      SELECT t.id, r.last_seen_at, r.pid
      FROM tasks t
      LEFT JOIN runs r ON r.entity_id = t.id
      WHERE t.type = 'worker' AND t.state = 'running'
    `).all() as Array<{ id: string; last_seen_at: number | null; pid: number | null }>

    for (const w of runningWorkers) {
      const lastSeen = w.last_seen_at ?? 0
      if (lastSeen < stalledCutoff) {
        // check if process is still alive
        let alive = false
        if (w.pid) {
          try { process.kill(w.pid, 0); alive = true } catch { /* dead */ }
        }

        if (!alive) {
          // zombie
          sqlite.prepare(`UPDATE tasks SET state='zombie', updated_at=? WHERE id=?`).run(now, w.id)
          const event = {
            entityId: w.id, entityType: 'worker' as const,
            eventType: 'WorkerZombie', sequence: ++this.seq, ts: now,
            payload: { pid: w.pid ?? 0 },
          }
          writeEvent(this.cfg.db, event as OrcEvent, () => {})
          this.emit('WorkerZombie', w.id)
        } else {
          // stalled
          sqlite.prepare(`UPDATE tasks SET state='stalled', updated_at=? WHERE id=?`).run(now, w.id)
          const event = {
            entityId: w.id, entityType: 'worker' as const,
            eventType: 'WorkerStalled', sequence: ++this.seq, ts: now,
            payload: { lastSeenAt: lastSeen },
          }
          writeEvent(this.cfg.db, event as OrcEvent, () => {})
          this.emit('WorkerStalled', w.id)
        }
      } else {
        // update last_seen_at (projection-only, not journaled)
        sqlite.prepare(`UPDATE runs SET last_seen_at=? WHERE entity_id=?`).run(now, w.id)
      }
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/watchdog.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orchestrator/watchdog.ts
git commit -m "feat: Watchdog — 5s health polling, WorkerStalled/WorkerZombie events, last_seen_at projection"
```

---

## Task 11: Merge coordinator + merge-fix worker

**Files:**
- Create: `apps/api/src/orchestrator/mergeCoordinator.ts`
- Test: `apps/api/src/orchestrator/mergeCoordinator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/mergeCoordinator.test.ts
import { describe, it, expect } from 'vitest'
import { MergeCoordinator } from './mergeCoordinator'
import { createDb } from '../db/journal'

describe('MergeCoordinator', () => {
  it('enqueues and processes a clean merge request', async () => {
    const db = createDb(':memory:')
    const merged: string[] = []

    const coord = new MergeCoordinator({
      db, repoRoot: '/tmp/repo',
      doMerge: async (targetBranch, sourceBranch) => ({ success: true, conflictFiles: [] }),
      onComplete: (mergeId, targetBranch) => { merged.push(mergeId) },
    })

    coord.enqueue({ leadId: 'bass-lead', worktreeId: 'bass-v1', targetBranch: 'run/1', winnerBranch: 'feat/bass-v1' })
    await coord.processNext()

    expect(merged).toHaveLength(1)
  })

  it('fires onConflict when merge fails', async () => {
    const db = createDb(':memory:')
    const conflicts: string[] = []

    const coord = new MergeCoordinator({
      db, repoRoot: '/tmp/repo',
      doMerge: async () => ({ success: false, conflictFiles: ['a.ts'] }),
      onConflict: (mergeId, files) => { conflicts.push(mergeId) },
    })

    coord.enqueue({ leadId: 'bass-lead', worktreeId: 'bass-v1', targetBranch: 'run/1', winnerBranch: 'feat/bass-v1' })
    await coord.processNext()

    expect(conflicts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mergeCoordinator.test.ts
```

- [ ] **Step 3: Implement mergeCoordinator.ts**

```typescript
// apps/api/src/orchestrator/mergeCoordinator.ts
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import type { OrcEvent } from '@orc/types'

interface MergeRequest {
  leadId:       string
  worktreeId:   string
  targetBranch: string
  winnerBranch: string
}

interface MergeCoordinatorConfig {
  db:          Db
  repoRoot:    string
  doMerge:     (targetBranch: string, sourceBranch: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  onComplete?: (mergeId: string, targetBranch: string) => void
  onConflict?: (mergeId: string, conflictFiles: string[]) => void
  onFailed?:   (mergeId: string, reason: string) => void
}

export class MergeCoordinator {
  private readonly queue: MergeRequest[] = []
  private processing = false
  private seq = 0

  constructor(private readonly cfg: MergeCoordinatorConfig) {}

  enqueue(req: MergeRequest): void {
    this.queue.push(req)
    const sqlite = (this.cfg.db as any).session.client
    sqlite.prepare(`
      INSERT INTO merge_queue (lead_id, winner_worktree_id, target_branch, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(req.leadId, req.worktreeId, req.targetBranch, Date.now())
  }

  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return
    this.processing = true
    const req = this.queue.shift()!
    const sqlite = (this.cfg.db as any).session.client
    const mergeId = `${req.leadId}-${req.worktreeId}`

    // claim merge atomically
    sqlite.prepare(`UPDATE merge_queue SET status='merging' WHERE lead_id=? AND winner_worktree_id=? AND status='pending'`).run(req.leadId, req.worktreeId)

    try {
      const result = await this.cfg.doMerge(req.targetBranch, req.winnerBranch)

      if (result.success) {
        sqlite.prepare(`UPDATE merge_queue SET status='done', merged_at=? WHERE lead_id=? AND winner_worktree_id=?`).run(Date.now(), req.leadId, req.worktreeId)
        const event = {
          entityId: 'mastermind', entityType: 'mastermind' as const,
          eventType: 'MergeComplete', sequence: ++this.seq, ts: Date.now(),
          payload: { mergeId, targetBranch: req.targetBranch },
        }
        writeEvent(this.cfg.db, event as OrcEvent, () => {})
        this.cfg.onComplete?.(mergeId, req.targetBranch)
      } else {
        sqlite.prepare(`UPDATE merge_queue SET status='conflict', conflict_details=? WHERE lead_id=? AND winner_worktree_id=?`)
          .run(JSON.stringify({ conflictFiles: result.conflictFiles }), req.leadId, req.worktreeId)
        const event = {
          entityId: 'mastermind', entityType: 'mastermind' as const,
          eventType: 'MergeConflict', sequence: ++this.seq, ts: Date.now(),
          payload: { mergeId, conflictFiles: result.conflictFiles },
        }
        writeEvent(this.cfg.db, event as OrcEvent, () => {})
        this.cfg.onConflict?.(mergeId, result.conflictFiles)
      }
    } catch (err: any) {
      sqlite.prepare(`UPDATE merge_queue SET status='failed' WHERE lead_id=? AND winner_worktree_id=?`).run(req.leadId, req.worktreeId)
      this.cfg.onFailed?.(mergeId, err.message)
    } finally {
      this.processing = false
    }

    // process next in queue
    if (this.queue.length > 0) await this.processNext()
  }

  async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processNext()
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mergeCoordinator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orchestrator/mergeCoordinator.ts
git commit -m "feat: MergeCoordinator — serialized FIFO, conflict detection, atomic claim"
```

---

## Task 12: Planning artifacts + skills files

**Files:**
- Create: `apps/api/src/git/planFiles.ts`
- Create: `skills/mastermind.md`
- Create: `skills/lead.md`
- Create: `skills/pm-agent.md`
- Create: `skills/implementer.md`
- Create: `skills/reviewer.md`
- Create: `skills/run-planner.md`
- Create: `skills/lead-planner.md`
- Create: `skills/worker-planner.md`
- Test: `apps/api/src/git/planFiles.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/git/planFiles.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { createRunPlan, createLeadPlan, createWorkerPlan } from './planFiles'

const TMP = path.join(os.tmpdir(), `orc-plans-${Date.now()}`)
afterAll(() => fs.rm(TMP, { recursive: true, force: true }))

describe('planFiles', () => {
  it('creates run plan with goal in content', async () => {
    await fs.mkdir(path.join(TMP, '.orc', 'runs', 'r1', 'leads'), { recursive: true })
    await createRunPlan(TMP, 'r1', { userGoal: 'Build a lo-fi track', sections: ['rhythm', 'melody'] })
    const content = await fs.readFile(path.join(TMP, '.orc', 'runs', 'r1', 'run-plan.md'), 'utf-8')
    expect(content).toContain('Build a lo-fi track')
    expect(content).toContain('rhythm')
  })

  it('creates worker plan with objective', async () => {
    const wtPath = path.join(TMP, 'rhythm-v1')
    await fs.mkdir(path.join(wtPath, '.orc'), { recursive: true })
    await createWorkerPlan(wtPath, { workerId: 'rhythm-v1', objective: 'Write bass pattern', strategy: 'minimal' })
    const content = await fs.readFile(path.join(wtPath, '.orc', 'worker-plan.md'), 'utf-8')
    expect(content).toContain('Write bass pattern')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/git/planFiles.test.ts
```

- [ ] **Step 3: Implement planFiles.ts**

```typescript
// apps/api/src/git/planFiles.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export async function createRunPlan(
  repoRoot: string,
  runId: string,
  opts: { userGoal: string; sections: string[] },
): Promise<string> {
  const filePath = path.join(repoRoot, '.orc', 'runs', runId, 'run-plan.md')
  const content = `# Run Plan — ${opts.userGoal}

> Workers: read this before creating lead and worker plans.

**Goal:** ${opts.userGoal}
**Run ID:** ${runId}
**Merge target:** run/${runId} → main at completion

## Sections & Dependencies
${opts.sections.map(s => `- ${s}`).join('\n')}

## Success Criteria
- [ ] all sections integrated into run/${runId}
- [ ] preview launches
- [ ] tests pass

## Integration Notes
- merge target is run/${runId}, not main directly
- avoid unrelated refactors
- prefer minimal blast radius

## Status
${opts.sections.map(s => `- ${s}: queued`).join('\n')}
`
  await fs.writeFile(filePath, content)
  return filePath
}

export async function createLeadPlan(
  repoRoot: string,
  runId: string,
  opts: { sectionId: string; sectionGoal: string; workerVariants: string[] },
): Promise<string> {
  const filePath = path.join(repoRoot, '.orc', 'runs', runId, 'leads', `${opts.sectionId}.md`)
  const content = `# Lead Plan — ${opts.sectionId}

**Parent plan:** .orc/runs/${runId}/run-plan.md
**Section goal:** ${opts.sectionGoal}

## Acceptance Criteria
- implementation complete
- tests pass
- minimal blast radius
- safe to merge

## Worker Variants
${opts.workerVariants.map((v, i) => `- ${opts.sectionId}-v${i + 1}: ${v}`).join('\n')}

## Review Criteria
- correctness
- minimal blast radius
- readability
- mergeability

## Status
${opts.workerVariants.map((_, i) => `- ${opts.sectionId}-v${i + 1}: queued`).join('\n')}

## Notes
_lead decisions and observations_
`
  await fs.writeFile(filePath, content)
  return filePath
}

export async function createWorkerPlan(
  worktreePath: string,
  opts: { workerId: string; objective: string; strategy: string; filesToChange?: string[] },
): Promise<string> {
  const filePath = path.join(worktreePath, '.orc', 'worker-plan.md')
  const content = `# Worker Plan — ${opts.workerId}

**Objective:** ${opts.objective}
**Strategy:** ${opts.strategy}

## Acceptance Criteria
- [ ] implementation complete
- [ ] tests pass
- [ ] no unrelated files changed
- [ ] preview/build succeeds

## Files Likely To Change
${(opts.filesToChange ?? ['(to be determined)']).map(f => `- ${f}`).join('\n')}

## Constraints
- avoid refactoring unrelated code
- preserve existing conventions
- keep diff minimal

## Checklist
- [ ] inspect current structure
- [ ] implement
- [ ] validate / run tests
- [ ] summarize changes

## Progress Notes
_empty_

## Blockers
_none_

## Result Summary
_pending_
`
  await fs.writeFile(filePath, content)
  return filePath
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/git/planFiles.test.ts
```

- [ ] **Step 5: Create all skills files**

```markdown
<!-- skills/mastermind.md -->
# Mastermind Skills

## Role
You are the Mastermind orchestrator. You receive a user goal and decompose it into parallel sections. Each section will be handled by a Lead team. You monitor all leads and coordinate the final merge into the run branch.

## Tools
- Call LLM to decompose goal into sections (JSON array)
- Spawn Lead state machines per section
- Route user directives to the correct lead via CommandIssued events
- Trigger MergeCoordinator for final integration

## Context schema
- userGoal: string
- fileTree: string (repo structure)
- runId: string

## Output schema
JSON array of sections: `[{ id, goal, numWorkers }]`

## Constraints
- Decompose into 2-5 independent sections maximum
- Each section must be independently implementable
- Do not produce sections with circular dependencies
```

```markdown
<!-- skills/lead.md -->
# Lead Skills

## Role
You coordinate a section team: PM agent, N parallel Implementer workers, and a Reviewer. You own the section plan, spawn workers, coordinate review, and request merge.

## Tools
- Spawn WorkerStateMachine instances
- Call Reviewer LLM to pick winner
- Emit MergeRequested event

## Context schema
- sectionId: string
- sectionGoal: string
- workerResults: Array<{ workerId, diff, branch }>

## Output schema
{ winnerId: string, reasoning: string }

## Constraints
- Never bypass the reviewer when multiple workers succeed
- Always emit LeadDone after successful merge request
- Emit LeadFailed only after all retry options are exhausted
```

```markdown
<!-- skills/pm-agent.md -->
# PM Agent Skills

## Role
You receive a section goal and generate distinct implementation prompts for N parallel workers. Each prompt should describe a different approach or strategy so workers produce meaningfully different variations.

## Context schema
- sectionId: string
- sectionGoal: string
- numWorkers: number
- errorHistory: string[]
- runPlanContent: string

## Output schema
JSON array of strings: `["prompt for v1", "prompt for v2", ...]`

## Constraints
- Each prompt must be a complete, actionable implementation instruction
- Prompts must differ in approach (not just wording)
- Keep prompts concise — workers will read them as task instructions
- If errorHistory is non-empty, reference what was tried and guide workers away from those approaches
```

```markdown
<!-- skills/implementer.md -->
# Implementer Skills

## Role
You are a focused implementation worker. You receive a specific implementation task and execute it in your assigned git worktree. You read your worker-plan.md, implement the solution, update the checklist, and summarize what you changed.

## Tools
- Read/write files in your worktree
- Run tests and build commands
- Update your .orc/worker-plan.md checklist

## Context schema
- worktreePath: string
- branch: string
- planPath: string (.orc/worker-plan.md)
- leadPlanPath: string
- runPlanPath: string
- prompt: string (your specific task)
- strategy: string

## Constraints
- Only modify files directly related to your assigned task
- Do not refactor unrelated code
- Run tests before marking complete
- Update your worker-plan.md Result Summary when done
- Write .orc/.orc-done.json on exit (done by CodexCLIAdapter automatically)
```

```markdown
<!-- skills/reviewer.md -->
# Reviewer Skills

## Role
You are a code reviewer and arbitration layer. You receive multiple worker outputs (diffs) for the same section goal and select the best implementation. You explain your reasoning clearly.

## Context schema
- sectionGoal: string
- workerDiffs: Array<{ workerId, diff, branch }>

## Output schema
JSON: `{ "winnerId": string, "reasoning": string }`

## Constraints
- Select exactly one winner
- Reasoning must reference specific technical qualities (correctness, blast radius, readability)
- If all implementations are equivalent, prefer the one with the smallest diff
- You are an MVP arbitration layer — your judgment is a strong heuristic, not a guarantee
```

```markdown
<!-- skills/run-planner.md -->
# Run Planner Skills

## Role
You create the run-level plan file (run-plan.md) for a Mastermind orchestration run. This document is the top-level reference for all leads and workers on this run.

## Output format
The run plan must contain:
- Goal (one sentence)
- Architecture (how sections fit together)
- Sections & Dependencies (list with depends_on)
- Success Criteria (checkboxes)
- Integration Notes (merge target, blast radius)
- Status (one line per section)

## Constraints
- Keep the plan under 2 pages
- Status section is updated at section boundaries only, not continuously
- The plan is execution memory, not system truth — SQLite projections are authoritative
```

```markdown
<!-- skills/lead-planner.md -->
# Lead Planner Skills

## Role
You create the section-level plan file for a Lead. This document guides workers and records local decisions.

## Output format
- Section Objective
- Acceptance Criteria
- Files / Boundaries
- Dependency Inputs (from parent sections)
- Worker Variants (one line per worker, describing its strategy)
- Review Criteria
- Status
- Notes

## Constraints
- Update on: worker spawn, worker completion, reviewer decision, retry
- Keep variants section accurate — reflect actual worker strategies
- Never record full agent transcripts; record decisions and outcomes only
```

```markdown
<!-- skills/worker-planner.md -->
# Worker Planner Skills

## Role
You create and maintain the worker-level task sheet (.orc/worker-plan.md). This is your local execution contract and progress tracker.

## Output format
- Objective (one sentence)
- Acceptance Criteria (checkboxes)
- Files Likely To Change (list)
- Constraints
- Checklist (checkboxes — implementation steps)
- Progress Notes (brief, append-only)
- Blockers
- Result Summary (filled in when done)

## Constraints
- Update at: start, after planning, after major step, before finish, on error
- Keep notes brief — this is a checklist, not a diary
- Result Summary must be completed before marking the task done
- Do not invent new sections; update existing ones only
```

- [ ] **Step 6: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/git/planFiles.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/git/planFiles.ts skills/
git commit -m "feat: plan file creation (run/lead/worker) + all 8 skills files"
```

---

## Task 13: Workflow template loader

**Files:**
- Create: `apps/api/src/orchestrator/templateLoader.ts`
- Create: `templates/strudel-track.toml`
- Test: `apps/api/src/orchestrator/templateLoader.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/templateLoader.test.ts
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { loadTemplate, renderPromptHint } from './templateLoader'

describe('templateLoader', () => {
  it('loads strudel-track template', async () => {
    const tplPath = path.join(process.cwd(), '../../templates/strudel-track.toml')
    const tpl = await loadTemplate(tplPath)
    expect(tpl.template.name).toBe('strudel-track')
    expect(tpl.sections).toHaveLength(4)
  })

  it('renders prompt hint with params', () => {
    const hint = 'Write a pattern at {tempo}bpm in key {key}.'
    const rendered = renderPromptHint(hint, { tempo: 90, key: 'Dm' }, {})
    expect(rendered).toContain('90bpm')
    expect(rendered).toContain('Dm')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/templateLoader.test.ts
```

- [ ] **Step 3: Create strudel-track.toml**

```toml
# templates/strudel-track.toml
[template]
name = "strudel-track"
version = "1.0"
description = "Lo-fi / electronic track with parallel instrument sections"

[[sections]]
id = "rhythm"
label = "Rhythm Section (bass + drums)"
depends_on = []
workers = 2
prompt_hint = """
Write a Strudel.js pattern for the rhythm section (bass + drums).
Use the 'sound' and 'note' functions. Keep it minimal and loopable.
Target tempo: {tempo}bpm, key: {key}.
Return only valid Strudel.js code that can be evaluated directly.
"""

[[sections]]
id = "harmony"
label = "Harmony / Chords"
depends_on = ["rhythm"]
workers = 2
prompt_hint = """
Write a Strudel.js chord pattern that complements the rhythm section.
Rhythm section output: {rhythm.winner_code}
Target tempo: {tempo}bpm, key: {key}.
"""

[[sections]]
id = "melody"
label = "Lead Melody"
depends_on = ["rhythm", "harmony"]
workers = 3
prompt_hint = """
Write a Strudel.js lead melody over the rhythm and harmony.
Rhythm: {rhythm.winner_code}
Harmony: {harmony.winner_code}
Target tempo: {tempo}bpm, key: {key}.
"""

[[sections]]
id = "arrangement"
label = "Final Arrangement"
depends_on = ["rhythm", "harmony", "melody"]
workers = 1
prompt_hint = """
Combine all sections into a final Strudel.js arrangement.
Import and stack: rhythm, harmony, melody.
Apply appropriate mix levels and effects for a lo-fi sound.
"""

[params]
tempo = 90
key = "Dm"
```

- [ ] **Step 4: Implement templateLoader.ts**

```typescript
// apps/api/src/orchestrator/templateLoader.ts
import * as fs from 'node:fs/promises'
import * as TOML from 'toml'

export interface SectionTemplate {
  id:         string
  label:      string
  depends_on: string[]
  workers:    number
  prompt_hint: string
}

export interface WorkflowTemplate {
  template: { name: string; version: string; description: string }
  sections: SectionTemplate[]
  params:   Record<string, unknown>
}

export async function loadTemplate(filePath: string): Promise<WorkflowTemplate> {
  const raw = await fs.readFile(filePath, 'utf-8')
  return TOML.parse(raw) as WorkflowTemplate
}

export function renderPromptHint(
  hint: string,
  params: Record<string, unknown>,
  sectionOutputs: Record<string, string>,
): string {
  let result = hint
  for (const [key, val] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, String(val))
  }
  for (const [section, code] of Object.entries(sectionOutputs)) {
    result = result.replaceAll(`{${section}.winner_code}`, code)
  }
  return result.trim()
}

export function topologicalSort(sections: SectionTemplate[]): SectionTemplate[][] {
  // returns sections grouped by dependency level (parallel groups)
  const byId = new Map(sections.map(s => [s.id, s]))
  const resolved = new Set<string>()
  const groups: SectionTemplate[][] = []

  while (resolved.size < sections.length) {
    const batch = sections.filter(s =>
      !resolved.has(s.id) &&
      s.depends_on.every(dep => resolved.has(dep))
    )
    if (batch.length === 0) throw new Error('Circular dependency in template')
    groups.push(batch)
    batch.forEach(s => resolved.add(s.id))
  }
  return groups
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/templateLoader.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/templateLoader.ts templates/strudel-track.toml
git commit -m "feat: workflow template loader + strudel-track.toml"
```

---

## Task 14: Express server + WebSocket + REST routes

**Files:**
- Create: `apps/api/src/server/app.ts`
- Create: `apps/api/src/server/routes.ts`
- Create: `apps/api/src/server/wsHandler.ts`
- Test: `apps/api/src/server/routes.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/server/routes.test.ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { createDb } from '../db/journal'

describe('GET /api/orchestration', () => {
  it('returns 200 with orchestration state', async () => {
    const db = createDb(':memory:')
    const app = createApp({ db })
    const res = await request(app).get('/api/orchestration')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sections')
  })
})

describe('POST /api/steer', () => {
  it('accepts a directive and returns 202', async () => {
    const db = createDb(':memory:')
    const app = createApp({ db })
    const res = await request(app).post('/api/steer').send({ directive: 'make bass darker' })
    expect(res.status).toBe(202)
  })
})
```

- [ ] **Step 2: Install supertest**

```bash
cd apps/api && pnpm add -D supertest @types/supertest
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

- [ ] **Step 4: Implement app.ts**

```typescript
// apps/api/src/server/app.ts
import express from 'express'
import cors from 'cors'
import type { Db } from '../db/journal'
import { createRoutes } from './routes'

export function createApp(deps: { db: Db }): express.Express {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use('/api', createRoutes(deps))
  return app
}
```

```bash
cd apps/api && pnpm add cors @types/cors
```

- [ ] **Step 5: Implement routes.ts**

```typescript
// apps/api/src/server/routes.ts
import { Router } from 'express'
import type { Db } from '../db/journal'

export function createRoutes({ db }: { db: Db }): Router {
  const router = Router()

  router.get('/orchestration', (_req, res) => {
    const sqlite = (db as any).session.client
    const tasks = sqlite.prepare(`SELECT * FROM tasks`).all()
    const worktrees = sqlite.prepare(`SELECT * FROM worktrees`).all()
    const previews = sqlite.prepare(`SELECT * FROM previews WHERE status='active'`).all()

    const sections = (tasks as any[])
      .filter((t: any) => t.type === 'lead')
      .map((lead: any) => ({
        id:      lead.id,
        state:   lead.state,
        workers: (tasks as any[])
          .filter((t: any) => t.type === 'worker' && t.parent_id === lead.id)
          .map((w: any) => {
            const wt = (worktrees as any[]).find((x: any) => x.worker_id === w.id)
            const preview = (previews as any[]).find((p: any) => p.worktree_id === w.id)
            return { id: w.id, state: w.state, branch: wt?.branch, previewPort: preview?.port }
          }),
      }))

    res.json({ sections, runId: 'current' })
  })

  router.get('/events', (_req, res) => {
    const sqlite = (db as any).session.client
    const events = sqlite.prepare(`SELECT * FROM event_log ORDER BY id DESC LIMIT 100`).all()
    res.json({ events })
  })

  router.post('/steer', (req, res) => {
    const { directive } = req.body
    if (!directive) { res.status(400).json({ error: 'directive required' }); return }
    // routeDirective is a stretch goal — log the directive for now
    res.status(202).json({ message: 'directive received', directive })
  })

  router.post('/approve', (req, res) => {
    const { workerId } = req.body
    if (!workerId) { res.status(400).json({ error: 'workerId required' }); return }
    // ForceApprove command — handled by Lead command queue in full implementation
    res.status(202).json({ message: 'approve queued', workerId })
  })

  router.post('/drop', (req, res) => {
    const { workerId } = req.body
    if (!workerId) { res.status(400).json({ error: 'workerId required' }); return }
    res.status(202).json({ message: 'drop queued', workerId })
  })

  router.post('/preview/launch', (req, res) => {
    const { worktreeId } = req.body
    if (!worktreeId) { res.status(400).json({ error: 'worktreeId required' }); return }
    // port allocation — full implementation in Task 15
    res.status(202).json({ message: 'preview launch queued', worktreeId })
  })

  router.post('/preview/stop', (req, res) => {
    const { worktreeId } = req.body
    if (!worktreeId) { res.status(400).json({ error: 'worktreeId required' }); return }
    res.status(202).json({ message: 'preview stop queued', worktreeId })
  })

  return router
}
```

- [ ] **Step 6: Implement wsHandler.ts**

```typescript
// apps/api/src/server/wsHandler.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'node:http'
import { eventBus } from '../events/eventBus'
import type { OrcEvent } from '@orc/types'

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const handler = (event: OrcEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    }
    eventBus.on('event', handler)

    ws.on('close', () => { eventBus.off('event', handler) })
    ws.on('error', () => { eventBus.off('event', handler) })
  })

  return wss
}
```

- [ ] **Step 7: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/server
git commit -m "feat: Express app + REST routes + WebSocket handler"
```

---

## Task 15: Preview launcher + CLI entry point

**Files:**
- Create: `apps/api/src/orchestrator/previewLauncher.ts`
- Create: `apps/api/src/cli.ts`
- Test: `apps/api/src/orchestrator/previewLauncher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/previewLauncher.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { PreviewLauncher } from './previewLauncher'
import { createDb } from '../db/journal'

describe('PreviewLauncher', () => {
  let launcher: PreviewLauncher

  afterEach(async () => { await launcher?.stopAll() })

  it('allocates first available port from pool', async () => {
    const db = createDb(':memory:')
    launcher = new PreviewLauncher({ db, poolStart: 3100, poolSize: 5 })
    const port = await launcher.allocatePort('wt1')
    expect(port).toBe(3100)
  })

  it('allocates next port when first is taken', async () => {
    const db = createDb(':memory:')
    launcher = new PreviewLauncher({ db, poolStart: 3100, poolSize: 5 })
    await launcher.allocatePort('wt1')
    const port2 = await launcher.allocatePort('wt2')
    expect(port2).toBe(3101)
  })

  it('throws when pool is exhausted', async () => {
    const db = createDb(':memory:')
    launcher = new PreviewLauncher({ db, poolStart: 3100, poolSize: 1 })
    await launcher.allocatePort('wt1')
    await expect(launcher.allocatePort('wt2')).rejects.toThrow('port pool exhausted')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/previewLauncher.test.ts
```

- [ ] **Step 3: Implement previewLauncher.ts**

```typescript
// apps/api/src/orchestrator/previewLauncher.ts
import { spawn, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import type { Db } from '../db/journal'
import { writeEvent } from '../db/journal'
import type { OrcEvent } from '@orc/types'

interface PreviewConfig {
  db:         Db
  poolStart:  number  // default PORT_POOL_START = 3100
  poolSize:   number  // default 50
}

export class PreviewLauncher {
  private readonly procs = new Map<string, ChildProcess>()
  private seq = 0

  constructor(private readonly cfg: PreviewConfig) {}

  async allocatePort(worktreeId: string): Promise<number> {
    const sqlite = (this.cfg.db as any).session.client
    const activePorts: number[] = sqlite
      .prepare(`SELECT port FROM previews WHERE status='active'`)
      .all()
      .map((r: any) => r.port)

    for (let i = 0; i < this.cfg.poolSize; i++) {
      const port = this.cfg.poolStart + i
      if (!activePorts.includes(port)) {
        const id = `preview-${worktreeId}`
        const url = `http://localhost:${port}`
        sqlite.prepare(`
          INSERT INTO previews (id, worktree_id, port, url, status, launched_at)
          VALUES (?, ?, ?, ?, 'active', ?)
          ON CONFLICT(id) DO UPDATE SET status='active', port=excluded.port, launched_at=excluded.launched_at
        `).run(id, worktreeId, port, url, Date.now())
        return port
      }
    }
    throw new Error('port pool exhausted — all 50 preview ports in use')
  }

  async launch(worktreeId: string, worktreePath: string, command: string[]): Promise<number> {
    const port = await this.allocatePort(worktreeId)
    const proc = spawn(command[0], command.slice(1), {
      cwd: worktreePath,
      env: { ...process.env, PORT: String(port) },
      detached: false,
    })
    this.procs.set(worktreeId, proc)
    return port
  }

  async stop(worktreeId: string): Promise<void> {
    const proc = this.procs.get(worktreeId)
    if (proc) { proc.kill('SIGTERM'); this.procs.delete(worktreeId) }
    const sqlite = (this.cfg.db as any).session.client
    sqlite.prepare(`UPDATE previews SET status='inactive' WHERE worktree_id=?`).run(worktreeId)
  }

  async stopAll(): Promise<void> {
    for (const id of this.procs.keys()) await this.stop(id)
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/previewLauncher.test.ts
```

- [ ] **Step 5: Implement cli.ts**

```typescript
// apps/api/src/cli.ts
import { Command } from 'commander'
import * as path from 'node:path'
import * as http from 'node:http'
import { initDb } from './db/journal'
import { createApp } from './server/app'
import { attachWebSocket } from './server/wsHandler'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { CodexCLIAdapter } from './agents/codex-cli'
import { Watchdog } from './orchestrator/watchdog'

const program = new Command()
const DB_PATH = path.join(process.cwd(), 'orc.db')
const SKILLS_DIR = path.join(process.cwd(), 'skills')
const PORT = parseInt(process.env.ORC_PORT ?? '4000')

async function startServer(db: ReturnType<typeof initDb>) {
  const app = createApp({ db })
  const server = http.createServer(app)
  attachWebSocket(server)
  server.listen(PORT, () => {
    console.log(`[orc] dashboard at http://localhost:${PORT}`)
    console.log(`[orc] open apps/web to view the dashboard`)
  })
  return server
}

program
  .name('orc')
  .description('WorkTree Orchestrator CLI')
  .version('0.1.0')

program
  .command('run <goal>')
  .description('Start a new orchestration run')
  .option('-t, --template <path>', 'workflow template file')
  .option('-m, --max-workers <n>', 'max concurrent workers', '4')
  .option('--mock', 'use MockAgent instead of Codex')
  .action(async (goal: string, opts) => {
    const db = initDb(DB_PATH)
    const server = await startServer(db)
    const gov = new ConcurrencyGovernor(parseInt(opts.maxWorkers))
    const repoRoot = process.cwd()

    const watchdog = new Watchdog({ db, intervalMs: 5000, stalledThresholdMs: 60_000 })
    watchdog.start()

    const mastermind = new MastermindStateMachine({
      repoRoot, db, governor: gov,
      agentFactory: opts.mock
        ? () => { const { MockAgent } = require('./agents/mock'); return new MockAgent({ delayMs: 100, outcome: 'done' }) }
        : () => new CodexCLIAdapter(),
      llmCall: async (prompt: string) => {
        // TODO: wire to actual LLM (OpenAI / Anthropic)
        // For now, use codex or mock
        console.log('[orc] LLM call (stub):', prompt.slice(0, 80) + '...')
        return JSON.stringify([{ id: 'main', goal, numWorkers: 2 }])
      },
      skillsDir: SKILLS_DIR,
      maxConcurrentWorkers: parseInt(opts.maxWorkers),
      templatePath: opts.template,
    })

    console.log(`[orc] starting orchestration: "${goal}"`)
    const result = await mastermind.run({ userGoal: goal })
    watchdog.stop()
    console.log(`[orc] orchestration ${result.status}`)
    server.close()
    process.exit(result.status === 'done' ? 0 : 1)
  })

program
  .command('status')
  .description('Show current orchestration state from SQLite')
  .action(async () => {
    const db = initDb(DB_PATH)
    const sqlite = (db as any).session.client
    const tasks = sqlite.prepare(`SELECT id, type, state FROM tasks ORDER BY type, id`).all()
    console.table(tasks)
  })

program
  .command('resume')
  .description('Restart and attempt best-effort continuation from persisted SQLite state')
  .action(async () => {
    const db = initDb(DB_PATH)
    const sqlite = (db as any).session.client
    const inFlight = sqlite.prepare(`SELECT id, state FROM tasks WHERE state IN ('running','queued','stalled','zombie')`).all()
    if (inFlight.length === 0) {
      console.log('[orc] nothing to resume')
      return
    }
    console.log('[orc] resumable tasks:')
    console.table(inFlight)
    console.log('[orc] starting dashboard — re-attach via http://localhost:' + PORT)
    const server = await startServer(db)
    // Full recovery (worktree reconciliation) is post-MVP
    // For now: start server so user can see state and trigger actions via dashboard
  })

program.parse()
```

- [ ] **Step 6: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/previewLauncher.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/orchestrator/previewLauncher.ts apps/api/src/cli.ts
git commit -m "feat: preview launcher (port pool allocation) + CLI (orc run/status/resume)"
```

---

## Task 16: Next.js dashboard — setup + WebSocket client + TreePanel

**Files:**
- Create: `apps/web/src/ws/client.ts`
- Create: `apps/web/src/hooks/useOrchestration.ts`
- Create: `apps/web/src/hooks/useEventStream.ts`
- Create: `apps/web/src/components/WorkerCard.tsx`
- Create: `apps/web/src/components/TreePanel.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Install TanStack Query**

```bash
cd apps/web && pnpm add @tanstack/react-query
```

- [ ] **Step 2: Implement WebSocket client**

```typescript
// apps/web/src/ws/client.ts
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000'

type EventHandler = (event: unknown) => void

class OrcWebSocket {
  private ws: WebSocket | null = null
  private handlers: Set<EventHandler> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  connect(): void {
    if (typeof window === 'undefined') return
    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          this.handlers.forEach(h => h(event))
        } catch {}
      }
      this.ws.onclose = () => { this.scheduleReconnect() }
      this.ws.onerror = () => { this.ws?.close() }
    } catch { this.scheduleReconnect() }
  }

  private scheduleReconnect(): void {
    this.reconnectTimeout = setTimeout(() => this.connect(), 2000)
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  disconnect(): void {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
    this.ws?.close()
  }
}

export const orcWs = new OrcWebSocket()
```

- [ ] **Step 3: Implement useOrchestration hook**

```typescript
// apps/web/src/hooks/useOrchestration.ts
'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { orcWs } from '../ws/client'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export interface WorkerInfo {
  id:          string
  state:       string
  branch?:     string
  previewPort?: number
}

export interface SectionInfo {
  id:      string
  state:   string
  workers: WorkerInfo[]
}

export interface OrchestrationState {
  runId:    string
  sections: SectionInfo[]
}

function applyEvent(old: OrchestrationState | undefined, event: any): OrchestrationState {
  if (!old) return { runId: 'current', sections: [] }
  // patch worker state on WorkerProgress/Done/Failed/Stalled/Zombie
  if (['WorkerProgress','WorkerDone','WorkerFailed','WorkerStalled','WorkerZombie','WorkerRecovered'].includes(event.eventType)) {
    return {
      ...old,
      sections: old.sections.map(s => ({
        ...s,
        workers: s.workers.map(w =>
          w.id === event.entityId
            ? { ...w, state: event.eventType === 'WorkerDone' ? 'done'
                          : event.eventType === 'WorkerFailed' ? 'failed'
                          : event.eventType === 'WorkerStalled' ? 'stalled'
                          : event.eventType === 'WorkerZombie' ? 'zombie'
                          : event.eventType === 'WorkerRecovered' ? 'running'
                          : w.state }
            : w
        ),
      })),
    }
  }
  return old
}

export function useOrchestration() {
  const queryClient = useQueryClient()

  const query = useQuery<OrchestrationState>({
    queryKey: ['orchestration'],
    queryFn: () => fetch(`${API}/api/orchestration`).then(r => r.json()),
    refetchInterval: false,
  })

  useEffect(() => {
    orcWs.connect()
    const unsub = orcWs.subscribe((event) => {
      queryClient.setQueryData<OrchestrationState>(['orchestration'], (old) => applyEvent(old, event))
    })
    return () => { unsub(); orcWs.disconnect() }
  }, [queryClient])

  return query
}
```

- [ ] **Step 4: Implement WorkerCard**

```tsx
// apps/web/src/components/WorkerCard.tsx
'use client'
import type { WorkerInfo } from '../hooks/useOrchestration'

const STATE_COLOR: Record<string, string> = {
  queued:   'bg-gray-700 text-gray-400',
  spawning: 'bg-blue-900 text-blue-300',
  running:  'bg-green-900 text-green-300',
  stalled:  'bg-yellow-900 text-yellow-300',
  zombie:   'bg-red-900 text-red-300',
  done:     'bg-green-800 text-green-200',
  failed:   'bg-red-800 text-red-200',
  cancelled:'bg-gray-700 text-gray-500',
}

interface Props {
  worker:   WorkerInfo
  selected: boolean
  onSelect: (id: string) => void
}

export function WorkerCard({ worker, selected, onSelect }: Props) {
  const colorClass = STATE_COLOR[worker.state] ?? 'bg-gray-700 text-gray-400'
  return (
    <button
      onClick={() => onSelect(worker.id)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs w-full text-left
        ${selected ? 'ring-1 ring-blue-400' : 'hover:bg-gray-700'}`}
    >
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${colorClass}`}>
        {worker.state}
      </span>
      <span className="text-gray-300 font-mono">{worker.id}</span>
      {worker.previewPort && (
        <a
          href={`http://localhost:${worker.previewPort}`}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="ml-auto text-blue-400 hover:text-blue-300 text-[10px]"
        >
          ▶ :{worker.previewPort}
        </a>
      )}
    </button>
  )
}
```

- [ ] **Step 5: Implement TreePanel**

```tsx
// apps/web/src/components/TreePanel.tsx
'use client'
import { useState } from 'react'
import type { OrchestrationState } from '../hooks/useOrchestration'
import { WorkerCard } from './WorkerCard'

const LEAD_STATE_COLOR: Record<string, string> = {
  idle:      'bg-gray-700 text-gray-400',
  planning:  'bg-purple-900 text-purple-300',
  running:   'bg-blue-900 text-blue-300',
  reviewing: 'bg-yellow-900 text-yellow-300',
  merging:   'bg-orange-900 text-orange-300',
  done:      'bg-green-800 text-green-200',
  failed:    'bg-red-800 text-red-200',
}

interface Props {
  state:          OrchestrationState | undefined
  selectedEntity: string | null
  onSelect:       (id: string) => void
}

export function TreePanel({ state, selectedEntity, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-1 p-3 overflow-y-auto">
      <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2">
        Orchestration Tree
      </div>

      {/* Mastermind */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-indigo-950 border border-indigo-700 mb-2">
        <span className="text-indigo-400 font-mono text-xs">◆</span>
        <span className="text-indigo-300 font-bold text-xs">mastermind</span>
      </div>

      {/* Leads */}
      {(state?.sections ?? []).map(section => {
        const isExp = expanded.has(section.id)
        const colorClass = LEAD_STATE_COLOR[section.state] ?? 'bg-gray-700 text-gray-400'
        return (
          <div key={section.id} className="ml-3">
            <button
              onClick={() => { toggleExpand(section.id); onSelect(`${section.id}-lead`) }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded w-full text-left text-xs
                ${selectedEntity === `${section.id}-lead` ? 'ring-1 ring-yellow-400' : 'hover:bg-gray-700'}`}
            >
              <span className="text-gray-500">{isExp ? '▾' : '▸'}</span>
              <span className="text-yellow-300 font-mono">{section.id}-lead</span>
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${colorClass}`}>
                {section.state}
              </span>
            </button>

            {isExp && (
              <div className="ml-4 mt-1 flex flex-col gap-0.5">
                {section.workers.map(w => (
                  <WorkerCard
                    key={w.id}
                    worker={w}
                    selected={selectedEntity === w.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ws apps/web/src/hooks apps/web/src/components/WorkerCard.tsx apps/web/src/components/TreePanel.tsx
git commit -m "feat: dashboard WS client + useOrchestration hook + TreePanel + WorkerCard"
```

---

## Task 17: Dashboard — DetailPanel (Plan/Logs/Diff/Preview) + actions

**Files:**
- Create: `apps/web/src/components/DetailPanel.tsx`
- Create: `apps/web/src/components/EventStream.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Implement EventStream**

```tsx
// apps/web/src/components/EventStream.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { orcWs } from '../ws/client'

export function EventStream() {
  const [events, setEvents] = useState<Array<{ ts: number; type: string; entityId: string }>>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = orcWs.subscribe((raw: any) => {
      setEvents(prev => [...prev.slice(-99), { ts: raw.ts, type: raw.eventType, entityId: raw.entityId }])
    })
    return unsub
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])

  const EVENT_COLOR: Record<string, string> = {
    WorkerDone:     'text-green-400',
    WorkerFailed:   'text-red-400',
    WorkerStalled:  'text-yellow-400',
    WorkerZombie:   'text-red-400',
    WorkerRecovered:'text-blue-400',
    LeadDone:       'text-green-300',
    LeadFailed:     'text-red-300',
    MergeComplete:  'text-green-200',
    MergeConflict:  'text-orange-400',
    OrchestrationComplete: 'text-green-200 font-bold',
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3">
      <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2">
        Live Events
      </div>
      <div className="flex flex-col gap-1 text-[10px] font-mono">
        {events.map((e, i) => (
          <div key={i} className={`flex gap-2 ${EVENT_COLOR[e.type] ?? 'text-gray-500'}`}>
            <span className="text-gray-600">{new Date(e.ts).toLocaleTimeString()}</span>
            <span>{e.entityId}</span>
            <span>{e.type}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement DetailPanel**

```tsx
// apps/web/src/components/DetailPanel.tsx
'use client'
import { useState } from 'react'
import type { SectionInfo, WorkerInfo } from '../hooks/useOrchestration'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface Props {
  selectedId: string | null
  sections:   SectionInfo[]
}

type Tab = 'plan' | 'logs' | 'diff' | 'preview'

export function DetailPanel({ selectedId, sections }: Props) {
  const [tab, setTab] = useState<Tab>('plan')

  if (!selectedId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Select an entity from the tree
      </div>
    )
  }

  const isLead = selectedId.endsWith('-lead')
  const section = sections.find(s => s.id === selectedId.replace('-lead', ''))
  const worker = sections.flatMap(s => s.workers).find(w => w.id === selectedId)
  const entity = isLead ? section : worker

  async function handleApprove() {
    if (!worker) return
    await fetch(`${API}/api/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: worker.id }) })
  }

  async function handleDrop() {
    await fetch(`${API}/api/drop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: selectedId }) })
  }

  async function handlePreview() {
    if (!worker) return
    const res = await fetch(`${API}/api/preview/launch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worktreeId: worker.id }) })
    const data = await res.json()
    if (data.port) window.open(`http://localhost:${data.port}`, '_blank')
  }

  const TABS: Tab[] = ['plan', 'logs', 'diff', 'preview']

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
        <span className="font-mono text-yellow-300 font-bold text-sm">{selectedId}</span>
        <div className="ml-auto flex gap-2">
          {worker && worker.state === 'done' && (
            <button onClick={handleApprove} className="text-[11px] bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded">
              ✓ Approve
            </button>
          )}
          <button onClick={handleDrop} className="text-[11px] bg-gray-700 hover:bg-red-800 text-red-300 px-3 py-1 rounded">
            ✕ Drop
          </button>
          {worker && (
            <button onClick={handlePreview} className="text-[11px] bg-blue-800 hover:bg-blue-700 text-blue-200 px-3 py-1 rounded">
              ▶ Preview
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize
              ${tab === t ? 'border-b-2 border-blue-400 text-blue-300' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 text-xs font-mono text-gray-400">
        {tab === 'plan' && (
          <p className="text-gray-500">
            Plan file: <code>.orc/runs/current/{isLead ? `leads/${section?.id}.md` : `../${selectedId}/.orc/worker-plan.md`}</code>
            <br /><br />
            View the plan file directly in your editor or filesystem — it is a plain markdown file inside the worktree.
          </p>
        )}
        {tab === 'logs' && (
          <p className="text-gray-500">
            Session log: <code>.worktrees/{selectedId}/.orc/.orc-session.jsonl</code>
            <br /><br />
            Tail it in your terminal: <code>tail -f .worktrees/{selectedId}/.orc/.orc-session.jsonl</code>
          </p>
        )}
        {tab === 'diff' && (
          <p className="text-gray-500">
            View the diff in your terminal:<br />
            <code>git -C .worktrees/{selectedId} diff main..HEAD</code>
          </p>
        )}
        {tab === 'preview' && (
          worker?.previewPort
            ? <a href={`http://localhost:${worker.previewPort}`} target="_blank" rel="noreferrer" className="text-blue-400 underline">
                Open preview on port {worker.previewPort}
              </a>
            : <p className="text-gray-500">No preview running. Click ▶ Preview to launch.</p>
        )}
      </div>

      {/* Reviewer verdict for leads */}
      {isLead && section && section.workers.some(w => w.state === 'done') && (
        <div className="border-t border-gray-700 p-4">
          <div className="text-[10px] text-green-400 font-bold mb-2">WORKERS COMPLETED</div>
          <div className="flex gap-2 flex-wrap">
            {section.workers.filter(w => w.state === 'done').map(w => (
              <button
                key={w.id}
                onClick={() => fetch(`${API}/api/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: w.id }) })}
                className="text-[11px] bg-green-900 hover:bg-green-700 text-green-200 px-3 py-1 rounded"
              >
                ✓ Approve {w.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire up page.tsx**

```tsx
// apps/web/src/app/page.tsx
'use client'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrchestration } from '../hooks/useOrchestration'
import { TreePanel } from '../components/TreePanel'
import { DetailPanel } from '../components/DetailPanel'
import { EventStream } from '../components/EventStream'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const queryClient = new QueryClient()

function Dashboard() {
  const [selected, setSelected] = useState<string | null>(null)
  const [directive, setDirective] = useState('')
  const { data } = useOrchestration()

  async function sendDirective() {
    if (!directive.trim()) return
    await fetch(`${API}/api/steer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directive }) })
    setDirective('')
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-200">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-800">
        <span className="text-blue-400 font-bold text-sm">⬡ WorkTree Orchestrator</span>
        <div className="ml-auto flex gap-2">
          <input
            value={directive}
            onChange={e => setDirective(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendDirective()}
            placeholder='steer: "make bass darker…"'
            className="bg-gray-700 text-gray-200 text-xs px-3 py-1.5 rounded w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={sendDirective} className="bg-green-700 text-white text-xs px-3 py-1.5 rounded hover:bg-green-600">
            ↩
          </button>
        </div>
      </div>

      {/* Three panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: tree */}
        <div className="w-56 border-r border-gray-700 flex-shrink-0 overflow-y-auto">
          <TreePanel state={data} selectedEntity={selected} onSelect={setSelected} />
        </div>

        {/* Center: detail */}
        <div className="flex-1 overflow-hidden">
          <DetailPanel selectedId={selected} sections={data?.sections ?? []} />
        </div>

        {/* Right: event stream */}
        <div className="w-56 border-l border-gray-700 flex-shrink-0 overflow-y-auto">
          <EventStream />
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Add env vars**

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

- [ ] **Step 5: Start both apps and verify**

```bash
# Terminal 1
cd apps/api && pnpm dev

# Terminal 2
cd apps/web && pnpm dev
```

Open `http://localhost:3000` — expect dashboard to render with three panels and WebSocket connected.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: dashboard — TreePanel, DetailPanel (tabs), EventStream, actions (approve/drop/preview)"
```

---

## Task 18: LLM integration (wire actual LLM calls)

**Files:**
- Modify: `apps/api/src/cli.ts` (llmCall implementation)
- Create: `apps/api/src/orchestrator/llm.ts`
- Test: `apps/api/src/orchestrator/llm.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/llm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createLLMClient } from './llm'

describe('LLM client', () => {
  it('calls OpenAI compatible endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'result' } }] }),
    })
    global.fetch = mockFetch as any

    const llm = createLLMClient({ baseURL: 'http://localhost:11434/v1', model: 'gpt-4o', apiKey: 'test' })
    const result = await llm('hello')
    expect(result).toBe('result')
    expect(mockFetch).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/llm.test.ts
```

- [ ] **Step 3: Implement llm.ts**

```typescript
// apps/api/src/orchestrator/llm.ts
interface LLMConfig {
  baseURL: string
  model:   string
  apiKey:  string
}

export function createLLMClient(cfg: LLMConfig): (prompt: string) => Promise<string> {
  return async function llmCall(prompt: string): Promise<string> {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model:    cfg.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices[0].message.content as string
  }
}

export function createLLMClientFromEnv(): (prompt: string) => Promise<string> {
  const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const model   = process.env.OPENAI_MODEL   ?? 'gpt-4o'
  const apiKey  = process.env.OPENAI_API_KEY ?? ''
  return createLLMClient({ baseURL, model, apiKey })
}
```

- [ ] **Step 4: Wire into cli.ts** — replace the stub `llmCall` in `orc run`:

In `apps/api/src/cli.ts`, replace:
```typescript
llmCall: async (prompt: string) => {
  console.log('[orc] LLM call (stub):', prompt.slice(0, 80) + '...')
  return JSON.stringify([{ id: 'main', goal, numWorkers: 2 }])
},
```
With:
```typescript
llmCall: createLLMClientFromEnv(),
```

And add the import at the top:
```typescript
import { createLLMClientFromEnv } from './orchestrator/llm'
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/llm.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/llm.ts apps/api/src/cli.ts
git commit -m "feat: LLM client (OpenAI-compatible) wired into mastermind"
```

---

## Task 19: Integration smoke test

**Files:**
- Create: `apps/api/src/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// apps/api/src/integration.test.ts
import { describe, it, expect } from 'vitest'
import { createDb } from './db/journal'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { MockAgent } from './agents/mock'

describe('integration: full orchestration with MockAgent', () => {
  it('runs 2 sections × 2 workers each, reviewer picks winner, emits OrchestrationComplete', async () => {
    const db = createDb(':memory:')
    const gov = new ConcurrencyGovernor(4)
    const events: string[] = []

    const { eventBus } = await import('./events/eventBus')
    eventBus.on('event', (e: any) => events.push(e.eventType))

    const mastermind = new MastermindStateMachine({
      repoRoot: '/tmp/orc-test',
      db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async (prompt) => {
        if (prompt.includes('decompose')) {
          return JSON.stringify([
            { id: 'rhythm', goal: 'Write bass+drums', numWorkers: 2 },
            { id: 'melody', goal: 'Write melody', numWorkers: 2 },
          ])
        }
        if (prompt.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'best one' })
      },
      skillsDir: '/tmp/skills',
      maxConcurrentWorkers: 4,
    })

    const result = await mastermind.run({ userGoal: 'Build a track', runId: 'test-run' })

    expect(result.status).toBe('done')
    expect(events).toContain('OrchestrationComplete')
    expect(events).toContain('WorkerDone')
    expect(events).toContain('ReviewComplete')
  }, 30_000)
})
```

- [ ] **Step 2: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/integration.test.ts
```

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass across all packages.

- [ ] **Step 4: Final commit**

```bash
git add apps/api/src/integration.test.ts
git commit -m "test: integration smoke test — full orchestration with MockAgent"
```

---

## Self-Review

### Spec coverage check

| Spec section | Task |
|---|---|
| §2 SQLite journal + projections | Task 3 |
| §2 In-memory event bus | Task 4 |
| §3 Entity hierarchy + state machines | Tasks 7, 8, 9 |
| §3 OrchestrationComplete condition | Task 9 mastermind.ts |
| §4 SQLite schema (all tables) | Task 3 schema.ts |
| §5 Event bus + command queues | Task 4 |
| §7 MVP recovery (orc resume) | Task 15 cli.ts |
| §8 WorkerAgent + CodexCLIAdapter | Task 6 |
| §8 .orc-done.json + .orc-session.jsonl | Task 6 codex-cli.ts |
| §9 Concurrency governor | Task 7 |
| §9 Worker retry (fresh worktree) | Task 7 worker.ts (retry is Level 1 — re-spawn) |
| §10 ContextManager | Task 8 context.ts |
| §10 Reviewer + steering (buttons) | Task 8 lead.ts + Task 17 DetailPanel |
| §11 Skills files (8 files) | Task 12 |
| §12 Dashboard 3-panel | Tasks 16, 17 |
| §13 Monorepo layout | Task 1 |
| §14 CLI (run/status/resume) | Task 15 |
| §15 Design decisions | All tasks follow them |
| §16 Workflow templates | Task 13 |
| §17 Watchdog | Task 10 |
| §18 Merge coordinator | Task 11 |
| §19 Planning artifacts | Task 12 planFiles.ts |

**Gaps identified:**

1. **merge-fix worker** (§18) — not implemented in Task 11. The coordinator emits `MergeConflict` but no merge-fix worker is spawned. Add a `TODO` comment in `mergeCoordinator.ts` marking this as post-MVP v2.

2. **`routeDirective()`** — marked "MVP if time permits." Stub in `routes.ts` POST `/api/steer` returns 202 but doesn't route to leads. This is acceptable per spec.

3. **`orc resume` full recovery** (worktree reconciliation) — stub in CLI, acceptable per spec.

4. **Plan file creation wired into orchestrator** — `planFiles.ts` exists but is not called from `mastermind.ts` or `lead.ts`. Add `createRunPlan()` call in `MastermindStateMachine.run()` and `createLeadPlan()` + `createWorkerPlan()` in `LeadStateMachine.run()` and `WorkerStateMachine.run()`.

- [ ] **Fix gap 1 — add TODO comment in mergeCoordinator.ts**

In `apps/api/src/orchestrator/mergeCoordinator.ts`, inside the conflict branch:
```typescript
// TODO post-MVP: spawn merge-fix worker with repair/<merge-id>-v1 branch
// For MVP: emit MergeConflict and surface to dashboard for user A/B/C decision
```

- [ ] **Fix gap 4 — wire plan files into orchestrator**

In `apps/api/src/orchestrator/mastermind.ts`, after creating `runDir`:
```typescript
import { createRunPlan } from '../git/planFiles'
// ...
await createRunPlan(this.cfg.repoRoot, opts.runId ?? this.runId, {
  userGoal: opts.userGoal,
  sections: sections.map(s => s.id),
}).catch(() => { /* non-fatal */ })
```

In `apps/api/src/orchestrator/lead.ts`, after `this.emit('LeadPlanReady', ...)`:
```typescript
import { createLeadPlan } from '../git/planFiles'
// ...
await createLeadPlan(this.cfg.repoRoot, 'current', {
  sectionId: this.cfg.sectionId,
  sectionGoal: this.cfg.sectionGoal,
  workerVariants: workerPrompts,
}).catch(() => { /* non-fatal */ })
```

- [ ] **Commit fixes**

```bash
git add apps/api/src/orchestrator
git commit -m "fix: wire plan file creation into mastermind and lead; TODO for merge-fix worker"
```
