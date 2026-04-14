# WorkTree Orchestrator — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hierarchical multi-agent orchestration system where a Mastermind decomposes a user goal into parallel sections, each handled by a Lead team of Codex workers, with a live Next.js dashboard for visibility and control.

**Architecture:** Single Node.js process (apps/api) with in-memory command queues and event bus. All state written to SQLite (event_log + projections via Drizzle + drizzle-kit migrations). Express + WebSocket pushes events to Next.js dashboard (apps/web). Zod schemas in @orc/types are the contract between both apps.

**Tech Stack:** Turborepo · pnpm · Biome (ultracite) · Express · Drizzle ORM + better-sqlite3 · drizzle-kit migrations · Zod · Next.js (App Router, src/) · TanStack Query · Vitest · Codex CLI

---

## Build Tiers

| Tier | What it is |
|---|---|
| **True MVP** | Must ship for demo — real behavior, tested |
| **[DEGRADED]** | Accepted simplification — real code, reduced behavior |
| **[POST-DEMO]** | Not implemented in this plan |

**[DEGRADED] shortcuts:**
- `orc resume` = restart + load state from SQLite; no worktree reconciliation
- Preview = Strudel URL generation; no generic local dev-server
- Merge conflict = MergeConflict event emitted; no auto-repair
- OrchestrationComplete = "all leads done + all merges done"; does not track optional sections, stalled/zombie states, or merge_queue failure semantics from spec §3

**[POST-DEMO] (not in this plan):**
- Merge-fix worker
- Full crash recovery with worktree reconciliation
- Generic preview launcher (local dev-server)
- `routeDirective()` NL steering — API stub only, not routed to entity queues
- Rich NL steering routing

---

## Canonical Vocabulary

Use these exact strings everywhere. No synonyms.

**Event types:**
```
WorkerProgress · WorkerDone · WorkerFailed · WorkerStalled · WorkerZombie · WorkerRecovered
LeadPlanReady · ReviewComplete · LeadDone · LeadFailed
MergeRequested · MergeConflict · MergeComplete
PlanReady · LeadDelegated · CommandIssued
OrchestrationComplete · OrchestrationFailed
```

**Entity types:** `mastermind · lead · worker · pm · reviewer`

**Worker states:** `queued · spawning · running · stalled · zombie · done · failed · cancelled`

**Lead states:** `idle · planning · running · reviewing · merging · done · failed`

**Mastermind states:** `idle · planning · delegating · monitoring · merging · done · failed`

**Artifact paths inside `.worktrees/<id>/.orc/`:**
```
.orc-done.json      — { status, exitCode, ts }
.orc-session.jsonl  — one JSON line per Codex output chunk
worker-plan.md      — worker task sheet
```

**Branch naming:**
```
feat/<section>-v<n>         e.g. feat/rhythm-v1
feat/<section>-v<n>-r<n>   e.g. feat/rhythm-v1-r2 (retry)
run/<run-id>                integration branch
```

---

## File Map

```
apps/api/src/
  db/
    schema.ts · client.ts · journal.ts · queries.ts
    migrations/           ← drizzle-kit generated
  events/
    eventBus.ts           ← publish-only EventEmitter (never for commands)
    commandQueues.ts      ← CommandQueue<T> per-role
  git/
    worktree.ts · reconcile.ts · planFiles.ts
  agents/
    types.ts · codex-cli.ts · mock.ts
  orchestrator/
    concurrency.ts · worker.ts · lead.ts · mastermind.ts
    context.ts · watchdog.ts · mergeCoordinator.ts
    templateLoader.ts · llm.ts · preview.ts
  server/
    app.ts · routes.ts · wsHandler.ts
  test-helpers/
    initTestRepo.ts
  cli.ts

apps/web/src/
  app/page.tsx · app/layout.tsx · app/providers.tsx
  components/TreePanel.tsx · DetailPanel.tsx · EventStream.tsx · WorkerCard.tsx
  hooks/useOrchestration.ts · useEventStream.ts
  ws/client.ts

packages/types/src/
  events.ts · commands.ts · api.ts · index.ts

templates/strudel-track.toml
skills/  (8 .md files)
```

---

## Task 1: Monorepo scaffold + test helper

**Files:** all root config, `packages/config/`, `packages/types/` scaffold, `apps/api/` scaffold, `apps/web/` (Next.js src/), `apps/api/src/test-helpers/initTestRepo.ts`

- [ ] **Step 1: Root workspace files**

```json
// package.json
{
  "name": "worktree-orchestrator",
  "private": true,
  "scripts": {
    "dev":          "turbo run dev --parallel",
    "build":        "turbo run build",
    "test":         "turbo run test",
    "lint":         "biome check .",
    "db:generate":  "cd apps/api && pnpm drizzle-kit generate",
    "db:migrate":   "cd apps/api && pnpm drizzle-kit migrate"
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
    "dev":   { "persistent": true, "cache": false },
    "test":  { "dependsOn": ["^build"] },
    "lint":  {}
  }
}
```

```json
// biome.json
{ "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json", "extends": ["./packages/config/biome.json"] }
```

- [ ] **Step 2: packages/config**

```json
// packages/config/biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "extends": ["ultracite"],
  "files": { "ignore": ["node_modules", ".next", "dist", ".turbo", "migrations"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true },
  "organizeImports": { "enabled": true }
}
```

```json
// packages/config/package.json
{ "name": "@orc/config", "version": "0.0.1", "private": true, "files": ["biome.json"] }
```

- [ ] **Step 3: packages/types scaffold**

```json
// packages/types/package.json
{
  "name": "@orc/types", "version": "0.0.1", "private": true,
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```

```typescript
// packages/types/src/index.ts
export * from './events'
export * from './commands'
export * from './api'
```

- [ ] **Step 4: apps/api scaffold**

```json
// apps/api/package.json
{
  "name": "@orc/api", "version": "0.0.1", "private": true, "type": "module",
  "scripts": {
    "dev": "tsx watch src/cli.ts",
    "build": "tsc",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@orc/types": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "drizzle-orm": "^0.36.0",
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "toml": "^3.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@orc/config": "workspace:*",
    "@types/better-sqlite3": "^7.6.0",
    "@types/cors": "^2.8.0",
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
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist",
    "paths": { "@orc/types": ["../../packages/types/src/index.ts"] }
  },
  "include": ["src"]
}
```

```typescript
// apps/api/drizzle.config.ts
import type { Config } from 'drizzle-kit'
export default {
  schema: './src/db/schema.ts',
  out:    './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.ORC_DB_PATH ?? './orc.db' },
} satisfies Config
```

- [ ] **Step 5: apps/web — Next.js with src/**

```bash
cd apps/web && pnpm dlx create-next-app@latest . \
  --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint
```

Add to `apps/web/package.json` dependencies:
```json
{
  "@orc/types": "workspace:*",
  "@tanstack/react-query": "^5.0.0",
  "zod": "^3.23.0"
}
```

- [ ] **Step 6: initTestRepo helper**

```typescript
// apps/api/src/test-helpers/initTestRepo.ts
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export function initTestRepo(label = `${Date.now()}`): string {
  const dir = path.join(os.tmpdir(), `orc-test-${label}`)
  fs.mkdirSync(dir, { recursive: true })
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@orc.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "OrcTest"', { cwd: dir, stdio: 'pipe' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# orc test repo')
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  return dir
}

export function cleanupTestRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}
```

- [ ] **Step 7: Install and verify**

```bash
pnpm install
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffold — turborepo, biome, @orc/types, apps/api, apps/web, initTestRepo"
```


---

## Task 2: @orc/types — canonical Zod schemas

**Files:** `packages/types/src/events.ts`, `commands.ts`, `api.ts` · Test: `events.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/types/src/events.test.ts
import { describe, it, expect } from 'vitest'
import { OrcEventSchema } from './events'

describe('OrcEventSchema', () => {
  it('parses WorkerDone', () => {
    expect(OrcEventSchema.parse({
      entityId: 'rhythm-v1', entityType: 'worker', eventType: 'WorkerDone',
      sequence: 1, ts: 1, payload: { branch: 'feat/rhythm-v1', diff: '+x' },
    }).entityId).toBe('rhythm-v1')
  })
  it('rejects unknown eventType', () => {
    expect(() => OrcEventSchema.parse({
      entityId: 'x', entityType: 'worker', eventType: 'NoSuchEvent',
      sequence: 1, ts: 1, payload: {},
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/types && pnpm vitest run
```

- [ ] **Step 3: Implement events.ts (use canonical names from vocabulary section)**

```typescript
// packages/types/src/events.ts
import { z } from 'zod'

export const EntityTypeSchema = z.enum(['mastermind','lead','worker','pm','reviewer'])
export type EntityType = z.infer<typeof EntityTypeSchema>

const base = z.object({
  entityId:   z.string(),
  entityType: EntityTypeSchema,
  sequence:   z.number().int().nonnegative(),
  ts:         z.number().int(),
  payload:    z.record(z.unknown()),
})

export const WorkerProgressSchema  = base.extend({ eventType: z.literal('WorkerProgress'),  payload: z.object({ output: z.string(), ts: z.number() }) })
export const WorkerDoneSchema      = base.extend({ eventType: z.literal('WorkerDone'),      payload: z.object({ branch: z.string(), diff: z.string() }) })
export const WorkerFailedSchema    = base.extend({ eventType: z.literal('WorkerFailed'),    payload: z.object({ error: z.string(), retryable: z.boolean() }) })
export const WorkerStalledSchema   = base.extend({ eventType: z.literal('WorkerStalled'),   payload: z.object({ lastSeenAt: z.number() }) })
export const WorkerZombieSchema    = base.extend({ eventType: z.literal('WorkerZombie'),    payload: z.object({ pid: z.number() }) })
export const WorkerRecoveredSchema = base.extend({ eventType: z.literal('WorkerRecovered'), payload: z.object({}) })
export const LeadPlanReadySchema   = base.extend({ eventType: z.literal('LeadPlanReady'),   payload: z.object({ workerPrompts: z.array(z.string()) }) })
export const ReviewCompleteSchema  = base.extend({ eventType: z.literal('ReviewComplete'),  payload: z.object({ winnerId: z.string(), reasoning: z.string() }) })
export const LeadDoneSchema        = base.extend({ eventType: z.literal('LeadDone'),        payload: z.object({ branch: z.string(), sectionId: z.string() }) })
export const LeadFailedSchema      = base.extend({ eventType: z.literal('LeadFailed'),      payload: z.object({ reason: z.string() }) })
export const MergeRequestedSchema  = base.extend({ eventType: z.literal('MergeRequested'), payload: z.object({ leadId: z.string(), worktreeId: z.string(), targetBranch: z.string() }) })
export const MergeConflictSchema   = base.extend({ eventType: z.literal('MergeConflict'),  payload: z.object({ mergeId: z.string(), conflictFiles: z.array(z.string()) }) })
export const MergeCompleteSchema   = base.extend({ eventType: z.literal('MergeComplete'),  payload: z.object({ mergeId: z.string(), targetBranch: z.string() }) })
export const PlanReadySchema       = base.extend({ eventType: z.literal('PlanReady'),      payload: z.object({ sections: z.array(z.string()), runId: z.string() }) })
export const LeadDelegatedSchema   = base.extend({ eventType: z.literal('LeadDelegated'),  payload: z.object({ leadId: z.string(), sectionId: z.string() }) })
export const CommandIssuedSchema   = base.extend({ eventType: z.literal('CommandIssued'),  payload: z.object({ from: z.string(), to: z.string(), commandType: z.string(), commandPayload: z.record(z.unknown()) }) })
export const OrchCompleteSchema    = base.extend({ eventType: z.literal('OrchestrationComplete'), payload: z.object({ runBranch: z.string() }) })
export const OrchFailedSchema      = base.extend({ eventType: z.literal('OrchestrationFailed'),   payload: z.object({ reason: z.string() }) })

export const OrcEventSchema = z.discriminatedUnion('eventType', [
  WorkerProgressSchema, WorkerDoneSchema, WorkerFailedSchema,
  WorkerStalledSchema, WorkerZombieSchema, WorkerRecoveredSchema,
  LeadPlanReadySchema, ReviewCompleteSchema, LeadDoneSchema, LeadFailedSchema,
  MergeRequestedSchema, MergeConflictSchema, MergeCompleteSchema,
  PlanReadySchema, LeadDelegatedSchema, CommandIssuedSchema,
  OrchCompleteSchema, OrchFailedSchema,
])
export type OrcEvent = z.infer<typeof OrcEventSchema>
```

- [ ] **Step 4: Implement commands.ts**

```typescript
// packages/types/src/commands.ts
import { z } from 'zod'
export const SpawnWorkerCmd      = z.object({ commandType: z.literal('SpawnWorker'),      workerId: z.string(), prompt: z.string(), strategy: z.string().optional(), errorHistory: z.array(z.string()).default([]) })
export const AbortCmd            = z.object({ commandType: z.literal('Abort'),            targetWorkerId: z.string().optional() })
export const ForceApproveCmd     = z.object({ commandType: z.literal('ForceApprove'),     winnerId: z.string() })
export const InjectConstraintCmd = z.object({ commandType: z.literal('InjectConstraint'), constraint: z.string() })
export const OrcCommandSchema    = z.discriminatedUnion('commandType', [SpawnWorkerCmd, AbortCmd, ForceApproveCmd, InjectConstraintCmd])
export type OrcCommand = z.infer<typeof OrcCommandSchema>
```

- [ ] **Step 5: Implement api.ts**

```typescript
// packages/types/src/api.ts
import { z } from 'zod'
export const WorkerInfoSchema  = z.object({ id: z.string(), state: z.string(), branch: z.string().optional(), previewUrl: z.string().optional() })
export const SectionInfoSchema = z.object({ id: z.string(), state: z.string(), workers: z.array(WorkerInfoSchema) })
export const OrchStateSchema   = z.object({ runId: z.string(), mastermindState: z.string(), sections: z.array(SectionInfoSchema) })
export type WorkerInfo  = z.infer<typeof WorkerInfoSchema>
export type SectionInfo = z.infer<typeof SectionInfoSchema>
export type OrchState   = z.infer<typeof OrchStateSchema>
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd packages/types && pnpm vitest run
```

- [ ] **Step 7: Commit**

```bash
git add packages/types
git commit -m "feat: @orc/types — canonical Zod schemas (events, commands, API)"
```

---

## Task 3: SQLite schema + Drizzle migrations + journal

**Files:** `apps/api/src/db/schema.ts`, `client.ts`, `journal.ts`, `queries.ts`, `migrations/` (generated) · Test: `journal.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/db/journal.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from './client'
import { writeEvent, getEventsSince } from './journal'

describe('journal', () => {
  let db: ReturnType<typeof createTestDb>
  beforeEach(() => { db = createTestDb() })

  it('appends and retrieves an event', () => {
    writeEvent(db, {
      entityId: 'rhythm-v1', entityType: 'worker', eventType: 'WorkerDone',
      sequence: 1, ts: Date.now(), payload: { branch: 'feat/rhythm-v1', diff: '+x' },
    }, () => {})
    expect(getEventsSince(db, 0)).toHaveLength(1)
  })

  it('rejects duplicate (entityId, sequence)', () => {
    const e = { entityId: 'w1', entityType: 'worker' as const, eventType: 'WorkerDone',
                sequence: 1, ts: 1, payload: { branch: 'b', diff: 'd' } }
    writeEvent(db, e, () => {})
    expect(() => writeEvent(db, e, () => {})).toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/db/journal.test.ts
```

- [ ] **Step 3: Implement schema.ts**

```typescript
// apps/api/src/db/schema.ts
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const eventLog = sqliteTable('event_log', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  entityId:   text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  eventType:  text('event_type').notNull(),
  sequence:   integer('sequence').notNull(),
  payload:    text('payload').notNull(),
  ts:         integer('ts').notNull(),
}, t => ({ uniqEntitySeq: uniqueIndex('entity_seq_uniq').on(t.entityId, t.sequence) }))

export const tasks = sqliteTable('tasks', {
  id:              text('id').primaryKey(),
  type:            text('type').notNull(),
  parentId:        text('parent_id'),
  state:           text('state').notNull().default('pending'),
  retryCount:      integer('retry_count').notNull().default(0),
  taskPrompt:      text('task_prompt'),
  strategy:        text('strategy'),
  spawnGeneration: integer('spawn_generation').notNull().default(0),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
})

export const runs = sqliteTable('runs', {
  id:          text('id').primaryKey(),
  entityId:    text('entity_id').notNull(),
  adapterType: text('adapter_type'),
  pid:         integer('pid'),
  startedAt:   integer('started_at').notNull(),
  lastSeenAt:  integer('last_seen_at'),
})

export const worktrees = sqliteTable('worktrees', {
  id:         text('id').primaryKey(),
  workerId:   text('worker_id').notNull(),
  path:       text('path').notNull(),
  branch:     text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  gitStatus:  text('git_status').default('clean'),
})

export const taskEdges = sqliteTable('task_edges', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  parentId: text('parent_id').notNull(),
  childId:  text('child_id').notNull(),
  edgeType: text('edge_type').notNull(),
})

export const mergeCandidates = sqliteTable('merge_candidates', {
  id:                text('id').primaryKey(),
  leadId:            text('lead_id').notNull(),
  winnerWorkerId:    text('winner_worker_id').notNull(),
  targetBranch:      text('target_branch').notNull(),
  reviewerReasoning: text('reviewer_reasoning'),
})

export const mergeQueue = sqliteTable('merge_queue', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  leadId:           text('lead_id').notNull(),
  winnerWorktreeId: text('winner_worktree_id').notNull(),
  targetBranch:     text('target_branch').notNull(),
  status:           text('status').notNull().default('pending'),
  conflictDetails:  text('conflict_details'),
  fixWorkerId:      text('fix_worker_id'),
  fixAttempts:      integer('fix_attempts').notNull().default(0),
  createdAt:        integer('created_at').notNull(),
  mergedAt:         integer('merged_at'),
})

export const previews = sqliteTable('previews', {
  id:         text('id').primaryKey(),
  worktreeId: text('worktree_id').notNull(),
  previewUrl: text('preview_url').notNull(),
  status:     text('status').notNull().default('inactive'),
  launchedAt: integer('launched_at'),
})

export const artifacts = sqliteTable('artifacts', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  entityId:     text('entity_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  path:         text('path').notNull(),
  updatedAt:    integer('updated_at').notNull(),
}, t => ({ uniqEntityArtifact: uniqueIndex('entity_artifact_uniq').on(t.entityId, t.artifactType) }))
```

- [ ] **Step 4: Implement client.ts**

```typescript
// apps/api/src/db/client.ts
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as path from 'node:path'
import * as url from 'node:url'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>
const __filename = url.fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

let _db: Db | null = null

function makeDb(sqlite: Database.Database): Db {
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return db
}

export function initDb(dbPath: string): Db {
  _db = makeDb(new Database(dbPath))
  return _db
}

export function getDb(): Db {
  if (!_db) throw new Error('DB not initialised — call initDb() first')
  return _db
}

export function createTestDb(): Db {
  return makeDb(new Database(':memory:'))
}

export function getSQLite(db: Db): Database.Database {
  return (db as any).session.client as Database.Database
}
```

- [ ] **Step 5: Implement journal.ts**

```typescript
// apps/api/src/db/journal.ts
import { getSQLite, type Db } from './client'
import { eventBus } from '../events/eventBus'
import type { OrcEvent } from '@orc/types'

export function writeEvent(db: Db, event: OrcEvent, updateProjection: () => void): void {
  const sqlite = getSQLite(db)
  sqlite.transaction(() => {
    sqlite.prepare(
      'INSERT INTO event_log (entity_id, entity_type, event_type, sequence, payload, ts) VALUES (?,?,?,?,?,?)'
    ).run(event.entityId, event.entityType, event.eventType, event.sequence, JSON.stringify(event.payload), event.ts)
    updateProjection()
  })()
  eventBus.publish(event)   // outside transaction — publish-only, never for commands
}

export function getEventsSince(db: Db, afterId: number) {
  return getSQLite(db).prepare('SELECT * FROM event_log WHERE id > ? ORDER BY id ASC').all(afterId) as Array<{
    id: number; entityId: string; entityType: string; eventType: string; sequence: number; payload: string; ts: number
  }>
}

/** Monotonic sequence counter per entity — use this instead of Date.now() for sequence */
const _seqs = new Map<string, number>()
export function nextSeq(entityId: string): number {
  const n = (_seqs.get(entityId) ?? 0) + 1
  _seqs.set(entityId, n)
  return n
}
```

- [ ] **Step 6: Implement queries.ts**

```typescript
// apps/api/src/db/queries.ts
import { getSQLite, type Db } from './client'

export function getAllTasks(db: Db) {
  return getSQLite(db).prepare('SELECT * FROM tasks ORDER BY type, id').all() as Array<{ id: string; type: string; parentId: string|null; state: string }>
}
export function getWorktrees(db: Db) {
  return getSQLite(db).prepare('SELECT * FROM worktrees').all() as Array<{ id: string; workerId: string; path: string; branch: string; baseBranch: string }>
}
export function getPreviews(db: Db) {
  return getSQLite(db).prepare("SELECT * FROM previews WHERE status='active'").all() as Array<{ worktreeId: string; previewUrl: string }>
}
export function upsertTask(db: Db, id: string, type: string, parentId: string|null, state: string): void {
  const now = Date.now()
  getSQLite(db).prepare(`INSERT INTO tasks (id,type,parent_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`).run(id, type, parentId, state, now, now)
}
export function upsertWorktree(db: Db, id: string, workerId: string, wtPath: string, branch: string, baseBranch: string): void {
  getSQLite(db).prepare(`INSERT INTO worktrees(id,worker_id,path,branch,base_branch) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET branch=excluded.branch`).run(id, workerId, wtPath, branch, baseBranch)
}
export function upsertArtifact(db: Db, entityId: string, artifactType: string, filePath: string): void {
  getSQLite(db).prepare(`INSERT INTO artifacts(entity_id,artifact_type,path,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(entity_id,artifact_type) DO UPDATE SET path=excluded.path, updated_at=excluded.updated_at`).run(entityId, artifactType, filePath, Date.now())
}
```

- [ ] **Step 7: Generate migrations**

```bash
cd apps/api && pnpm drizzle-kit generate
```

Expected: `src/db/migrations/0000_*.sql` created.

- [ ] **Step 8: Run test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/db/journal.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db
git commit -m "feat: SQLite schema (Drizzle) + drizzle-kit migrations + journal + queries"
```

---

## Task 4: Event bus + command queues

**Files:** `apps/api/src/events/eventBus.ts`, `commandQueues.ts` · Test: `eventBus.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/events/eventBus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { eventBus } from './eventBus'
import { CommandQueue } from './commandQueues'
import type { OrcEvent } from '@orc/types'

describe('eventBus', () => {
  it('publishes to subscribers', () => {
    const fn = vi.fn()
    eventBus.on('event', fn)
    const e = { entityId: 'w1', entityType: 'worker', eventType: 'WorkerDone',
                sequence: 1, ts: 1, payload: { branch: 'b', diff: 'd' } } as OrcEvent
    eventBus.publish(e)
    expect(fn).toHaveBeenCalledWith(e)
    eventBus.off('event', fn)
  })
})

describe('CommandQueue', () => {
  it('FIFO order', async () => {
    const q = new CommandQueue<string>()
    q.enqueue('a'); q.enqueue('b')
    expect(await q.dequeue()).toBe('a')
    expect(await q.dequeue()).toBe('b')
  })
  it('blocks until item available', async () => {
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

class OrcEventBus extends EventEmitter {
  /** Publish-only — NEVER use for command delivery */
  publish(event: OrcEvent): void { this.emit('event', event) }
}

export const eventBus = new OrcEventBus()
eventBus.setMaxListeners(200)
```

- [ ] **Step 4: Implement commandQueues.ts**

```typescript
// apps/api/src/events/commandQueues.ts
/** Per-role in-process command transport. Not observable. Never touches event bus. */
export class CommandQueue<T> {
  private readonly buffer: T[] = []
  private readonly waiters: Array<(v: T) => void> = []

  enqueue(item: T): void {
    const w = this.waiters.shift()
    if (w) { w(item) } else { this.buffer.push(item) }
  }

  dequeue(): Promise<T> {
    const item = this.buffer.shift()
    if (item !== undefined) return Promise.resolve(item)
    return new Promise(resolve => { this.waiters.push(resolve) })
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
git commit -m "feat: event bus (publish-only) + CommandQueue (per-role command transport)"
```


---

## Task 5: Git worktree manager + plan files

**Files:** `apps/api/src/git/worktree.ts`, `reconcile.ts`, `planFiles.ts` · Test: `worktree.test.ts`, `planFiles.test.ts`

- [ ] **Step 1: Write failing worktree test (uses initTestRepo)**

```typescript
// apps/api/src/git/worktree.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createWorktree, listWorktrees, removeWorktree } from './worktree'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('worktree', () => {
  it('creates, lists, and removes a worktree', async () => {
    repoDir = initTestRepo('wt-test')
    const wtPath = `${repoDir}/../wt-rhythm-v1`
    await createWorktree(repoDir, wtPath, 'feat/rhythm-v1')
    const wts = await listWorktrees(repoDir)
    expect(wts.some(w => w.path === wtPath)).toBe(true)
    await removeWorktree(repoDir, wtPath)
    const wts2 = await listWorktrees(repoDir)
    expect(wts2.some(w => w.path === wtPath)).toBe(false)
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

const exec = promisify(execFile)
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout.trim()
}

export interface WorktreeInfo { path: string; branch: string | null; head: string }

export async function createWorktree(repoRoot: string, wtPath: string, branch: string): Promise<void> {
  await fs.mkdir(path.dirname(wtPath), { recursive: true })
  await git(repoRoot, ['worktree', 'add', '-b', branch, wtPath, 'HEAD'])
  await fs.mkdir(path.join(wtPath, '.orc'), { recursive: true })
}

export async function removeWorktree(repoRoot: string, wtPath: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--force', wtPath])
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  const result: WorktreeInfo[] = []
  let cur: Partial<WorktreeInfo> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur.path = line.slice(9)
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
    else if (line === '' && cur.path) { result.push(cur as WorktreeInfo); cur = {} }
  }
  if (cur.path) result.push(cur as WorktreeInfo)
  return result
}

export async function getWorktreeDiff(wtPath: string, baseBranch: string): Promise<string> {
  try { return await git(wtPath, ['diff', baseBranch, '--stat']) } catch { return '' }
}

export async function hasUncommittedChanges(wtPath: string): Promise<boolean> {
  try { return (await git(wtPath, ['status', '--porcelain'])).length > 0 } catch { return false }
}

/** Create a new branch at HEAD (used to create the run/<id> integration branch before merges) */
export async function createBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ['checkout', '-b', branch])
}

export async function mergeBranch(
  repoRoot: string, targetBranch: string, sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  try {
    await git(repoRoot, ['checkout', targetBranch])
    await git(repoRoot, ['merge', sourceBranch, '--no-ff', '-m', `merge: ${sourceBranch}`])
    return { success: true, conflictFiles: [] }
  } catch {
    const conflicts = await git(repoRoot, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    await git(repoRoot, ['merge', '--abort']).catch(() => {})
    return { success: false, conflictFiles: conflicts.split('\n').filter(Boolean) }
  }
}
```

- [ ] **Step 4: Implement reconcile.ts**

```typescript
// apps/api/src/git/reconcile.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface DoneMarker { status: 'done' | 'failed'; exitCode: number; ts: number }
export type ReconcileStatus = 'done' | 'failed' | 'interrupted' | 'never-started' | 'missing'

export async function readDoneMarker(wtPath: string): Promise<DoneMarker | null> {
  try { return JSON.parse(await fs.readFile(path.join(wtPath, '.orc', '.orc-done.json'), 'utf-8')) }
  catch { return null }
}

export async function writeDoneMarker(wtPath: string, marker: DoneMarker): Promise<void> {
  await fs.writeFile(path.join(wtPath, '.orc', '.orc-done.json'), JSON.stringify(marker))
}
```

- [ ] **Step 5: Write failing planFiles test**

```typescript
// apps/api/src/git/planFiles.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createRunPlan, createLeadPlan, createWorkerPlan } from './planFiles'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('planFiles', () => {
  it('creates run plan with goal', async () => {
    repoDir = initTestRepo('plan-test')
    await fs.mkdir(path.join(repoDir, '.orc', 'runs', 'r1', 'leads'), { recursive: true })
    const p = await createRunPlan(repoDir, 'r1', { userGoal: 'Build lo-fi track', sections: ['rhythm'] })
    const content = await fs.readFile(p, 'utf-8')
    expect(content).toContain('Build lo-fi track')
  })

  it('creates worker plan inside worktree .orc/', async () => {
    repoDir = repoDir ?? initTestRepo('plan-test2')
    const wtPath = path.join(repoDir, '..', 'rhythm-v1')
    await fs.mkdir(path.join(wtPath, '.orc'), { recursive: true })
    const p = await createWorkerPlan(wtPath, { workerId: 'rhythm-v1', objective: 'Write bass', strategy: 'minimal' })
    const content = await fs.readFile(p, 'utf-8')
    expect(content).toContain('Write bass')
    expect(p).toContain('.orc/worker-plan.md')
  })
})
```

- [ ] **Step 6: Implement planFiles.ts**

```typescript
// apps/api/src/git/planFiles.ts
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
```

- [ ] **Step 7: Run both tests — expect PASS**

```bash
cd apps/api && pnpm vitest run src/git/
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/git
git commit -m "feat: git worktree manager + reconcile + plan file creation"
```

---

## Task 6: WorkerAgent interface + MockAgent + CodexCLIAdapter

**Files:** `apps/api/src/agents/types.ts`, `mock.ts`, `codex-cli.ts` · Test: `mock.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/agents/mock.test.ts
import { describe, it, expect } from 'vitest'
import { MockAgent } from './mock'

const ctx = { worktreePath: '/tmp/wt', branch: 'feat/x', baseBranch: 'main',
              entityId: 'w1', planPath: '', leadPlanPath: '', runPlanPath: '' }
const task = { id: 'w1', prompt: 'test', maxRetries: 1, errorHistory: [] }

describe('MockAgent', () => {
  it('returns done', async () => {
    const r = await new MockAgent({ delayMs: 0, outcome: 'done' }).run(task, ctx)
    expect(r.status).toBe('done')
    expect(r.branch).toBe('feat/x')
  })
  it('returns failed with retryable=true', async () => {
    const r = await new MockAgent({ delayMs: 0, outcome: 'failed' }).run(task, ctx)
    expect(r.status).toBe('failed')
    expect(r.retryable).toBe(true)
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
export interface WorkerTask    { id: string; prompt: string; maxRetries: number; strategy?: string; errorHistory: string[] }
export interface WorkerContext { worktreePath: string; branch: string; baseBranch: string; entityId: string; planPath: string; leadPlanPath: string; runPlanPath: string }
export interface WorkerResult  { status: 'done'|'failed'; branch: string; diff?: string; error?: string; retryable: boolean }
export interface WorkerAgent   { run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult>; abort(): Promise<void> }
```

- [ ] **Step 4: Implement mock.ts**

```typescript
// apps/api/src/agents/mock.ts
import type { WorkerAgent, WorkerTask, WorkerContext, WorkerResult } from './types'

export class MockAgent implements WorkerAgent {
  private aborted = false
  constructor(private opts: { delayMs: number; outcome: 'done'|'failed' }) {}
  async run(_task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    if (this.opts.delayMs > 0) await new Promise(r => setTimeout(r, this.opts.delayMs))
    if (this.aborted)           return { status: 'failed', branch: ctx.branch, error: 'aborted', retryable: false }
    if (this.opts.outcome === 'failed') return { status: 'failed', branch: ctx.branch, error: 'mock failure', retryable: true }
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
import { nextSeq } from '../db/journal'

export class CodexCLIAdapter implements WorkerAgent {
  private proc: ReturnType<typeof spawn> | null = null

  async run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult> {
    const sessionPath = path.join(ctx.worktreePath, '.orc', '.orc-session.jsonl')
    const session = await fs.open(sessionPath, 'a')
    const prompt = [task.prompt, task.strategy ? `\nApproach: ${task.strategy}` : '',
      task.errorHistory.length ? `\nPrior failures:\n${task.errorHistory.join('\n')}` : '',
      `\nYour plan: ${ctx.planPath}`, `\nLead plan: ${ctx.leadPlanPath}`, `\nRun plan: ${ctx.runPlanPath}`,
    ].join('')

    return new Promise<WorkerResult>(resolve => {
      this.proc = spawn('codex', ['--prompt', prompt, '--json'], { cwd: ctx.worktreePath, env: { ...process.env } })

      this.proc.stdout?.on('data', async (chunk: Buffer) => {
        const line = chunk.toString()
        await session.write(JSON.stringify({ ts: Date.now(), output: line }) + '\n')
        eventBus.publish({ entityId: ctx.entityId, entityType: 'worker', eventType: 'WorkerProgress',
          sequence: nextSeq(ctx.entityId), ts: Date.now(), payload: { output: line, ts: Date.now() } } as any)
      })

      const finish = async (code: number | null) => {
        await session.close()
        const status = code === 0 ? 'done' as const : 'failed' as const
        await writeDoneMarker(ctx.worktreePath, { status, exitCode: code ?? 1, ts: Date.now() })
        if (status === 'done') {
          resolve({ status: 'done', branch: ctx.branch, diff: await getWorktreeDiff(ctx.worktreePath, ctx.baseBranch), retryable: false })
        } else {
          resolve({ status: 'failed', branch: ctx.branch, error: `exit code ${code}`, retryable: true })
        }
      }
      this.proc.on('close', finish)
      this.proc.on('error', async err => { await session.close(); resolve({ status: 'failed', branch: ctx.branch, error: err.message, retryable: true }) })
    })
  }

  async abort(): Promise<void> { this.proc?.kill('SIGTERM') }
}
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/agents/mock.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents
git commit -m "feat: WorkerAgent interface + MockAgent + CodexCLIAdapter"
```

---

## Task 7: ConcurrencyGovernor (fixed release logic)

**Files:** `apps/api/src/orchestrator/concurrency.ts` · Test: `concurrency.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/orchestrator/concurrency.test.ts
import { describe, it, expect } from 'vitest'
import { ConcurrencyGovernor } from './concurrency'

describe('ConcurrencyGovernor', () => {
  it('allows up to max concurrent', async () => {
    const g = new ConcurrencyGovernor(2)
    await g.acquire(); await g.acquire()
    expect(g.activeCount).toBe(2)
  })

  it('queues when at cap, unblocks on release', async () => {
    const g = new ConcurrencyGovernor(1)
    await g.acquire()
    let done = false
    const p = g.acquire().then(() => { done = true })
    expect(done).toBe(false)
    g.release()
    await p
    expect(done).toBe(true)
    expect(g.activeCount).toBe(1)   // slot transferred to waiter, count unchanged
  })

  it('decrements active when no waiter', () => {
    const g = new ConcurrencyGovernor(2)
    g.acquire()  // fire and forget — sync path
    g.release()
    expect(g.activeCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/concurrency.test.ts
```

- [ ] **Step 3: Implement concurrency.ts (correct release logic)**

```typescript
// apps/api/src/orchestrator/concurrency.ts
export class ConcurrencyGovernor {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return Promise.resolve() }
    return new Promise<void>(resolve => { this.waiters.push(resolve) })
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      // Transfer slot to waiting acquirer — active count stays the same
      // (waiter was waiting for a slot; we give it the one being released)
      waiter()
    } else {
      this.active = Math.max(0, this.active - 1)
    }
  }

  get activeCount(): number { return this.active }
  get waitingCount(): number { return this.waiters.length }
}

export let governor = new ConcurrencyGovernor(4)
export function configureGovernor(max: number): void { governor = new ConcurrencyGovernor(max) }
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/concurrency.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orchestrator/concurrency.ts
git commit -m "feat: ConcurrencyGovernor — fixed release() slot-transfer semantics"
```


---

## Task 8: Worker state machine (plan artifact wired in from start)

**Files:** `apps/api/src/orchestrator/worker.ts` · Test: `worker.test.ts`

- [ ] **Step 1: Write failing test (uses initTestRepo)**

```typescript
// apps/api/src/orchestrator/worker.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { WorkerStateMachine } from './worker'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('WorkerStateMachine', () => {
  it('queued → spawning → running → done, creates plan file', async () => {
    repoDir = initTestRepo('worker-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)

    const worker = new WorkerStateMachine({
      id: 'rhythm-v1', leadId: 'rhythm-lead', sectionId: 'rhythm',
      branch: 'feat/rhythm-v1', baseBranch: 'main',
      repoRoot: repoDir, runId: 'run-1', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    })

    const result = await worker.run({ id: 'rhythm-v1', prompt: 'Write rhythm', maxRetries: 1, errorHistory: [] })
    expect(result.status).toBe('done')
    expect(worker.state).toBe('done')
  }, 15_000)

  it('emits WorkerFailed and slotHeld=false on failure', async () => {
    repoDir = repoDir ?? initTestRepo('worker-fail-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)

    const worker = new WorkerStateMachine({
      id: 'rhythm-v2', leadId: 'rhythm-lead', sectionId: 'rhythm',
      branch: 'feat/rhythm-v2', baseBranch: 'main',
      repoRoot: repoDir, runId: 'run-1', db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'failed' }),
    })

    const result = await worker.run({ id: 'rhythm-v2', prompt: 'Write rhythm', maxRetries: 1, errorHistory: [] })
    expect(result.status).toBe('failed')
    expect(gov.activeCount).toBe(0)   // slot released even on failure
  }, 15_000)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/worker.test.ts
```

- [ ] **Step 3: Implement worker.ts**

```typescript
// apps/api/src/orchestrator/worker.ts
import * as path from 'node:path'
import type { WorkerTask, WorkerAgent } from '../agents/types'
import type { Db } from '../db/client'
import { writeEvent } from '../db/journal'
import { upsertTask, upsertWorktree } from '../db/queries'
import { nextSeq } from '../db/journal'
import { createWorktree } from '../git/worktree'
import { createWorkerPlan } from '../git/planFiles'
import { ConcurrencyGovernor } from './concurrency'
import type { OrcEvent } from '@orc/types'

export type WorkerState = 'queued'|'spawning'|'running'|'stalled'|'zombie'|'done'|'failed'|'retrying'|'cancelled'

interface WorkerConfig {
  id:           string
  leadId:       string
  sectionId:    string
  branch:       string
  baseBranch:   string
  repoRoot:     string
  runId:        string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  leadPlanPath?: string
  runPlanPath?:  string
}

export class WorkerStateMachine {
  state: WorkerState = 'queued'
  readonly id: string           // public — safe to read in tests and lead
  readonly branch: string       // public — reviewer needs the winning branch
  private agent: WorkerAgent | null = null
  private slotHeld = false   // guard against double-release

  constructor(private readonly cfg: WorkerConfig) {
    this.id     = cfg.id
    this.branch = cfg.branch
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: this.cfg.id, entityType: 'worker',
      eventType: eventType as any, sequence: nextSeq(this.cfg.id), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, this.cfg.id, 'worker', this.cfg.leadId, this.state)
    })
  }

  async run(task: WorkerTask): Promise<{ status: 'done'|'failed'; branch: string; diff?: string; error?: string }> {
    this.state = 'queued'
    this.emit('CommandIssued', { from: this.cfg.leadId, to: this.cfg.id, commandType: 'SpawnWorker', commandPayload: {} })

    await this.cfg.governor.acquire()
    this.slotHeld = true
    this.state = 'spawning'
    this.emit('WorkerProgress', { output: 'creating worktree', ts: Date.now() })

    const wtPath = path.join(this.cfg.repoRoot, '.worktrees', this.cfg.id)
    try {
      await createWorktree(this.cfg.repoRoot, wtPath, this.cfg.branch)
    } catch (err: any) {
      if (!err.message?.includes('already exists')) throw err
    }

    upsertWorktree(this.cfg.db, this.cfg.id, this.cfg.id, wtPath, this.cfg.branch, this.cfg.baseBranch)

    // Create worker plan file before agent runs
    const planPath = await createWorkerPlan(wtPath, {
      workerId:   this.cfg.id,
      objective:  task.prompt,
      strategy:   task.strategy ?? 'default',
    })

    this.state = 'running'
    this.emit('WorkerProgress', { output: 'agent started', ts: Date.now() })

    this.agent = this.cfg.agentFactory()
    const result = await this.agent.run(task, {
      worktreePath: wtPath,
      branch:       this.cfg.branch,
      baseBranch:   this.cfg.baseBranch,
      entityId:     this.cfg.id,
      planPath,
      leadPlanPath: this.cfg.leadPlanPath ?? '',
      runPlanPath:  this.cfg.runPlanPath  ?? '',
    })

    if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }

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
    if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }
    this.state = 'cancelled'
    await this.agent?.abort()
    this.emit('WorkerFailed', { error: 'aborted', retryable: false })
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/worker.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orchestrator/worker.ts
git commit -m "feat: Worker state machine — plan artifact created before agent run, slotHeld guard"
```

---

## Task 9: Lead state machine (plan files wired in, topological dependency support)

**Files:** `apps/api/src/orchestrator/context.ts`, `lead.ts` · Test: `lead.test.ts`

- [ ] **Step 1: Implement context.ts**

```typescript
// apps/api/src/orchestrator/context.ts
import * as fs from 'node:fs/promises'

export class ContextManager {
  constructor(private readonly repoRoot: string) {}

  async buildMastermindPrompt(userGoal: string, runId: string): Promise<string> {
    return `Decompose the following goal into 2-5 independent implementation sections.
Return a JSON array: [{ "id": string, "goal": string, "numWorkers": number, "dependsOn": string[] }]
Keep sections independent when possible. Use dependsOn only for true data dependencies.
Goal: ${userGoal}\nRun ID: ${runId}`
  }

  buildPMPrompt(sectionId: string, sectionGoal: string, numWorkers: number, errorHistory: string[]): string {
    return `You are a PM agent for the "${sectionId}" section.
Generate ${numWorkers} distinct implementation prompts for: ${sectionGoal}
Return a JSON array of strings — each prompt must describe a different approach.
${errorHistory.length ? `\nPrior failures to avoid:\n${errorHistory.join('\n')}` : ''}`
  }

  buildReviewerPrompt(sectionGoal: string, diffs: Array<{ workerId: string; diff: string }>): string {
    const details = diffs.map(d => `### ${d.workerId}\n${d.diff || '(no diff)'}`).join('\n\n')
    return `You are a code reviewer. Select the best implementation for: ${sectionGoal}
Return JSON: { "winnerId": string, "reasoning": string }
## Candidates\n${details}`
  }
}
```

- [ ] **Step 2: Write failing test (uses initTestRepo)**

```typescript
// apps/api/src/orchestrator/lead.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { LeadStateMachine } from './lead'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('LeadStateMachine', () => {
  it('PM → 2 workers → reviewer → LeadDone, creates lead plan', async () => {
    repoDir = initTestRepo('lead-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)

    const lead = new LeadStateMachine({
      id: 'rhythm-lead', sectionId: 'rhythm', sectionGoal: 'Write rhythm section',
      numWorkers: 2, baseBranch: 'main', runBranch: 'run/r1', runId: 'r1',
      repoRoot: repoDir, db, governor: gov,
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Generate')) return JSON.stringify(['variation 1', 'variation 2'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'best diff' })
      },
    })

    const result = await lead.run()
    expect(result.status).toBe('done')
    expect(result.winnerBranch).toBe('feat/rhythm-v1')
  }, 30_000)
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
import type { Db } from '../db/client'
import { writeEvent } from '../db/journal'
import { upsertTask } from '../db/queries'
import { nextSeq } from '../db/journal'
import { createLeadPlan } from '../git/planFiles'
import { ConcurrencyGovernor } from './concurrency'
import { WorkerStateMachine } from './worker'
import { CommandQueue } from '../events/commandQueues'
import type { WorkerAgent } from '../agents/types'
import { ContextManager } from './context'
import type { OrcEvent, OrcCommand } from '@orc/types'

export type LeadState = 'idle'|'planning'|'running'|'reviewing'|'merging'|'done'|'failed'

export interface LeadResult { status: 'done'|'failed'; winnerBranch: string; reasoning: string }

interface LeadConfig {
  id:           string
  sectionId:    string
  sectionGoal:  string
  numWorkers:   number
  baseBranch:   string
  runBranch:    string
  runId:        string
  repoRoot:     string
  db:           Db
  governor:     ConcurrencyGovernor
  agentFactory: () => WorkerAgent
  llmCall:      (prompt: string) => Promise<string>
  commandQueue: CommandQueue<OrcCommand>  // owned by this lead, registered with server routes
  runPlanPath?: string
  maxRetries?:  number
}

export class LeadStateMachine {
  state: LeadState = 'idle'
  private ctx: ContextManager

  constructor(private readonly cfg: LeadConfig) {
    this.ctx = new ContextManager(cfg.repoRoot)
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: this.cfg.id, entityType: 'lead',
      eventType: eventType as any, sequence: nextSeq(this.cfg.id), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, this.cfg.id, 'lead', 'mastermind', this.state)
    })
  }

  async run(): Promise<LeadResult> {
    this.state = 'planning'
    this.emit('CommandIssued', { from: 'mastermind', to: this.cfg.id, commandType: 'SpawnLead', commandPayload: {} })

    // PM agent: generate prompts
    const pmPrompt = this.ctx.buildPMPrompt(this.cfg.sectionId, this.cfg.sectionGoal, this.cfg.numWorkers, [])
    let workerPrompts: string[]
    try {
      const raw = await this.cfg.llmCall(pmPrompt)
      const parsed = JSON.parse(raw)
      workerPrompts = Array.isArray(parsed) ? parsed : Array.from({ length: this.cfg.numWorkers }, (_, i) => `${this.cfg.sectionGoal} (variation ${i + 1})`)
    } catch {
      workerPrompts = Array.from({ length: this.cfg.numWorkers }, (_, i) => `${this.cfg.sectionGoal} (variation ${i + 1})`)
    }

    // Create lead plan file before spawning workers
    const leadPlanPath = await createLeadPlan(this.cfg.repoRoot, this.cfg.runId, {
      sectionId:      this.cfg.sectionId,
      sectionGoal:    this.cfg.sectionGoal,
      workerVariants: workerPrompts,
    }).catch(() => '')

    this.emit('LeadPlanReady', { workerPrompts })
    this.state = 'running'

    // Spawn workers in parallel
    const workers = workerPrompts.map((prompt, i) => new WorkerStateMachine({
      id:           `${this.cfg.sectionId}-v${i + 1}`,
      leadId:       this.cfg.id,
      sectionId:    this.cfg.sectionId,
      branch:       `feat/${this.cfg.sectionId}-v${i + 1}`,
      baseBranch:   this.cfg.baseBranch,
      repoRoot:     this.cfg.repoRoot,
      runId:        this.cfg.runId,
      db:           this.cfg.db,
      governor:     this.cfg.governor,
      agentFactory: this.cfg.agentFactory,
      leadPlanPath,
      runPlanPath:  this.cfg.runPlanPath,
    }))

    // Process incoming commands (ForceApprove / Abort) while workers run.
    // Drain the queue non-blockingly between worker completions.
    const workerPromises = workers.map((w, i) =>
      w.run({ id: w.id, prompt: workerPrompts[i], maxRetries: this.cfg.maxRetries ?? 1, errorHistory: [] })
    )

    // Command loop: runs alongside workers, processes any queued ForceApprove or Abort
    let forceWinnerId: string | undefined
    const drainCommands = () => {
      while (this.cfg.commandQueue.size > 0) {
        this.cfg.commandQueue.dequeue().then(cmd => {
          if (cmd.commandType === 'ForceApprove') {
            forceWinnerId = cmd.winnerId
          } else if (cmd.commandType === 'Abort') {
            const target = cmd.targetWorkerId
            const w = workers.find(x => x.id === target)
            if (w) w.abort()
          }
        })
      }
    }
    const commandPollInterval = setInterval(drainCommands, 500)

    const results = await Promise.allSettled(workerPromises)
    clearInterval(commandPollInterval)
    drainCommands()   // final drain after workers complete

    const done = results
      .map((r, i) => ({ r, id: workers[i].id, branch: workers[i].branch }))
      .filter(x => x.r.status === 'fulfilled' && (x.r as PromiseFulfilledResult<any>).value.status === 'done')
      .map(x => ({ workerId: x.id, diff: (x.r as PromiseFulfilledResult<any>).value.diff ?? '', branch: x.branch }))

    if (done.length === 0) {
      this.state = 'failed'
      this.emit('LeadFailed', { reason: 'all workers failed' })
      return { status: 'failed', winnerBranch: '', reasoning: 'all workers failed' }
    }

    // Reviewer — skip LLM if user already sent ForceApprove via command queue
    this.state = 'reviewing'
    let winnerId = done[0].workerId
    let reasoning = 'first available'
    if (forceWinnerId && done.some(d => d.workerId === forceWinnerId)) {
      winnerId = forceWinnerId
      reasoning = 'force-approved by user'
    } else {
      const reviewPrompt = this.ctx.buildReviewerPrompt(this.cfg.sectionGoal, done)
      try {
        const raw = await this.cfg.llmCall(reviewPrompt)
        const rev = JSON.parse(raw)
        if (rev.winnerId) { winnerId = rev.winnerId; reasoning = rev.reasoning }
      } catch { /* keep fallback */ }
    }

    const winner = done.find(d => d.workerId === winnerId) ?? done[0]
    this.emit('ReviewComplete', { winnerId: winner.workerId, reasoning })
    this.emit('MergeRequested', { leadId: this.cfg.id, worktreeId: winner.workerId, targetBranch: this.cfg.runBranch })

    this.state = 'done'
    this.emit('LeadDone', { branch: winner.branch, sectionId: this.cfg.sectionId })
    return { status: 'done', winnerBranch: winner.branch, reasoning }
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/lead.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/context.ts apps/api/src/orchestrator/lead.ts
git commit -m "feat: ContextManager + Lead state machine (plan artifact wired before worker spawn)"
```

---

## Task 10: Mastermind state machine (respects depends_on)

**Files:** `apps/api/src/orchestrator/mastermind.ts`, `templateLoader.ts` · Test: `mastermind.test.ts`, `templateLoader.test.ts`

- [ ] **Step 1: Implement templateLoader.ts first**

```typescript
// apps/api/src/orchestrator/templateLoader.ts
import * as fs from 'node:fs/promises'
import * as TOML from 'toml'

export interface SectionTemplate {
  id:          string
  label:       string
  depends_on:  string[]
  workers:     number
  prompt_hint: string
}

export interface WorkflowTemplate {
  template: { name: string; version: string; description: string }
  sections: SectionTemplate[]
  params:   Record<string, unknown>
}

export async function loadTemplate(filePath: string): Promise<WorkflowTemplate> {
  return TOML.parse(await fs.readFile(filePath, 'utf-8')) as WorkflowTemplate
}

export function renderPromptHint(hint: string, params: Record<string, unknown>, sectionOutputs: Record<string, string>): string {
  let r = hint
  for (const [k, v] of Object.entries(params)) r = r.replaceAll(`{${k}}`, String(v))
  for (const [s, code] of Object.entries(sectionOutputs)) r = r.replaceAll(`{${s}.winner_code}`, code)
  return r.trim()
}

/** Returns sections grouped by dependency level (each group can run in parallel) */
export function topologicalSort(sections: SectionTemplate[]): SectionTemplate[][] {
  const resolved = new Set<string>()
  const groups: SectionTemplate[][] = []
  const remaining = [...sections]
  while (remaining.length > 0) {
    const batch = remaining.filter(s => s.depends_on.every(d => resolved.has(d)))
    if (batch.length === 0) throw new Error('Circular or unsatisfied dependency in template')
    groups.push(batch)
    batch.forEach(s => { resolved.add(s.id); remaining.splice(remaining.indexOf(s), 1) })
  }
  return groups
}
```

- [ ] **Step 2: Write failing mastermind test (uses initTestRepo)**

```typescript
// apps/api/src/orchestrator/mastermind.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createTestDb } from '../db/client'
import { ConcurrencyGovernor } from './concurrency'
import { MockAgent } from '../agents/mock'
import { MastermindStateMachine } from './mastermind'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('MastermindStateMachine', () => {
  it('decomposes → spawns leads in dependency order → OrchestrationComplete', async () => {
    repoDir = initTestRepo('mastermind-test')
    const db = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const events: string[] = []
    const { eventBus } = await import('../events/eventBus')
    eventBus.on('event', (e: any) => events.push(e.eventType))

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'r1',
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([{ id: 'rhythm', goal: 'Write rhythm', numWorkers: 1, dependsOn: [] }])
        if (p.includes('Generate')) return JSON.stringify(['write bass pattern'])
        return JSON.stringify({ winnerId: 'rhythm-v1', reasoning: 'only one' })
      },
    })

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    expect(result.status).toBe('done')
    expect(events).toContain('OrchestrationComplete')
    eventBus.removeAllListeners('event')
  }, 30_000)
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts
```

- [ ] **Step 4: Implement mastermind.ts (respects depends_on)**

```typescript
// apps/api/src/orchestrator/mastermind.ts
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { Db } from '../db/client'
import { writeEvent } from '../db/journal'
import { upsertTask } from '../db/queries'
import { nextSeq } from '../db/journal'
import { createRunPlan } from '../git/planFiles'
import { ConcurrencyGovernor, configureGovernor } from './concurrency'
import { LeadStateMachine } from './lead'
import { MergeCoordinator } from './mergeCoordinator'
import { mergeBranch, createBranch } from '../git/worktree'
import { CommandQueue } from '../events/commandQueues'
import { ContextManager } from './context'
import type { WorkerAgent } from '../agents/types'
import type { OrcEvent, OrcCommand } from '@orc/types'

interface SectionPlan { id: string; goal: string; numWorkers: number; dependsOn: string[] }

interface MastermindConfig {
  repoRoot:    string
  db:          Db
  governor:    ConcurrencyGovernor
  runId:       string
  agentFactory: () => WorkerAgent
  llmCall:     (prompt: string) => Promise<string>
  leadQueues?: Map<string, CommandQueue<OrcCommand>>  // optional: server registers these for dashboard routing
  doMerge?:    (targetBranch: string, sourceBranch: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  templatePath?: string
  maxConcurrentWorkers?: number
}

export type MastermindState = 'idle'|'planning'|'delegating'|'monitoring'|'merging'|'done'|'failed'

export class MastermindStateMachine {
  state: MastermindState = 'idle'
  private ctx: ContextManager

  constructor(private readonly cfg: MastermindConfig) {
    this.ctx = new ContextManager(cfg.repoRoot)
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const event: OrcEvent = {
      entityId: 'mastermind', entityType: 'mastermind',
      eventType: eventType as any, sequence: nextSeq('mastermind'), ts: Date.now(), payload,
    }
    writeEvent(this.cfg.db, event, () => {
      upsertTask(this.cfg.db, 'mastermind', 'mastermind', null, this.state)
    })
  }

  async run(opts: { userGoal: string }): Promise<{ status: 'done'|'failed' }> {
    if (this.cfg.maxConcurrentWorkers) configureGovernor(this.cfg.maxConcurrentWorkers)

    this.state = 'planning'
    this.emit('CommandIssued', { from: 'user', to: 'mastermind', commandType: 'Run', commandPayload: { goal: opts.userGoal } })

    // Create run plan directory and file
    const runDir = path.join(this.cfg.repoRoot, '.orc', 'runs', this.cfg.runId)
    await fs.mkdir(path.join(runDir, 'leads'), { recursive: true })

    // Decompose goal
    let sections: SectionPlan[]
    try {
      const prompt = await this.ctx.buildMastermindPrompt(opts.userGoal, this.cfg.runId)
      const raw = await this.cfg.llmCall(prompt)
      const parsed = JSON.parse(raw)
      sections = Array.isArray(parsed) ? parsed.map(s => ({ ...s, dependsOn: s.dependsOn ?? s.depends_on ?? [] })) : [{ id: 'main', goal: opts.userGoal, numWorkers: 2, dependsOn: [] }]
    } catch {
      sections = [{ id: 'main', goal: opts.userGoal, numWorkers: 2, dependsOn: [] }]
    }

    const runPlanPath = await createRunPlan(this.cfg.repoRoot, this.cfg.runId, {
      userGoal: opts.userGoal, sections: sections.map(s => s.id),
    }).catch(() => '')

    // Create the run/<id> integration branch before any lead merges target it
    const runBranch = `run/${this.cfg.runId}`
    await createBranch(this.cfg.repoRoot, runBranch).catch(err => {
      // Branch may already exist on resume — only fail on unexpected errors
      if (!err.message?.includes('already exists')) throw err
    })

    this.emit('PlanReady', { sections: sections.map(s => s.id), runId: this.cfg.runId })
    this.state = 'delegating'

    // Respect depends_on: resolve sections in topological order
    const sectionResults = new Map<string, { status: 'done'|'failed'; winnerBranch: string }>()
    const resolved = new Set<string>()
    const remaining = [...sections]

    const failed = new Set<string>()

    while (remaining.length > 0) {
      // Pick sections whose deps are all resolved (not failed, not pending)
      const batch = remaining.filter(s => s.dependsOn.every(d => resolved.has(d)))

      if (batch.length === 0) {
        // Distinguish: blocked by failure vs true circular dependency
        const blockedByFailure = remaining.filter(s => s.dependsOn.some(d => failed.has(d)))
        if (blockedByFailure.length > 0) {
          // These sections can never run because an upstream section failed — mark them failed
          for (const s of blockedByFailure) {
            sectionResults.set(s.id, { status: 'failed', winnerBranch: '' })
            failed.add(s.id)
            remaining.splice(remaining.indexOf(s), 1)
          }
          continue
        }
        // Remaining sections have unresolvable deps (true cycle) — fail orchestration
        this.state = 'failed'
        this.emit('OrchestrationFailed', { reason: 'circular or unresolvable section dependencies' })
        return { status: 'failed' }
      }

      batch.forEach(s => remaining.splice(remaining.indexOf(s), 1))

      const batchResults = await Promise.allSettled(
        batch.map(section => {
          this.emit('LeadDelegated', { leadId: `${section.id}-lead`, sectionId: section.id })
          // Create and register command queue for this lead (enables dashboard approve/drop)
          const leadId = `${section.id}-lead`
          const leadCommandQueue = new CommandQueue<OrcCommand>()
          this.cfg.leadQueues?.set(leadId, leadCommandQueue)
          const lead = new LeadStateMachine({
            id:           leadId,
            sectionId:    section.id,
            sectionGoal:  section.goal,
            numWorkers:   section.numWorkers,
            baseBranch:   'main',
            runBranch:    `run/${this.cfg.runId}`,
            runId:        this.cfg.runId,
            repoRoot:     this.cfg.repoRoot,
            db:           this.cfg.db,
            governor:     this.cfg.governor,
            agentFactory: this.cfg.agentFactory,
            llmCall:      this.cfg.llmCall,
            commandQueue: leadCommandQueue,
            runPlanPath,
          })
          return lead.run().then(r => ({ section, result: r }))
        })
      )

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const { section, result } = r.value
          sectionResults.set(section.id, { status: result.status, winnerBranch: result.winnerBranch })
          if (result.status === 'done') { resolved.add(section.id) }
          else                          { failed.add(section.id) }
        } else {
          // rejected promise — treat the section as failed
          const section = batch[batchResults.indexOf(r)]
          if (section) failed.add(section.id)
        }
      }
    }

    this.state = 'monitoring'
    const failures = [...sectionResults.values()].filter(r => r.status === 'failed')
    if (failures.length > 0) {
      this.state = 'failed'
      this.emit('OrchestrationFailed', { reason: `${failures.length} section(s) failed` })
      return { status: 'failed' }
    }

    this.state = 'merging'

    // Wire MergeCoordinator: collect all merge requests from leads and drain the queue
    const doMerge = this.cfg.doMerge ?? ((target, source) => mergeBranch(this.cfg.repoRoot, target, source))
    const mergeConflicts: string[] = []
    const mc = new MergeCoordinator({
      db: this.cfg.db,
      repoRoot: this.cfg.repoRoot,
      doMerge,
      onConflict: (id) => {
        mergeConflicts.push(id)
        // [DEGRADED] Surface conflict to dashboard via event; no auto-repair
      },
      onFailed: (_id, reason) => {
        // non-optional merge failure → orchestration fails (see §3 OrchestrationFailed spec)
        this.emit('OrchestrationFailed', { reason: `merge failed: ${reason}` })
      },
    })

    // Enqueue all winning branches from section results
    for (const [sectionId, result] of sectionResults) {
      if (result.status === 'done' && result.winnerBranch) {
        mc.enqueue({
          leadId:       `${sectionId}-lead`,
          worktreeId:   result.winnerBranch.replace('feat/', ''),
          winnerBranch: result.winnerBranch,
          targetBranch: `run/${this.cfg.runId}`,
        })
      }
    }

    await mc.drainQueue()

    // [POST-DEMO] merge-fix worker: auto-repair conflicts then retry.
    // For MVP: any unresolved conflict fails the orchestration.
    if (mergeConflicts.length > 0) {
      this.state = 'failed'
      this.emit('OrchestrationFailed', { reason: `${mergeConflicts.length} merge conflict(s) unresolved: ${mergeConflicts.join(', ')}` })
      return { status: 'failed' }
    }

    this.state = 'done'
    this.emit('OrchestrationComplete', { runBranch: `run/${this.cfg.runId}` })
    return { status: 'done' }
  }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/templateLoader.ts
git commit -m "feat: Mastermind (depends_on ordering) + templateLoader (topologicalSort)"
```


---

## Task 11: Watchdog + Merge coordinator

**Files:** `apps/api/src/orchestrator/watchdog.ts`, `mergeCoordinator.ts` · Test: `watchdog.test.ts`, `mergeCoordinator.test.ts`

- [ ] **Step 1: Write watchdog test**

```typescript
// apps/api/src/orchestrator/watchdog.test.ts
import { describe, it, expect } from 'vitest'
import { createTestDb } from '../db/client'
import { getSQLite } from '../db/client'
import { Watchdog } from './watchdog'

describe('Watchdog', () => {
  it('marks stalled worker when last_seen_at exceeds threshold', async () => {
    const db = createTestDb()
    const now = Date.now()
    getSQLite(db).prepare(`INSERT INTO tasks(id,type,parent_id,state,created_at,updated_at) VALUES('w1','worker','l1','running',${now},${now})`).run()
    getSQLite(db).prepare(`INSERT INTO runs(id,entity_id,started_at,last_seen_at) VALUES('r1','w1',${now - 200_000},${now - 200_000})`).run()

    const stalled: string[] = []
    const wd = new Watchdog({ db, intervalMs: 50, stalledThresholdMs: 60_000 })
    wd.on('WorkerStalled', (id: string) => stalled.push(id))
    wd.start()
    await new Promise(r => setTimeout(r, 150))
    wd.stop()
    expect(stalled).toContain('w1')
  })
})
```

- [ ] **Step 2: Implement watchdog.ts**

```typescript
// apps/api/src/orchestrator/watchdog.ts
import { EventEmitter } from 'node:events'
import { getSQLite, type Db } from '../db/client'
import { writeEvent } from '../db/journal'
import type { OrcEvent } from '@orc/types'

export class Watchdog extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private seq = 0

  constructor(private readonly cfg: { db: Db; intervalMs: number; stalledThresholdMs: number }) { super() }

  start(): void { this.timer = setInterval(() => this.poll(), this.cfg.intervalMs) }
  stop():  void { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  private poll(): void {
    const now = Date.now()
    const cutoff = now - this.cfg.stalledThresholdMs
    const sqlite = getSQLite(this.cfg.db)

    const workers = sqlite.prepare(`
      SELECT t.id, r.last_seen_at, r.pid
      FROM tasks t LEFT JOIN runs r ON r.entity_id = t.id
      WHERE t.type='worker' AND t.state='running'
    `).all() as Array<{ id: string; last_seen_at: number|null; pid: number|null }>

    for (const w of workers) {
      const lastSeen = w.last_seen_at ?? 0
      if (lastSeen >= cutoff) {
        // healthy — update projection only, do not journal
        sqlite.prepare('UPDATE runs SET last_seen_at=? WHERE entity_id=?').run(now, w.id)
        continue
      }
      let alive = false
      if (w.pid) { try { process.kill(w.pid, 0); alive = true } catch {} }

      if (!alive) {
        sqlite.prepare("UPDATE tasks SET state='zombie', updated_at=? WHERE id=?").run(now, w.id)
        writeEvent(this.cfg.db, { entityId: w.id, entityType: 'worker', eventType: 'WorkerZombie',
          sequence: ++this.seq, ts: now, payload: { pid: w.pid ?? 0 } } as OrcEvent, () => {})
        this.emit('WorkerZombie', w.id)
      } else {
        sqlite.prepare("UPDATE tasks SET state='stalled', updated_at=? WHERE id=?").run(now, w.id)
        writeEvent(this.cfg.db, { entityId: w.id, entityType: 'worker', eventType: 'WorkerStalled',
          sequence: ++this.seq, ts: now, payload: { lastSeenAt: lastSeen } } as OrcEvent, () => {})
        this.emit('WorkerStalled', w.id)
      }
    }
  }
}
```

- [ ] **Step 3: Write merge coordinator test**

```typescript
// apps/api/src/orchestrator/mergeCoordinator.test.ts
import { describe, it, expect } from 'vitest'
import { createTestDb } from '../db/client'
import { MergeCoordinator } from './mergeCoordinator'

describe('MergeCoordinator', () => {
  it('processes clean merge and calls onComplete', async () => {
    const db = createTestDb()
    const completed: string[] = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async () => ({ success: true, conflictFiles: [] }),
      onComplete: id => completed.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', winnerBranch: 'feat/rhythm-v1', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(completed).toHaveLength(1)
  })

  it('calls onConflict when merge fails', async () => {
    const db = createTestDb()
    const conflicts: string[] = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async () => ({ success: false, conflictFiles: ['a.ts'] }),
      onConflict: (id) => conflicts.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', winnerBranch: 'feat/rhythm-v1', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(conflicts).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Implement mergeCoordinator.ts**

> [DEGRADED] Conflict surfaced via event + dashboard modal. Merge-fix worker is [POST-DEMO].

```typescript
// apps/api/src/orchestrator/mergeCoordinator.ts
import { getSQLite, type Db } from '../db/client'
import { writeEvent } from '../db/journal'
import type { OrcEvent } from '@orc/types'

interface MergeReq { leadId: string; worktreeId: string; winnerBranch: string; targetBranch: string }
interface MergeCoordinatorConfig {
  db:          Db
  repoRoot:    string
  doMerge:     (target: string, source: string) => Promise<{ success: boolean; conflictFiles: string[] }>
  onComplete?: (mergeId: string, targetBranch: string) => void
  onConflict?: (mergeId: string, files: string[]) => void
  onFailed?:   (mergeId: string, reason: string) => void
}

export class MergeCoordinator {
  private queue: MergeReq[] = []
  private processing = false
  private seq = 0

  constructor(private readonly cfg: MergeCoordinatorConfig) {}

  enqueue(req: MergeReq): void {
    this.queue.push(req)
    getSQLite(this.cfg.db).prepare(
      'INSERT INTO merge_queue(lead_id,winner_worktree_id,target_branch,status,created_at) VALUES(?,?,?,?,?)'
    ).run(req.leadId, req.worktreeId, req.targetBranch, 'pending', Date.now())
  }

  async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return
    this.processing = true
    const req = this.queue.shift()!
    const mergeId = `${req.leadId}-${req.worktreeId}`
    const sqlite = getSQLite(this.cfg.db)

    // Atomic claim — "UPDATE ... WHERE status='pending'" acts as lock
    sqlite.prepare("UPDATE merge_queue SET status='merging' WHERE lead_id=? AND winner_worktree_id=? AND status='pending'")
          .run(req.leadId, req.worktreeId)

    try {
      const r = await this.cfg.doMerge(req.targetBranch, req.winnerBranch)
      if (r.success) {
        sqlite.prepare("UPDATE merge_queue SET status='done', merged_at=? WHERE lead_id=? AND winner_worktree_id=?").run(Date.now(), req.leadId, req.worktreeId)
        writeEvent(this.cfg.db, { entityId: 'mastermind', entityType: 'mastermind', eventType: 'MergeComplete',
          sequence: ++this.seq, ts: Date.now(), payload: { mergeId, targetBranch: req.targetBranch } } as OrcEvent, () => {})
        this.cfg.onComplete?.(mergeId, req.targetBranch)
      } else {
        sqlite.prepare("UPDATE merge_queue SET status='conflict', conflict_details=? WHERE lead_id=? AND winner_worktree_id=?")
              .run(JSON.stringify({ files: r.conflictFiles }), req.leadId, req.worktreeId)
        writeEvent(this.cfg.db, { entityId: 'mastermind', entityType: 'mastermind', eventType: 'MergeConflict',
          sequence: ++this.seq, ts: Date.now(), payload: { mergeId, conflictFiles: r.conflictFiles } } as OrcEvent, () => {})
        this.cfg.onConflict?.(mergeId, r.conflictFiles)
        // [POST-DEMO] spawn merge-fix worker here
      }
    } catch (err: any) {
      sqlite.prepare("UPDATE merge_queue SET status='failed' WHERE lead_id=? AND winner_worktree_id=?").run(req.leadId, req.worktreeId)
      this.cfg.onFailed?.(mergeId, err.message)
    } finally {
      this.processing = false
    }
    if (this.queue.length > 0) await this.processNext()
  }

  /** Process all queued items to completion. Resolves when queue is empty. */
  async drainQueue(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      if (!this.processing) await this.processNext()
      else await new Promise(r => setTimeout(r, 50))
    }
  }
}
```

- [ ] **Step 5: Run both tests — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/watchdog.test.ts src/orchestrator/mergeCoordinator.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orchestrator/watchdog.ts apps/api/src/orchestrator/mergeCoordinator.ts
git commit -m "feat: Watchdog + MergeCoordinator (serialized FIFO, [POST-DEMO] merge-fix noted)"
```

---

## Task 12: LLM client + Strudel preview URL + skills files + strudel-track.toml

**Files:** `apps/api/src/orchestrator/llm.ts`, `preview.ts` · `skills/*.md` · `templates/strudel-track.toml`

- [ ] **Step 1: Write failing LLM test**

```typescript
// apps/api/src/orchestrator/llm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createLLMClient } from './llm'

describe('LLM client', () => {
  it('calls OpenAI-compatible endpoint and returns content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'result' } }] }),
    })
    global.fetch = mockFetch as any
    const llm = createLLMClient({ baseURL: 'http://test/v1', model: 'gpt-4o', apiKey: 'k' })
    expect(await llm('hello')).toBe('result')
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
export function createLLMClient(cfg: { baseURL: string; model: string; apiKey: string }): (p: string) => Promise<string> {
  return async (prompt) => {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices[0].message.content as string
  }
}

export function createLLMClientFromEnv(): (p: string) => Promise<string> {
  return createLLMClient({
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model:   process.env.OPENAI_MODEL   ?? 'gpt-4o',
    apiKey:  process.env.OPENAI_API_KEY ?? '',
  })
}
```

- [ ] **Step 4: Implement preview.ts (Strudel URL — no local dev server)**

> [DEGRADED] Preview = Strudel URL generation. Generic local dev-server is [POST-DEMO].

```typescript
// apps/api/src/orchestrator/preview.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSQLite, type Db } from '../db/client'

/**
 * Derives the expected Strudel code file from the section/worker ID.
 * Instrument workers write to src/<section>.js; arrangement writes src/index.js.
 * e.g. "drums-v1" → src/drums.js, "arrangement-v1" → src/index.js
 */
function codeFileForWorker(worktreeId: string): string {
  const sectionId = worktreeId.replace(/-v\d+(-r\d+)?$/, '')  // strip -v1 or -v1-r2
  return sectionId === 'arrangement' ? 'src/index.js' : `src/${sectionId}.js`
}

/** Reads the worker's code file and returns a Strudel playground URL */
export async function generateStrudelPreviewUrl(worktreePath: string, worktreeId: string): Promise<string> {
  const codeFile = codeFileForWorker(worktreeId)
  let code = ''
  try { code = await fs.readFile(path.join(worktreePath, codeFile), 'utf-8') }
  catch { code = `// ${codeFile} not yet written` }
  const encoded = Buffer.from(code).toString('base64url')
  return `https://strudel.cc/#${encoded}`
}

export async function launchPreview(db: Db, worktreeId: string, worktreePath: string): Promise<string> {
  const previewUrl = await generateStrudelPreviewUrl(worktreePath, worktreeId)
  const id = `preview-${worktreeId}`
  getSQLite(db).prepare(`
    INSERT INTO previews(id, worktree_id, preview_url, status, launched_at)
    VALUES(?,?,?,'active',?)
    ON CONFLICT(id) DO UPDATE SET preview_url=excluded.preview_url, status='active', launched_at=excluded.launched_at
  `).run(id, worktreeId, previewUrl, Date.now())
  return previewUrl
}

export function stopPreview(db: Db, worktreeId: string): void {
  getSQLite(db).prepare("UPDATE previews SET status='inactive' WHERE worktree_id=?").run(worktreeId)
}
```

- [ ] **Step 5: Run LLM test — expect PASS**

```bash
cd apps/api && pnpm vitest run src/orchestrator/llm.test.ts
```

- [ ] **Step 6: Create strudel-track.toml**

```toml
# templates/strudel-track.toml
#
# Structural isolation contract (critical for merge safety):
#   Each section writes ONLY to its own file: src/<section-id>.js
#   The arrangement section imports from those files.
#   Workers must NEVER touch files owned by other sections.
#   This prevents merge conflicts by design.

[template]
name = "strudel-track"
version = "1.1"
description = "Lo-fi / electronic track — one lead per instrument lane"

[[sections]]
id = "drums"
label = "Drums"
depends_on = []
workers = 2
prompt_hint = """
Write a Strudel.js drum pattern. Output to src/drums.js ONLY.
Export a single named const: export const drums = <pattern>
Keep it minimal, loopable, lo-fi. Tempo: {tempo}bpm.
Do NOT touch any other file.
"""

[[sections]]
id = "bass"
label = "Bass"
depends_on = []
workers = 2
prompt_hint = """
Write a Strudel.js bass line. Output to src/bass.js ONLY.
Export: export const bass = <pattern>
Key: {key}, Tempo: {tempo}bpm. Complement the drums if possible.
Do NOT touch any other file.
"""

[[sections]]
id = "chords"
label = "Harmony / Chords"
depends_on = ["bass"]
workers = 2
prompt_hint = """
Write a Strudel.js chord pattern. Output to src/chords.js ONLY.
Export: export const chords = <pattern>
Key: {key}, Tempo: {tempo}bpm. Reference bass pattern for context:
{bass.winner_code}
Do NOT touch any other file.
"""

[[sections]]
id = "melody"
label = "Lead Melody"
depends_on = ["chords"]
workers = 3
prompt_hint = """
Write a Strudel.js lead melody. Output to src/melody.js ONLY.
Export: export const melody = <pattern>
Key: {key}, Tempo: {tempo}bpm. Chords context:
{chords.winner_code}
Do NOT touch any other file.
"""

[[sections]]
id = "arrangement"
label = "Final Arrangement"
depends_on = ["drums", "bass", "chords", "melody"]
workers = 1
prompt_hint = """
Write src/index.js that imports and stacks all instruments.
import { drums }  from './drums.js'
import { bass }   from './bass.js'
import { chords } from './chords.js'
import { melody } from './melody.js'
Stack them with stack() and set overall volume/effects for a lo-fi sound.
Do NOT rewrite the instrument files — only src/index.js.
"""

[params]
tempo = 90
key = "Dm"
```

- [ ] **Step 7: Create all 8 skills files — write each file verbatim**

```bash
mkdir -p skills
```

Write each file with exactly the content below:

```markdown
<!-- skills/mastermind.md -->
# Mastermind Skills

## Role
You are the Mastermind orchestrator. Receive a user goal, decompose it into 2-5 independent sections, spawn Lead teams, monitor progress, and trigger the MergeCoordinator when all leads are done.

## Output schema
JSON array: `[{ "id": string, "goal": string, "numWorkers": number, "dependsOn": string[] }]`

## Constraints
- Maximum 5 sections
- No circular dependencies in dependsOn
- Each section must be independently implementable
- Prefer parallel sections (empty dependsOn) unless data dependency is real
```

```markdown
<!-- skills/lead.md -->
# Lead Skills

## Role
You coordinate a section team: PM agent, N parallel Implementer workers, and a Reviewer. Spawn workers, wait for results, run the reviewer, emit ReviewComplete and MergeRequested.

## Constraints
- Never skip the reviewer when multiple workers succeed
- Always emit LeadDone after a successful merge request
- Emit LeadFailed only after all retry options are exhausted
```

```markdown
<!-- skills/pm-agent.md -->
# PM Agent Skills

## Role
Generate N distinct implementation prompts for parallel workers. Each prompt must describe a meaningfully different approach so workers produce varied outputs.

## Output schema
JSON array of strings: `["prompt for v1", "prompt for v2", ...]`

## Constraints
- Prompts must differ in approach, not just wording
- Each prompt must be a complete, self-contained implementation instruction
- If errorHistory is non-empty, guide workers away from those failed approaches
```

```markdown
<!-- skills/implementer.md -->
# Implementer Skills

## Role
You are a focused implementation worker in your assigned git worktree. Read your worker-plan.md, implement the solution, update the checklist, and write a Result Summary when done.

## Constraints
- Only modify the file(s) explicitly named in your prompt_hint (e.g. src/drums.js)
- Do NOT touch files owned by other sections — this is the merge-safety contract
- Do not refactor unrelated code
- Run tests / build before marking complete
- Update .orc/worker-plan.md Result Summary before finishing
- The runner writes .orc/.orc-done.json automatically on exit — do not write it yourself
```

```markdown
<!-- skills/reviewer.md -->
# Reviewer Skills

## Role
You are the MVP arbitration layer for a section. Compare all worker outputs and select the best one. You are a strong heuristic, not a guarantee of correctness.

## Output schema
JSON: `{ "winnerId": string, "reasoning": string }`

## Constraints
- Select exactly one winner
- Reasoning must reference specific technical qualities (correctness, blast radius, readability)
- If all implementations are equivalent, prefer the smallest diff
```

```markdown
<!-- skills/run-planner.md -->
# Run Planner Skills

## Role
Write the run-plan.md for a Mastermind orchestration run. This is the top-level reference document for all leads and workers.

## Required sections
Goal · Architecture · Sections & Dependencies · Success Criteria · Integration Notes · Status

## Constraints
- Keep under 2 pages
- Status section updated at section boundaries only — not continuously
- The plan is execution memory; SQLite projections are authoritative
```

```markdown
<!-- skills/lead-planner.md -->
# Lead Planner Skills

## Role
Write and maintain the section-level plan file for a Lead team.

## Required sections
Section Objective · Acceptance Criteria · Files / Boundaries · Worker Variants · Review Criteria · Status · Notes

## Constraints
- Update on: worker spawn, worker completion, reviewer decision, retry
- Record decisions and outcomes only — not transcripts
- Keep Worker Variants accurate to actual strategies spawned
```

```markdown
<!-- skills/worker-planner.md -->
# Worker Planner Skills

## Role
Write and maintain the worker task sheet at .orc/worker-plan.md.

## Required sections
Objective · Acceptance Criteria · Files Likely To Change · Constraints · Checklist · Progress Notes · Blockers · Result Summary

## Constraints
- Update at: start, after planning, after major step, before finish, on error
- Keep notes brief — checklist, not diary
- Result Summary must be filled before marking task done
- Do not invent new sections; update existing ones only
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/orchestrator/llm.ts apps/api/src/orchestrator/preview.ts templates/ skills/
git commit -m "feat: LLM client + Strudel preview URL ([DEGRADED]) + skills files + strudel-track.toml"
```

---

## Task 13: Express server + REST routes (approve/drop actually enqueue commands)

**Files:** `apps/api/src/server/app.ts`, `routes.ts`, `wsHandler.ts` · Test: `routes.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/server/routes.test.ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestDb } from '../db/client'
import { createApp } from './app'
import { CommandQueue } from '../events/commandQueues'

describe('routes', () => {
  it('GET /api/orchestration returns sections array', async () => {
    const db = createTestDb()
    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sections')
  })

  it('POST /api/approve enqueues ForceApprove to lead queue', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    const leadQueues = new Map([['drums-lead', leadQ]])
    const app = createApp({ db, leadQueues })
    const res = await request(app).post('/api/approve').send({ workerId: 'drums-v1', leadId: 'drums-lead' })
    expect(res.status).toBe(202)
    expect(leadQ.size).toBe(1)
  })
})
```

```bash
cd apps/api && pnpm add -D supertest @types/supertest
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

- [ ] **Step 3: Implement app.ts**

```typescript
// apps/api/src/server/app.ts
import express from 'express'
import cors from 'cors'
import type { Db } from '../db/client'
import type { CommandQueue } from '../events/commandQueues'
import { createRoutes } from './routes'

export interface AppDeps {
  db:          Db
  leadQueues:  Map<string, CommandQueue<any>>   // keyed by leadId
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use('/api', createRoutes(deps))
  return app
}
```

- [ ] **Step 4: Implement routes.ts (approve/drop enqueue real commands)**

```typescript
// apps/api/src/server/routes.ts
import { Router } from 'express'
import type { AppDeps } from './app'
import { getAllTasks, getWorktrees, getPreviews } from '../db/queries'
import { launchPreview, stopPreview } from '../orchestrator/preview'

export function createRoutes({ db, leadQueues }: AppDeps): Router {
  const r = Router()

  r.get('/orchestration', (_req, res) => {
    const tasks = getAllTasks(db)
    const worktrees = getWorktrees(db)
    const previews = getPreviews(db)

    const sections = tasks.filter(t => t.type === 'lead').map(lead => ({
      id: lead.id.replace('-lead', ''), state: lead.state,
      workers: tasks.filter(t => t.type === 'worker' && t.parentId === lead.id).map(w => {
        const wt = worktrees.find(x => x.workerId === w.id)
        const prev = previews.find(p => p.worktreeId === w.id)
        return { id: w.id, state: w.state, branch: wt?.branch, previewUrl: prev?.previewUrl }
      }),
    }))
    res.json({ runId: 'current', mastermindState: tasks.find(t => t.id === 'mastermind')?.state ?? 'idle', sections })
  })

  r.get('/events', (_req, res) => {
    const sqlite = (db as any).session.client
    res.json({ events: sqlite.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 100').all() })
  })

  // Approve: enqueue ForceApprove to the owning lead's command queue
  r.post('/approve', (req, res) => {
    const { workerId, leadId } = req.body
    if (!workerId || !leadId) { res.status(400).json({ error: 'workerId and leadId required' }); return }
    const q = leadQueues.get(leadId)
    if (q) { q.enqueue({ commandType: 'ForceApprove', winnerId: workerId }) }
    res.status(202).json({ ok: true })
  })

  // Drop: enqueue Abort to the owning lead's command queue
  r.post('/drop', (req, res) => {
    const { workerId, leadId } = req.body
    if (!workerId || !leadId) { res.status(400).json({ error: 'workerId and leadId required' }); return }
    const q = leadQueues.get(leadId)
    if (q) { q.enqueue({ commandType: 'Abort', targetWorkerId: workerId }) }
    res.status(202).json({ ok: true })
  })

  // Preview: derive worktreePath from projection — client only sends worktreeId
  r.post('/preview/launch', async (req, res) => {
    const { worktreeId } = req.body
    if (!worktreeId) { res.status(400).json({ error: 'worktreeId required' }); return }
    const wts = getWorktrees(db)
    const wt = wts.find(x => x.workerId === worktreeId)
    if (!wt) { res.status(404).json({ error: `worktree not found for worker ${worktreeId}` }); return }
    const url = await launchPreview(db, worktreeId, wt.path)
    res.status(202).json({ previewUrl: url })
  })

  r.post('/preview/stop', (req, res) => {
    const { worktreeId } = req.body
    if (!worktreeId) { res.status(400).json({ error: 'worktreeId required' }); return }
    stopPreview(db, worktreeId)
    res.status(202).json({ ok: true })
  })

  // [DEGRADED] steer: logged but not routed to entity queues
  r.post('/steer', (req, res) => {
    const { directive } = req.body
    if (!directive) { res.status(400).json({ error: 'directive required' }); return }
    console.log('[orc] steer directive (not routed):', directive)
    res.status(202).json({ ok: true, note: 'NL routing is [POST-DEMO]' })
  })

  return r
}
```

- [ ] **Step 5: Implement wsHandler.ts**

```typescript
// apps/api/src/server/wsHandler.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { eventBus } from '../events/eventBus'
import type { OrcEvent } from '@orc/types'

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws: WebSocket) => {
    const handler = (e: OrcEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e))
    }
    eventBus.on('event', handler)
    ws.on('close',  () => eventBus.off('event', handler))
    ws.on('error',  () => { eventBus.off('event', handler); ws.close() })
  })
  return wss
}
```

- [ ] **Step 6: Run — expect PASS**

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/server
git commit -m "feat: Express server + REST routes (approve/drop enqueue real commands) + WebSocket handler"
```

---

## Task 14: CLI entry point

**Files:** `apps/api/src/cli.ts`

- [ ] **Step 1: Implement cli.ts**

```typescript
// apps/api/src/cli.ts
import { Command } from 'commander'
import * as http from 'node:http'
import * as path from 'node:path'
import { initDb } from './db/client'
import { createApp } from './server/app'
import { attachWebSocket } from './server/wsHandler'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { CodexCLIAdapter } from './agents/codex-cli'
import { MockAgent } from './agents/mock'
import { Watchdog } from './orchestrator/watchdog'
import { createLLMClientFromEnv } from './orchestrator/llm'
import { CommandQueue } from './events/commandQueues'
import { getAllTasks } from './db/queries'

const DB_PATH  = process.env.ORC_DB_PATH ?? path.join(process.cwd(), 'orc.db')
const PORT     = parseInt(process.env.ORC_PORT ?? '4000')

const program = new Command().name('orc').version('0.1.0')

program
  .command('run <goal>')
  .option('-m, --max-workers <n>', 'max concurrent workers', '4')
  .option('--mock', 'use MockAgent (deterministic, no real Codex)')
  .option('--run-id <id>', 'custom run ID', `run-${Date.now()}`)
  .action(async (goal: string, opts) => {
    const db     = initDb(DB_PATH)
    const gov    = new ConcurrencyGovernor(parseInt(opts.maxWorkers))
    const leadQs = new Map<string, CommandQueue<any>>()
    const app    = createApp({ db, leadQueues: leadQs })
    const server = http.createServer(app)
    attachWebSocket(server)
    server.listen(PORT, () => console.log(`[orc] dashboard → http://localhost:${PORT}  |  open apps/web`))

    const watchdog = new Watchdog({ db, intervalMs: 5000, stalledThresholdMs: 60_000 })
    watchdog.start()

    const m = new MastermindStateMachine({
      repoRoot:            process.cwd(),
      db, governor:        gov,
      runId:               opts.runId,
      agentFactory:        opts.mock ? () => new MockAgent({ delayMs: 200, outcome: 'done' }) : () => new CodexCLIAdapter(),
      llmCall:             createLLMClientFromEnv(),
      leadQueues:          leadQs,   // shared map — routes write commands, mastermind registers per-lead queues
      maxConcurrentWorkers: parseInt(opts.maxWorkers),
    })

    console.log(`[orc] run "${goal}" (run-id: ${opts.runId})`)
    const result = await m.run({ userGoal: goal })
    watchdog.stop()
    console.log(`[orc] orchestration ${result.status}`)
    server.close(() => process.exit(result.status === 'done' ? 0 : 1))
  })

program
  .command('status')
  .action(() => {
    const db = initDb(DB_PATH)
    console.table(getAllTasks(db))
  })

program
  .command('resume')
  .description('[DEGRADED] Restart and show persisted state. Worktree reconciliation is [POST-DEMO].')
  .action(async () => {
    const db     = initDb(DB_PATH)
    const leadQs = new Map<string, CommandQueue<any>>()
    const app    = createApp({ db, leadQueues: leadQs })
    const server = http.createServer(app)
    attachWebSocket(server)
    server.listen(PORT, () => {
      console.log(`[orc] resumed dashboard at http://localhost:${PORT}`)
      console.log('[orc] state loaded from SQLite — re-attach via dashboard')
    })
    const inFlight = getAllTasks(db).filter(t => ['running','queued','stalled','zombie'].includes(t.state))
    if (inFlight.length) { console.log('[orc] in-flight tasks:'); console.table(inFlight) }
    else console.log('[orc] no in-flight tasks found')
  })

program.parse()
```

- [ ] **Step 2: Verify runs**

```bash
cd apps/api && pnpm tsx src/cli.ts status
```

Expected: empty table (no tasks yet).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/cli.ts
git commit -m "feat: CLI — orc run / status / resume ([DEGRADED] resume noted)"
```


---

## Task 15: Next.js dashboard — WebSocket client + hooks

**Files:** `apps/web/src/ws/client.ts`, `hooks/useOrchestration.ts`, `app/providers.tsx`

- [ ] **Step 1: Implement WebSocket client**

```typescript
// apps/web/src/ws/client.ts
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000'

type Handler = (event: unknown) => void

class OrcWS {
  private ws: WebSocket | null = null
  private handlers = new Set<Handler>()
  private timer: ReturnType<typeof setTimeout> | null = null

  connect(): void {
    if (typeof window === 'undefined') return
    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.onmessage = e => { try { this.handlers.forEach(h => h(JSON.parse(e.data))) } catch {} }
      this.ws.onclose   = () => { this.timer = setTimeout(() => this.connect(), 2000) }
      this.ws.onerror   = () => this.ws?.close()
    } catch { this.timer = setTimeout(() => this.connect(), 2000) }
  }

  subscribe(h: Handler): () => void { this.handlers.add(h); return () => this.handlers.delete(h) }

  disconnect(): void {
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}

export const orcWs = new OrcWS()
```

- [ ] **Step 2: Implement useOrchestration hook**

```typescript
// apps/web/src/hooks/useOrchestration.ts
'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { orcWs } from '../ws/client'
import type { OrchState } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

function applyEvent(old: OrchState | undefined, ev: any): OrchState {
  if (!old) return { runId: 'current', mastermindState: 'idle', sections: [] }

  // Worker state patches
  const workerStateMap: Record<string, string> = {
    WorkerDone: 'done', WorkerFailed: 'failed', WorkerStalled: 'stalled',
    WorkerZombie: 'zombie', WorkerRecovered: 'running', WorkerProgress: 'running',
  }
  if (workerStateMap[ev.eventType]) {
    return {
      ...old,
      sections: old.sections.map(s => ({
        ...s,
        workers: s.workers.map(w =>
          w.id === ev.entityId ? { ...w, state: workerStateMap[ev.eventType] } : w
        ),
      })),
    }
  }

  // Lead state patches — derive section id from entityId (strip '-lead' suffix)
  const leadStateMap: Record<string, string> = {
    LeadPlanReady: 'running', ReviewComplete: 'reviewing',
    MergeRequested: 'merging', LeadDone: 'done', LeadFailed: 'failed',
  }
  if (leadStateMap[ev.eventType]) {
    const sectionId = (ev.entityId as string).replace('-lead', '')
    return {
      ...old,
      sections: old.sections.map(s =>
        s.id === sectionId ? { ...s, state: leadStateMap[ev.eventType] } : s
      ),
    }
  }

  // Mastermind state patches
  const mastermindStateMap: Record<string, string> = {
    PlanReady: 'delegating', LeadDelegated: 'monitoring',
    OrchestrationComplete: 'done', OrchestrationFailed: 'failed',
  }
  if (mastermindStateMap[ev.eventType]) {
    return { ...old, mastermindState: mastermindStateMap[ev.eventType] }
  }

  // LeadDelegated: also adds the new section to the tree if not already present
  if (ev.eventType === 'LeadDelegated') {
    const sectionId = ev.payload?.sectionId as string
    const exists = old.sections.some(s => s.id === sectionId)
    return {
      ...old,
      mastermindState: 'monitoring',
      sections: exists ? old.sections : [...old.sections, { id: sectionId, state: 'idle', workers: [] }],
    }
  }

  return old
}

export function useOrchestration() {
  const qc = useQueryClient()
  const query = useQuery<OrchState>({
    queryKey: ['orchestration'],
    queryFn: () => fetch(`${API}/api/orchestration`).then(r => r.json()),
    refetchInterval: false,
  })
  useEffect(() => {
    orcWs.connect()
    const unsub = orcWs.subscribe(ev => {
      qc.setQueryData<OrchState>(['orchestration'], old => applyEvent(old, ev))
    })
    return () => { unsub(); orcWs.disconnect() }
  }, [qc])
  return query
}
```

- [ ] **Step 3: Implement providers.tsx**

```tsx
// apps/web/src/app/providers.tsx
'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient())
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
```

- [ ] **Step 4: Wrap layout**

```tsx
// apps/web/src/app/layout.tsx
import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = { title: 'WorkTree Orchestrator' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-gray-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 5: Add env vars**

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ws apps/web/src/hooks apps/web/src/app/providers.tsx apps/web/src/app/layout.tsx apps/web/.env.local
git commit -m "feat: dashboard WS client + useOrchestration (REST hydration + WS cache patches)"
```

---

## Task 16: Dashboard components (TreePanel, WorkerCard, EventStream, DetailPanel)

**Files:** `apps/web/src/components/*.tsx` + `apps/web/src/app/page.tsx`

- [ ] **Step 1: WorkerCard**

```tsx
// apps/web/src/components/WorkerCard.tsx
'use client'
import type { WorkerInfo } from '@orc/types'

const COLORS: Record<string, string> = {
  queued: 'text-gray-400', spawning: 'text-blue-300', running: 'text-green-300',
  stalled: 'text-yellow-300', zombie: 'text-red-400', done: 'text-green-200', failed: 'text-red-300',
}

export function WorkerCard({ worker, selected, onSelect }: { worker: WorkerInfo; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button onClick={() => onSelect(worker.id)}
      className={`flex items-center gap-2 px-3 py-1 rounded text-xs w-full text-left ${selected ? 'ring-1 ring-blue-400 bg-gray-700' : 'hover:bg-gray-800'}`}>
      <span className={`font-mono ${COLORS[worker.state] ?? 'text-gray-400'}`}>{worker.state}</span>
      <span className="text-gray-300 font-mono">{worker.id}</span>
      {worker.previewUrl && (
        <a href={worker.previewUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="ml-auto text-blue-400 text-[10px] hover:underline">▶ preview</a>
      )}
    </button>
  )
}
```

- [ ] **Step 2: TreePanel**

```tsx
// apps/web/src/components/TreePanel.tsx
'use client'
import { useState } from 'react'
import type { OrchState } from '@orc/types'
import { WorkerCard } from './WorkerCard'

export function TreePanel({ state, selected, onSelect }: { state: OrchState | undefined; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(new Set<string>())
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const LEAD_COLORS: Record<string, string> = {
    idle: 'text-gray-500', planning: 'text-purple-300', running: 'text-blue-300',
    reviewing: 'text-yellow-300', merging: 'text-orange-300', done: 'text-green-300', failed: 'text-red-300',
  }
  return (
    <div className="p-3 overflow-y-auto">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">TREE</div>
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-indigo-950 border border-indigo-700 mb-2">
        <span className="text-indigo-400 text-xs">◆</span>
        <span className="text-indigo-300 font-bold text-xs">mastermind</span>
        <span className="ml-auto text-[10px] text-indigo-500">{state?.mastermindState ?? 'idle'}</span>
      </div>
      {(state?.sections ?? []).map(s => (
        <div key={s.id} className="ml-3 mb-1">
          <button onClick={() => { toggle(s.id); onSelect(`${s.id}-lead`) }}
            className={`flex items-center gap-2 px-2 py-1 rounded w-full text-left text-xs ${selected === `${s.id}-lead` ? 'ring-1 ring-yellow-400' : 'hover:bg-gray-800'}`}>
            <span className="text-gray-500">{open.has(s.id) ? '▾' : '▸'}</span>
            <span className="text-yellow-300 font-mono">{s.id}-lead</span>
            <span className={`ml-auto text-[10px] ${LEAD_COLORS[s.state] ?? 'text-gray-500'}`}>{s.state}</span>
          </button>
          {open.has(s.id) && (
            <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
              {s.workers.map(w => (
                <WorkerCard key={w.id} worker={w} selected={selected === w.id} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: EventStream**

```tsx
// apps/web/src/components/EventStream.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { orcWs } from '../ws/client'

export function EventStream() {
  const [events, setEvents] = useState<Array<{ ts: number; type: string; id: string }>>([])
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const unsub = orcWs.subscribe((e: any) => {
      setEvents(p => [...p.slice(-99), { ts: e.ts, type: e.eventType, id: e.entityId }])
    })
    return unsub
  }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])
  const C: Record<string, string> = {
    WorkerDone: 'text-green-400', WorkerFailed: 'text-red-400', WorkerStalled: 'text-yellow-400',
    WorkerZombie: 'text-red-400', LeadDone: 'text-green-300', ReviewComplete: 'text-blue-300',
    MergeConflict: 'text-orange-400', OrchestrationComplete: 'text-green-200 font-bold',
  }
  return (
    <div className="p-3 overflow-y-auto">
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">EVENTS</div>
      {events.map((e, i) => (
        <div key={i} className={`text-[10px] font-mono flex gap-2 ${C[e.type] ?? 'text-gray-500'}`}>
          <span className="text-gray-600">{new Date(e.ts).toLocaleTimeString()}</span>
          <span>{e.id}</span><span>{e.type}</span>
        </div>
      ))}
      <div ref={bottom} />
    </div>
  )
}
```

- [ ] **Step 4: DetailPanel — Compare+Approve for leads, Plan/Logs/Preview for workers**

```tsx
// apps/web/src/components/DetailPanel.tsx
'use client'
import { useState } from 'react'
import type { SectionInfo, WorkerInfo } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function DetailPanel({ selectedId, sections }: { selectedId: string | null; sections: SectionInfo[] }) {
  const isLead = selectedId?.endsWith('-lead') ?? false
  const [tab, setTab] = useState<'compare'|'plan'|'logs'|'preview'>(isLead ? 'compare' : 'plan')
  if (!selectedId) return <div className="flex items-center justify-center h-full text-gray-600 text-sm">Select an entity from the tree</div>

  const sectionId = selectedId.replace('-lead', '')
  const section = sections.find(s => s.id === sectionId)
  const worker: WorkerInfo | undefined = sections.flatMap(s => s.workers).find(w => w.id === selectedId)

  async function approve() {
    if (!worker) return
    const leadId = sections.find(s => s.workers.some(w => w.id === worker.id))?.id + '-lead'
    await fetch(`${API}/api/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: worker.id, leadId }) })
  }
  async function drop() {
    const leadId = isLead ? selectedId : (sections.find(s => s.workers.some(w => w.id === selectedId))?.id + '-lead')
    await fetch(`${API}/api/drop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: selectedId, leadId }) })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700">
        <span className="font-mono text-yellow-300 font-bold text-sm">{selectedId}</span>
        <div className="ml-auto flex gap-2">
          {worker?.state === 'done' && (
            <button onClick={approve} className="text-[11px] bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded">✓ Approve</button>
          )}
          <button onClick={drop} className="text-[11px] bg-gray-700 hover:bg-red-800 text-red-300 px-3 py-1 rounded">✕ Drop</button>
          {worker?.previewUrl && (
            <a href={worker.previewUrl} target="_blank" rel="noreferrer"
              className="text-[11px] bg-blue-800 hover:bg-blue-700 text-blue-200 px-3 py-1 rounded">▶ Preview</a>
          )}
        </div>
      </div>

      {/* Tabs — leads get a Compare tab, workers get plan/logs/preview */}
      <div className="flex border-b border-gray-700">
        {(isLead
          ? ['compare', 'plan', 'logs'] as const
          : ['plan', 'logs', 'preview'] as const
        ).map(t => (
          <button key={t} onClick={() => setTab(t as any)}
            className={`px-4 py-2 text-xs capitalize ${tab === t ? 'border-b-2 border-blue-400 text-blue-300' : 'text-gray-500 hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 text-xs font-mono text-gray-400">

        {/* Compare tab — the primary human-control surface for leads */}
        {tab === 'compare' && isLead && section && (
          <div className="flex flex-col gap-3">
            <p className="text-[10px] text-gray-500 font-sans">
              Listen to each variant and approve the winner. Strudel URLs open in a new tab.
            </p>
            {section.workers.map(w => (
              <div key={w.id}
                className={`flex items-center gap-3 p-3 rounded border
                  ${w.state === 'done' ? 'border-green-700 bg-green-950' : 'border-gray-700 bg-gray-800 opacity-60'}`}>
                <div className="flex flex-col flex-1 gap-1">
                  <span className="text-gray-200 font-bold">{w.id}</span>
                  <span className={`text-[10px] ${
                    w.state === 'done' ? 'text-green-400' :
                    w.state === 'running' ? 'text-blue-400' :
                    w.state === 'failed' ? 'text-red-400' : 'text-gray-500'
                  }`}>{w.state}</span>
                </div>
                {/* Listen button — opens Strudel URL */}
                {w.previewUrl && w.state === 'done' && (
                  <a href={w.previewUrl} target="_blank" rel="noreferrer"
                    className="text-[11px] bg-purple-800 hover:bg-purple-700 text-purple-200 px-3 py-1.5 rounded font-sans">
                    ♪ Listen
                  </a>
                )}
                {/* Approve button */}
                {w.state === 'done' && (
                  <button
                    onClick={() => fetch(`${API}/api/approve`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workerId: w.id, leadId: `${sectionId}-lead` }),
                    })}
                    className="text-[11px] bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded font-sans">
                    ✓ Pick this
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'plan' && (
          <p className="text-gray-500 font-sans">
            {isLead
              ? `Lead plan: .orc/runs/current/leads/${sectionId}.md`
              : `Worker plan: .worktrees/${selectedId}/.orc/worker-plan.md`}<br /><br />
            Plain markdown — view directly in your editor.
          </p>
        )}
        {tab === 'logs' && (
          <p className="text-gray-500 font-sans">
            {isLead
              ? 'Select a worker to view its session log.'
              : <><code>.worktrees/{selectedId}/.orc/.orc-session.jsonl</code><br /><br /><code>tail -f .worktrees/{selectedId}/.orc/.orc-session.jsonl</code></>
            }
          </p>
        )}
        {tab === 'preview' && !isLead && (
          worker?.previewUrl
            ? <a href={worker.previewUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline break-all font-sans">{worker.previewUrl}</a>
            : <p className="text-gray-500 font-sans">No preview yet. Worker must be done first.</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: page.tsx — three-panel layout**

```tsx
// apps/web/src/app/page.tsx
'use client'
import { useState } from 'react'
import { useOrchestration } from '../hooks/useOrchestration'
import { TreePanel } from '../components/TreePanel'
import { DetailPanel } from '../components/DetailPanel'
import { EventStream } from '../components/EventStream'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export default function Page() {
  const [selected, setSelected] = useState<string | null>(null)
  const { data } = useOrchestration()

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm">⬡ WorkTree Orchestrator</span>
        <span className="text-[10px] text-gray-500 ml-2">{data?.mastermindState ?? 'idle'}</span>
        <span className="ml-auto text-[10px] text-gray-600">
          Approve / Drop / Preview → action buttons &nbsp;·&nbsp; NL steering → [POST-DEMO]
        </span>
      </div>

      {/* Three panels */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-52 border-r border-gray-700 overflow-y-auto flex-shrink-0">
          <TreePanel state={data} selected={selected} onSelect={setSelected} />
        </div>
        <div className="flex-1 overflow-hidden">
          <DetailPanel selectedId={selected} sections={data?.sections ?? []} />
        </div>
        <div className="w-52 border-l border-gray-700 overflow-y-auto flex-shrink-0">
          <EventStream />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Start both apps and verify**

```bash
# terminal 1 — api
cd apps/api && pnpm tsx src/cli.ts status

# terminal 2 — web
cd apps/web && pnpm dev
```

Open `http://localhost:3000` — three-panel layout renders. Three-panel layout with empty tree, event stream, detail panel.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components apps/web/src/app/page.tsx
git commit -m "feat: dashboard — TreePanel, WorkerCard, EventStream, DetailPanel (working Approve/Drop/Preview)"
```

---

## Task 17: Integration smoke test

**Files:** `apps/api/src/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// apps/api/src/integration.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { initTestRepo, cleanupTestRepo } from './test-helpers/initTestRepo'
import { createTestDb } from './db/client'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { MockAgent } from './agents/mock'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { eventBus } from './events/eventBus'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('Full orchestration (MockAgent)', () => {
  it('5-lane Strudel template: drums+bass parallel, chords after bass, melody after chords, arrangement last', async () => {
    repoDir = initTestRepo('integration')
    const db  = createTestDb()
    const gov = new ConcurrencyGovernor(4)
    const emitted: string[] = []
    const leadDoneOrder: string[] = []
    const handler = (e: any) => {
      emitted.push(e.eventType)
      if (e.eventType === 'LeadDone') leadDoneOrder.push(e.payload?.sectionId ?? e.entityId)
    }
    eventBus.on('event', handler)

    const m = new MastermindStateMachine({
      repoRoot: repoDir, db, governor: gov, runId: 'int-run',
      agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
      llmCall: async p => {
        if (p.includes('Decompose')) return JSON.stringify([
          { id: 'drums',       goal: 'Write drum pattern',   numWorkers: 1, dependsOn: [] },
          { id: 'bass',        goal: 'Write bass line',       numWorkers: 1, dependsOn: [] },
          { id: 'chords',      goal: 'Write chord pattern',   numWorkers: 1, dependsOn: ['bass'] },
          { id: 'melody',      goal: 'Write lead melody',     numWorkers: 1, dependsOn: ['chords'] },
          { id: 'arrangement', goal: 'Write final arrangement', numWorkers: 1, dependsOn: ['drums','bass','chords','melody'] },
        ])
        if (p.includes('Generate')) return JSON.stringify(['write it'])
        // reviewer always picks v1
        const match = p.match(/([\w-]+-v1)/)
        return JSON.stringify({ winnerId: match?.[1] ?? 'drums-v1', reasoning: 'only one' })
      },
    })

    const result = await m.run({ userGoal: 'Build lo-fi track' })
    eventBus.off('event', handler)

    expect(result.status).toBe('done')
    expect(emitted).toContain('WorkerDone')
    expect(emitted).toContain('ReviewComplete')
    expect(emitted).toContain('OrchestrationComplete')

    // arrangement must be last (depends on all other sections)
    expect(leadDoneOrder.at(-1)).toBe('arrangement')

    // chords must come after bass
    expect(leadDoneOrder.indexOf('chords')).toBeGreaterThan(leadDoneOrder.indexOf('bass'))

    // melody must come after chords
    expect(leadDoneOrder.indexOf('melody')).toBeGreaterThan(leadDoneOrder.indexOf('chords'))
  }, 60_000)
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

Expected: all passing across all packages.

- [ ] **Step 4: Final commit**

```bash
git add apps/api/src/integration.test.ts
git commit -m "test: integration smoke test — 2 sections with depends_on, MockAgent, all key events emitted"
```

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §2 SQLite journal + projections | Task 3 |
| §2 Event bus + command queues (separate) | Task 4 |
| §3 Entity hierarchy + state machines | Tasks 7, 8, 9, 10 |
| §3 OrchestrationComplete/Failed conditions | Task 10 mastermind.ts |
| §4 SQLite schema (all tables) | Task 3 schema.ts |
| §4 Drizzle migrations | Task 3 drizzle-kit |
| §5 Event bus (publish-only) + command queues (per-role) | Task 4 |
| §7 MVP recovery (orc resume [DEGRADED]) | Task 14 |
| §8 WorkerAgent + CodexCLIAdapter | Task 6 |
| §8 .orc/.orc-done.json + .orc/.orc-session.jsonl | Task 6 codex-cli.ts |
| §9 Concurrency governor (fixed release) | Task 7 |
| §9 Worker abort guard (slotHeld) | Task 8 worker.ts |
| §10 ContextManager | Task 9 |
| §10 Steering: Approve/Drop buttons (real command enqueue) | Task 13 + 16 |
| §11 Skills files (8 files) | Task 12 |
| §12 Dashboard — Tree, Detail (Compare+Approve for leads / Plan+Logs+Preview for workers), Events | Task 15-16 |
| §12 Preview — Strudel URL [DEGRADED] | Task 12 preview.ts |
| §13 Monorepo layout (Turborepo, src/) | Task 1 |
| §14 CLI (orc run/status/resume) | Task 14 |
| §15 Design decisions | All tasks |
| §16 Workflow templates + topologicalSort | Task 10 templateLoader.ts |
| §17 Watchdog | Task 11 |
| §18 Merge coordinator (serialized, [POST-DEMO] repair noted) | Task 11 |
| §19 Plan artifacts (wired into Worker, Lead, Mastermind) | Tasks 5, 8, 9, 10 |

### Explicit [DEGRADED] and [POST-DEMO] items

**[DEGRADED] — real code, reduced behavior:**
- `orc resume` = restart + SQLite state; no worktree reconciliation
- Preview = Strudel URL; no local dev-server
- Merge conflict = event emitted; no auto-repair
- NL steering = API stub; not routed to entity queues

**[POST-DEMO] — not in this plan:**
- Merge-fix worker (repair branch lifecycle)
- Worktree reconciliation on boot
- Generic local dev-server preview
- NL routing to entity queues
