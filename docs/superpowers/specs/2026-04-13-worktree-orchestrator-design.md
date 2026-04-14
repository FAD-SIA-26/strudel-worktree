# WorkTree Orchestrator — Design Spec
*2026-04-13 · v3*

---

## 0. MVP Scope

```
MUST HAVE (demo-able MVP, ~24-30h)          NICE TO HAVE (post-hackathon)
──────────────────────────────────          ──────────────────────────────
SQLite event_log + projections              Redis (post-MVP only)
In-memory event bus + WebSocket             Outbox processor
Git worktree manager                        Full crash recovery (§7)
CodexCLIAdapter (codex subprocess)          Security agent + patch worker
Mastermind decomposition (LLM call)         Strategic retry (Level 2+3)
maxConcurrentWorkers concurrency cap        Cross-lead context sharing
Worker health taxonomy + watchdog (§17)     Changelog generation
Workflow templates / task recipes (§16)     Literal agent-to-agent session talk
strudel-track.toml as first template        Outbox idempotency
Session event log per run (§8)
Lead → spawn N workers in parallel
Basic CLI: orc run, orc status, orc resume
Reviewer (pick best diff, explain why)
Merge coordinator + AI merge-fix worker
Preview launcher — one-click per worktree
Web dashboard — live tree, event stream
Steer / approve / drop / compare / preview
```

**Demo story (MVP):** user runs `orc run "build X"` → mastermind decomposes into sections → each section spawns 2-3 parallel Codex workers in separate worktrees → user watches live in dashboard → reviewer picks the best output → winning branch merges into the orchestration run branch → once all sections are integrated, the run branch is fast-forwarded to main. That is a complete, winning demo.

Sections below are marked **[MVP]** or **[nice-to-have]**. Nice-to-have sections are specced for future reference but not required for the hackathon build.

---

## 1. Overview [MVP]

A general-purpose agentic orchestration system. A single **Mastermind** agent decomposes a user goal into sections, delegates each section to a **Lead team**, and monitors progress. Each Lead team runs a PM agent, N parallel Implementer workers (each in its own git worktree), and a Reviewer that picks the best output and merges it.

Built on TypeScript + Codex CLI. Agent-agnostic by interface design.

**Technology stack:**
| Layer | Technology |
|---|---|
| Monorepo | Turborepo |
| Linting / formatting | Biome with ultracite config (shared across all packages) |
| Backend | Express + Drizzle (SQLite ORM) + Zod |
| Frontend (dashboard) | Next.js + TanStack Query + Zod |
| Shared contracts | `@orc/types` — Zod schemas for all events, commands, API types |
| Storage | SQLite (via Drizzle) |
| Live updates | In-memory event bus (Express) → WebSocket → browser |

`@orc/types` is the contract between backend and frontend. Every event shape, command, and API request/response is a Zod schema defined once and imported by both sides.

---

## 2. Five-Layer Architecture [MVP core / nice-to-have edges]

| Layer | Technology | Owns | MVP? |
|---|---|---|---|
| `event_log` | SQLite (append-only) | Durable truth — what happened | MVP |
| `projections` | SQLite (mutable tables) | Current read state — what is | MVP |
| `event_bus` | In-memory (Express process) | Live fanout to WebSocket clients | MVP |
| `outbox` | SQLite (pending queue) | Pending cross-boundary side effects | nice-to-have |
| Code truth | git worktrees | What was built | MVP |
| Redis | Redis Streams | Rebuildable live coordination | nice-to-have |

**The one invariant:** every state transition writes to `event_log` + updates the relevant projection in a single SQLite transaction, then emits the event to the in-memory event bus.

**MVP live coordination model:**
- Single Node.js process — all orchestration runs in-process
- Every state transition is appended to `event_log`
- The same event is emitted to an in-memory `EventEmitter` (the event bus)
- The Express WebSocket handler subscribes to the event bus and pushes events to all connected browsers
- On reconnect: dashboard calls `GET /api/orchestration` (TanStack Query) to hydrate from SQLite, then re-subscribes to WebSocket for live updates
- No Redis required — this is simpler, clearer, and sufficient for a single-process system

Redis remains specced as a post-MVP extension for when multi-process coordination is needed.

---

## 3. Entity Hierarchy & State Machines [MVP]

```
Mastermind
└── SectionLead (one per section, e.g. "bass", "drums", "melody")
    ├── PM Agent        (read-only, produces sub-tasks + worker prompts)   [MVP]
    ├── Implementer ×N  (each owns a git worktree, runs WorkerAgent)       [MVP]
    └── Reviewer        (read-only, picks best diff, explains reasoning)   [MVP]

-- nice-to-have --
    └── Security Agent  (read-only, can spawn Patch Worker if critical issue)
        └── Patch Worker (optional, owns its own worktree)
```

### Mastermind states [MVP]
`idle → planning → delegating → monitoring → merging → done | failed`

**OrchestrationComplete** (transitions Mastermind to `done`) when:
- ALL `tasks` have `status IN ('done', 'cancelled')`
- AND ALL `merge_queue` entries have `status = 'done'`
- AND no tasks remain in `running | queued | retrying | stalled | zombie`

**OrchestrationFailed** (transitions Mastermind to `failed`) when ANY of:
- A non-optional task reaches `status = 'failed'` with `maxRetries` exhausted and no recovery path
- A `merge_queue` entry reaches `status = 'failed'` for a non-optional section (merge-fix worker exhausted all retries)
- A `merge_queue` entry is stuck in `conflict` and the user chose to fail the orchestration at the high-level decision prompt

### SectionLead states [MVP]
`idle → planning → running → reviewing → merging → done | failed | escalated`

### Implementer/Worker states [MVP]
`queued → spawning → running → stalled | zombie → done | failed | retrying | cancelled`

**Health taxonomy [MVP]:**
- `queued` — waiting for a concurrency slot (gated by `maxConcurrentWorkers`)
- `running` — active, stdout heartbeat within threshold
- `stalled` — no stdout activity for N seconds, process still alive
- `zombie` — process dead but no completion marker written
- `done` / `failed` — terminal, completion marker present

The watchdog derives health from: stdout inactivity timer, OS process liveness check (`kill -0`), and presence of `.orc-done.json`. **The watchdog loop is MVP** — it runs every 5 seconds and feeds live health state to the dashboard. See §17 for full spec.

### PM / Reviewer states [MVP]
`idle → running → done | failed`

**Commands flow down** (Mastermind → Lead → Worker via in-process queues).
**Events flow up** (Worker → Lead → Mastermind via in-process queues).

---

## 4. SQLite Schema [MVP]

Schema is defined and managed via **Drizzle ORM**. All table definitions live in `apps/api/src/db/schema.ts` as Drizzle schema objects. Migrations are generated with `drizzle-kit`. Raw SQL shown below for clarity; the Drizzle schema is the implementation source.

### 4.1 event_log (append-only journal)
```sql
CREATE TABLE event_log (
  id          INTEGER PRIMARY KEY,
  entity_id   TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,  -- mastermind|lead|worker|pm|reviewer
  event_type  TEXT    NOT NULL,
  sequence    INTEGER NOT NULL,  -- monotonic per entity_id
  payload     JSON    NOT NULL,
  ts          INTEGER NOT NULL,
  UNIQUE(entity_id, sequence)
);
```

### 4.2 Projections (current read state) [MVP]

Categories are fixed; exact column set evolves during implementation:

- **tasks** — entity id, type, parent_id, state, retry_count, task_prompt, strategy, spawn_generation
- **runs** — executing agents, adapter type, pid, started_at, last_output_ts
- **worktrees** — worker_id, path, branch, base_branch, git_status, diff_summary

**Git branch naming convention:**
```
feat/{section-id}-v{n}          # e.g. feat/rhythm-v1, feat/melody-v3
feat/{section-id}-v{n}-r{retry} # e.g. feat/rhythm-v1-r2  (retry 2 of worker v1)
```
Maps 1:1 to worktree paths (`.worktrees/rhythm-v1`). Readable with `git branch --list feat/*`.
- **merge_candidates** — lead_id, winner_worker_id, target_branch, reviewer_reasoning
- **merge_queue** — lead_id, winner_worktree_id, target_branch, status, conflict_details, fix_worker_id, fix_attempts, created_at, merged_at *(full schema in §18)*
- **task_edges** *(likely extra)* — parent_id, child_id, dependency type, `retry_of`
- **previews** — worktree_id, port, url, status, launched_at  *(MVP — required by preview launcher)*
- **agent_sessions** *(likely extra)* — entity_id, adapter, pid, status

### 4.3 outbox (pending side effects) [nice-to-have]

```sql
CREATE TABLE outbox (
  id           INTEGER PRIMARY KEY,
  effect_key   TEXT    NOT NULL UNIQUE,  -- deduplicates replays (see below)
  effect_type  TEXT    NOT NULL,  -- redis_publish|agent_spawn|preview_launch|merge_job
  payload      JSON    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed
  created_at   INTEGER NOT NULL,
  processed_at INTEGER
);
```

**Idempotency keys — tied to spawn generation, not permanent per entity:**
- `agent_spawn` → `spawn-{entity_id}-{spawn_generation}` — `spawn_generation` is a monotonic counter per entity stored in the `tasks` projection. Incremented on each legitimate restart, so the same entity can be respawned after a crash without a permanent block.
- `preview_launch` → `preview-{worktree_id}-{launch_gen}` — same pattern, counter in `previews`.
- `merge_job` → `merge-{lead_id}-{winner_worker_id}` — one merge per (lead, winner) pair, ever.
- `redis_publish` → `pub-{entity_id}-{sequence}` — safe to deduplicate; consumers are idempotent.

All handlers check "already running / already done" before acting.

---

## 5. Event Bus, WebSocket & Orchestration Tracing [MVP]

### In-memory event bus

The Express process maintains a single `EventEmitter` instance (the event bus). Every state transition:
1. Writes to `event_log` + updates projection (SQLite transaction)
2. Emits the same event to the in-memory bus
3. The WebSocket handler broadcasts it to all connected dashboard clients

```typescript
// Every state transition follows this pattern:
db.transaction(() => {
  appendToEventLog(event)
  updateProjection(event)
})
eventBus.emit('orchestration:event', event)  // → WebSocket → browser
```

All cross-role coordination (Mastermind → Lead → Worker) uses **in-process async queues** backed by the same event bus. No Redis needed.

### Dashboard reconnect

On reconnect, the dashboard:
1. Calls `GET /api/orchestration` — TanStack Query fetches the full current state from SQLite projections
2. Re-subscribes to WebSocket — receives live events from the in-memory bus going forward

### Orchestration tracing [MVP]

All cross-role interactions are **journaled as typed events** in `event_log`. No direct worker-to-worker calls exist. Every interaction is visible through the event log.

Core event types:

| Event | Direction | Payload |
|---|---|---|
| `CommandIssued` | any → any | `{ from, to, commandType, payload }` |
| `CommandAccepted` | entity → issuer | `{ commandId, entityId }` |
| `WorkerProgress` | worker → lead | `{ workerId, output, ts }` |
| `WorkerCompleted` | worker → lead | `{ workerId, branch, diff }` |
| `ReviewerSelectedWinner` | reviewer → lead | `{ leadId, winnerId, reasoning }` |
| `MergeRequested` | lead → coordinator | `{ leadId, worktreeId, targetBranch }` |
| `MergeConflict` | coordinator → mastermind | `{ mergeId, conflictFiles }` |
| `MergeResolved` | merge-fix worker → coordinator | `{ mergeId, repairBranch, summary, checksPassed }` |

This gives full orchestration visibility through the event log. The dashboard reads the same history.

### Redis (post-MVP)

Redis is specced as a post-MVP extension for when the orchestrator needs to scale beyond a single process. The event bus is the drop-in replacement surface — swapping `EventEmitter` for a Redis Stream publisher is a contained change.

---

## 6. Outbox Processor [nice-to-have]

Background loop:
1. Poll `outbox WHERE status='pending'` every ~50ms
2. Execute side effect (idempotently — check "already done" before acting)
3. Mark `done` on success, `failed` on error (retry up to N times)

On crash: `pending` entries replayed on next boot. Must run after coroutines resubscribe (see §7 boot order).

---

## 7. Crash Recovery — Boot Sequence

### MVP recovery (`orc resume`)

Best-effort continuation from persisted SQLite state. No Redis involved.

1. Open SQLite, run migrations if needed
2. Load orchestration state from projections → reconstruct entity tree in memory
3. Reconcile worktrees via **completion marker** (`.orc-done.json` in worktree root):
   - Marker `status: done` → emit `WorkerDone`, mark complete
   - Marker `status: failed` → treat as `WorkerFailed`, apply retry logic
   - No marker + uncommitted changes → Codex was mid-run, re-spawn to continue
   - No marker + clean worktree → re-spawn from scratch
   - Worktree missing → re-create branch + worktree, re-spawn
4. Mark in-flight workers as resumable / failed / retryable based on reconciliation
5. Restart in-process orchestration coroutines (Mastermind, Leads, active Workers)
6. Restart dashboard + WebSocket server
7. Continue from persisted state

**Why completion marker, not "has commits":** a branch can have commits and still be incomplete, wrong, or semantically failed. `.orc-done.json` is the only reliable terminal signal.

### Post-MVP distributed recovery

Same as above, plus:
- Connect Redis, verify reachable
- Re-instantiate coroutines and resubscribe to Redis Streams with last-read cursor from projection
- Drain outbox — safe now, consumers are ready
- Repopulate Redis broadcast for dashboard

---

## 8. Agent Runner Interface [MVP]

```typescript
interface WorkerAgent {
  run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult>
  abort(): Promise<void>
}

interface WorkerTask {
  id: string
  prompt: string          // generated by PM agent
  maxRetries: number
  strategy?: string       // hint for retry — changes approach, not just retries
  errorHistory: string[]  // prior attempt errors, appended to retry prompt
}

interface WorkerContext {
  worktreePath: string
  branch: string
  baseBranch: string
  entityId: string
}

interface WorkerResult {
  status: 'done' | 'failed'
  branch: string
  diff?: string
  error?: string
  retryable: boolean
}
```

**MVP implementation:** `CodexCLIAdapter` — spawns `codex` as a child process in `ctx.worktreePath`, streams stdout to `WorkerProgress` events. On exit:
1. Writes `.orc-done.json` to the worktree root: `{ status, exitCode, ts }`
2. Writes `.orc-session.jsonl` alongside it: one JSON line per structured output chunk from Codex

**Session event log [MVP — implementation is cheap]:**
`.orc-session.jsonl` captures the full structured output of the Codex run. On retry or resume, `ContextManager` reads this file, summarises the prior session (last N lines or a brief LLM summary), and prepends it to the new worker's prompt:

```
Prior attempt summary: Codex got as far as creating the bass pattern file
but failed when trying to import the Strudel module. It wrote partial code to
src/instruments/bass.js before exiting with error: "Cannot find module '@strudel/core'".
```

This gives the retry agent real context about what was attempted, not just the error message. Raw logs remain for inspection.

**Post-MVP adapters:** `ClaudeCodeAdapter`, `OpenCodeAdapter` — same interface, drop-in swap.

---

## 9. Delegation Tree, Concurrency & Retry Logic

### Concurrency governor [MVP]

The orchestrator maintains a global semaphore: `maxConcurrentWorkers` (default: 4, configurable). When a Lead tries to spawn a worker and the cap is reached, the worker enters `queued` state and waits. The semaphore releases when any worker reaches a terminal state (`done`, `failed`, `cancelled`).

This prevents subprocess load collapse, API rate-limit exhaustion, and local machine contention during the demo. Without it, spawning 12 parallel Codex processes at once will degrade or crash the demo.

Config location: `orc.config.ts` (or `.orcrc.json`), key `maxConcurrentWorkers`. Overridable per-run via `orc run --max-workers N`.

### Internal delegation model [MVP]

A worker may internally use Codex subagents as an implementation detail of its own run. The orchestrator treats this as a single opaque worker execution:

- Only **top-level workers** are scheduled entities counted against `maxConcurrentWorkers`
- Internal Codex subagents have **no separate visibility** in the orchestration tree
- They have **no independent retry or recovery semantics** — if the parent worker fails, the whole run fails
- They have **no independent worktree ownership** — all changes land in the parent worker's worktree
- Resource usage (tokens, CPU, RAM) is **charged to the parent worker budget**

This is the only safe MVP model. Allowing unlimited untracked subagents breaks visibility, control, resource governance, and crash recovery — all core promises of the design. Post-MVP, visible subworkers (fully tracked entities with lineage and budget) can be introduced as a first-class feature.

### Level 1 — Worker retry [MVP — basic retry only]

`WorkerFailed` → spawn a **new worker entity + fresh worktree** (e.g. `bass-v1-r2`), with `retry_of: worker_id` lineage in `task_edges`. Failed worktree preserved for inspection. Error history passed in the new prompt.

**Why fresh worktree per retry:** reusing a failed worktree preserves broken local state. Each retry is clean and isolated.

**MVP:** Level 1 retry only, up to `maxRetries`. On exhaustion → `WorkerExhausted` → Lead marks section failed.

### Level 2 — Lead strategic retry [nice-to-have]

On `WorkerExhausted` → LLM picks new strategy from error history → fresh worker. If all strategies exhausted → `LeadFailed` → escalate to Mastermind.

### Level 3 — Mastermind [nice-to-have]

On `LeadFailed`: spawn fresh Lead team, mark section optional and continue, or emit `OrchestrationFailed`.

---

## 10. Utility Layer

### ContextManager [MVP — basic version]

- `buildMastermindCtx()` — user goal + project file tree + git log → LLM call → structured plan
- `buildLeadCtx(leadId)` — section task + prior attempt errors → PM agent prompt
- `buildReviewerCtx(leadId)` — all worker diffs → reviewer prompt

**Reviewer framing:** the reviewer is an **MVP arbitration layer**, not a universal evaluation truth source. It works well when outputs are independently valid, comparable, and diffable (Strudel patterns, isolated feature files, small scoped tasks). It is weaker for refactors, cross-cutting changes, or tasks where "best diff" ≠ "correct integration." Post-MVP signals to augment or replace it: lint/typecheck pass, test results, execution-based scoring, human approval weighting.
- `routeDirective(text)` — NL directive → target entity + command type [**MVP if time permits** — dashboard action buttons are the primary steering path; NL routing is sugar on top]

**Cross-lead context** (sibling lead summaries in each lead's context) → [nice-to-have]

### User Steering

**Primary steering path [MVP]:** dashboard action buttons — Approve, Drop, Compare, Preview. These are sufficient to prove human-in-the-loop and are the required MVP controls.

**Natural language steering [MVP if time permits]:** `routeDirective()` parses NL directives from the dashboard top bar and routes as a typed `CommandIssued` event to the appropriate entity's in-process queue. All steering is journaled to `event_log`. Downgrade this if time is tight — the explicit buttons are enough for the demo.

| Directive | Routes to | Command |
|---|---|---|
| "make the bass darker" | bass-lead | `InjectConstraint` |
| "drop bass-v2" | bass-lead | `Abort` with `targetWorkerId` — lead forwards to worker via in-process queue |
| "bass-v1 is perfect, ship it" | bass-lead | `ForceApprove` |
| "add a guitar section" | mastermind | `SpawnLead` |
| "skip this section" | mastermind | `MarkSectionOptional` |

Workers are never addressed directly. All worker commands route through the owning Lead.

### Dashboard actions [MVP]

The dashboard supports these direct actions (not just steering text):
- **Approve** — force-approve the reviewer's winner and trigger merge
- **Drop** — abort a specific worker or drop all variations for a lead
- **Compare** — side-by-side diff view of two worker variations
- **Preview** — launch a worktree's dev server on an allocated port; for Strudel, the user hears the music

### Output Artifacts [nice-to-have]
- Orchestration report, AI-generated changelog, runnable preview per worktree

---

## 11. Agent Skills Files [MVP for core 5, post-MVP for security/patch]

```
skills/
├── mastermind.md    # MVP
├── lead.md          # MVP
├── pm-agent.md      # MVP
├── implementer.md   # MVP — base template, Codex prefix in agents/codex-cli.ts
├── reviewer.md      # MVP
├── security.md      # post-MVP
└── patch-worker.md  # post-MVP
```

### Skills file format
```markdown
# <AgentName> Skills

## Role
## Tools
## Context schema
## Output schema
## Constraints
```

### Source guidance

| Agent | Starting point |
|---|---|
| `mastermind.md` | Custom |
| `lead.md` | Custom |
| `pm-agent.md` | Adapt: OpenAI PM/planning prompt patterns; Linear-style issue decomposition |
| `implementer.md` | Codex built-in system prompt + task-specific prefix |
| `reviewer.md` | Adapt: CR-GPT patterns, conventional comments |

---

## 12. Web Dashboard [MVP — primary human interface]

The dashboard is the primary user interface and a core part of the MVP. It is how the user watches parallel workers run, compares variations, approves the winner, and steers mid-flight. Without it, there is no human in the loop — just a CLI that runs to completion.

Three-panel layout served by Express + WebSocket on port 4000 (default):

**Left panel [MVP]:** Orchestration tree — Mastermind → Leads → Workers. Live status badges using the health taxonomy (queued / running / stalled / zombie / done / failed). Expandable per lead.

**Center panel [MVP]:** Selected entity detail.
- For a Lead: reviewer verdict, side-by-side diff comparison of worker variations, **Approve / Drop / Spawn another** action buttons.
- For a Worker: agent output log, health status, retry/abort controls.

**Right panel [MVP]:** Live event stream from the in-memory event bus via WebSocket. Shows what every entity is doing in real time.

**Top bar [MVP]:** Global orchestration status + natural language steering input (routes to Mastermind).

**Preview launcher [MVP]:** one-click launch of a worktree's running app on localhost. Port pool: `PORT_POOL_START=3100`, size 50 (supports up to 50 simultaneous previews). Port assigned as `3100 + (worktree_index % 50)`, tracked in `previews` projection. For Strudel, this starts the Strudel dev server for that worktree so the user can hear the music directly from the dashboard. Port is shown on the worker card; clicking opens the preview in a new tab. Stopping the preview frees the port.

**Frontend:** Next.js App Router. All API types from `@orc/types`.

**WebSocket architecture — explicit boundary:**
```
apps/api/src/server/ws.ts    ← WebSocket SERVER (Express + ws library, port 4000)
apps/web/src/ws/client.ts    ← WebSocket CLIENT (browser, connects to api:4000)
```
The dashboard is a Next.js client that connects to the Express WebSocket server. Next.js API routes are **not** used for WebSocket — do not attempt WebSocket upgrades via Route Handlers.

**TanStack Query + WebSocket hydration pattern:**
```typescript
// Initial state: TanStack Query fetches REST snapshot
const { data } = useQuery({
  queryKey: ['orchestration'],
  queryFn: () => fetch('/api/orchestration').then(r => r.json()),
});

// Live updates: WebSocket events patch the cache directly
useEffect(() => {
  ws.on('WorkerStateChanged', (event) => {
    queryClient.setQueryData(['orchestration'], (old) => applyEvent(old, event));
  });
}, []);
```
REST for initial hydration. WebSocket events as cache patches. Never mix: a REST poll and a live WebSocket update on the same data will produce inconsistent UI state.

---

## 13. Project Structure [MVP layout]

Turborepo monorepo. Biome ultracite config shared across all packages via `packages/config`.

```
turbo.json
biome.json              # root — extends packages/config/biome.json
package.json            # workspace root (pnpm workspaces)

apps/
  api/                  # Express backend: orchestrator + API server
    src/
      db/               # Drizzle schema, journal, queries, projections/
                        # outbox.ts (nice-to-have)
      orchestrator/     # mastermind.ts, lead.ts, worker.ts, context.ts
                        # recovery.ts (nice-to-have)
      agents/           # WorkerAgent interface, codex-cli.ts, mock.ts
      events/           # eventBus.ts (in-memory EventEmitter), wsHandler.ts
      git/              # worktree.ts, reconcile.ts
      server/           # Express app, routes, WebSocket handler
      # redis/          # post-MVP — client.ts, streams.ts, broadcast.ts
      cli.ts            # orc run, orc status, orc resume
    drizzle.config.ts
    package.json

  web/                  # Next.js dashboard (App Router)
    src/
      app/              # Next.js app dir — pages + layout
      components/       # TreePanel, DetailPanel, EventStream, WorkerCard
      hooks/            # useOrchestration, useWorkerHealth (TanStack Query)
      ws/               # WebSocket client
    package.json

packages/
  types/                # @orc/types — shared Zod schemas (source of truth)
    src/
      events.ts         # all event shapes
      commands.ts       # all command shapes
      api.ts            # REST request/response schemas
      db.ts             # Drizzle table type exports
    package.json

  config/               # @orc/config — shared Biome ultracite config
    biome.json
    package.json

skills/
  mastermind.md · lead.md · pm-agent.md · implementer.md · reviewer.md  # MVP
  security.md · patch-worker.md                                          # post-MVP

templates/
  strudel-track.toml    # MVP
  # future: rest-api.toml, react-app.toml, ...

docs/superpowers/specs/
```

**Package dependency rule:** `apps/*` import from `packages/*`. `packages/types` imports nothing internal. `packages/config` is devDependency only. No circular deps.

**Zod as the contract:** every event, command, and API type is a Zod schema in `@orc/types`. Backend uses it for runtime validation; frontend for type-safe API calls. New event = one Zod schema added — both sides stay in sync.

---

## 14. CLI

```bash
# MVP
orc run "build a lo-fi track"   # decompose → spawn leads → workers → review → merge
orc status                       # print current orchestration state from SQLite
orc resume                       # MVP: restarts the process and attempts best-effort continuation
                                 # from persisted SQLite state (see §7 for what this covers)

# nice-to-have
orc steer "make bass darker"
orc approve bass-v1
orc preview bass-v2
orc dashboard
```

---

## 15. Key Design Decisions

1. **Single Node.js process, no Redis for MVP** — all coordination is in-process. In-memory EventEmitter as event bus. Redis is post-MVP only, for multi-process scaling.
2. **SQLite is always authoritative** — in-memory event bus is ephemeral; SQLite is the durable record. Dashboard hydrates from SQLite on reconnect.
3. **Fresh worktree per retry** — clean isolation, `retry_of` lineage in task_edges.
4. **Completion marker** — `.orc-done.json` written by runner. Recovery never infers state from commits alone.
5. **All cross-role interactions are journaled events** — no direct worker-to-worker calls. Core event types go into event_log; dashboard reads the same history. Do not over-formalize: event structure serves current-state visibility, logs, retries, reviewer verdict, merge flow, and dashboard rendering — nothing more in MVP.
6. **Merge target is `run/<id>`, not `main`** — section winners merge into a run branch. Only at orchestration end does the Mastermind fast-forward `run/<id>` → `main`. Prevents integration weirdness during parallel section execution.
7. **Outbox generation counters** — `spawn-{entity_id}-{spawn_gen}`, not permanent per entity, so crash-restart re-spawns are allowed.
8. **Worker commands always via Lead** — no entity is addressed directly from outside its parent. Steering routes to Lead; Lead forwards to worker via in-process queue.
9. **Skills files are first-class** — agent behavior in `skills/*.md`, not hardcoded.
10. **maxConcurrentWorkers is MVP, not optional** — without it, parallel Codex spawns collapse the demo on any real machine. Default 4, configurable.
11. **Watchdog is MVP** — 5-second polling loop feeds live health state to dashboard. Health taxonomy `queued|running|stalled|zombie|done|failed` is meaningful from day one.
12. **Session event log per run** — `.orc-session.jsonl` in each worktree. Cheap to write, high value for retry prompts and debugging. Prior session summary injected into retry prompt.
13. **Workflow templates for known domains** — `strudel-track.toml` hardcodes the instrument decomposition and dependency ordering. Reduces LLM variance, makes the demo intentional. Mastermind falls back to free LLM decomposition when no template matches.
14. **Preview launcher is MVP** — one-click launch of any worktree's app. For Strudel: start the dev server so the user hears the music. Port pool: `PORT_POOL_START=3100`, size 50.
15. **Merge coordinator + AI merge-fix worker** — merges serialized FIFO onto `run/<id>`. On conflict, Mastermind spawns a merge-fix worker producing `repair/<merge-id>-v{n}`. User only gets A/B/C product-level decision if automated repair fails. User never touches code.
16. **PM agent always runs as LLM call (Option B)** — even for template-driven runs, the PM agent makes a real LLM call to render `prompt_hint` into a rich, context-aware worker prompt.
17. **Git branch naming is fixed** — `feat/{section-id}-v{n}` for initial workers, `feat/{section-id}-v{n}-r{retry}` for retries, `repair/<merge-id>-v{n}` for merge-fix workers.
18. **WebSocket server lives in `apps/api`** — Next.js API routes are never used for WebSocket. The dashboard connects as a plain browser WebSocket client to `api:4000`.
19. **Dashboard buttons are primary steering [MVP]; NL routing is secondary [MVP if time permits]** — Approve, Drop, Compare, Preview are sufficient to prove human-in-the-loop. `routeDirective()` is sugar; downgrade it if time is tight.

---

## 16. Workflow Templates / Task Recipes [MVP for Strudel template]

Instead of calling the LLM to figure out decomposition from scratch every time, the Mastermind can use a **workflow template** — a predefined task recipe that specifies sections, dependency ordering, and default prompt hints. The LLM then fills in the per-section prompts rather than inventing the structure.

This makes the demo faster, more reliable, and more intentional. For freeform goals (`orc run "build me a REST API"`), the LLM decomposes freely. For known domains, a template provides guardrails.

### Template format

```toml
# templates/strudel-track.toml

[template]
name    = "strudel-track"
version = "1.0"
description = "Lo-fi / electronic track with parallel instrument sections"

[[sections]]
id          = "rhythm"
label       = "Rhythm Section"
depends_on  = []
workers     = 2          # spawn 2 parallel variations
prompt_hint = """
Write a Strudel pattern for the rhythm section (bass + drums).
Use the 'sound' and 'note' functions. Keep it minimal and loopable.
Target tempo: {tempo}bpm, key: {key}.
"""

[[sections]]
id          = "harmony"
label       = "Harmony / Chords"
depends_on  = ["rhythm"]   # waits for rhythm section to complete
workers     = 2
prompt_hint = """
Write a Strudel chord pattern that complements the rhythm section.
Rhythm section output: {rhythm.winner_diff}
"""

[[sections]]
id          = "melody"
label       = "Lead Melody"
depends_on  = ["rhythm", "harmony"]
workers     = 3
prompt_hint = """
Write a Strudel lead melody over the rhythm and harmony.
Rhythm: {rhythm.winner_diff}
Harmony: {harmony.winner_diff}
"""

[[sections]]
id          = "arrangement"
label       = "Final Arrangement"
depends_on  = ["rhythm", "harmony", "melody"]
workers     = 1
prompt_hint = """
Combine all sections into a final Strudel arrangement with proper
mix levels, effects, and structure. Import from the winning branches.
"""

[params]
tempo = 90
key   = "Dm"
```

### How the Mastermind uses it

1. If a matching template exists for the goal (by name or auto-detected), load it
2. PM agent receives `prompt_hint` + rendered params + prior section `winner_diff` as context → makes a full LLM call → outputs a rich, context-aware worker prompt (Option B — see §15 decision 15)
3. Respect `depends_on` ordering — sections with unsatisfied deps stay `queued`
4. Fall back to full LLM decomposition if no template matches

### Template location

```
templates/
  strudel-track.toml    # MVP — Strudel demo template
  # future: rest-api.toml, react-app.toml, etc.
```

The `--template` flag overrides auto-detection: `orc run "lo-fi track" --template strudel-track`.

---

## 17. Watchdog [MVP] {#s17}

The watchdog is a background loop that monitors all workers in `running` or `spawning` state and derives their health from three inputs. It runs every 5 seconds.

### Polling inputs (per worker)

| Input | How | Signal |
|---|---|---|
| stdout inactivity | time since last `WorkerProgress` event in SQLite | `stalled` if > threshold (default 60s) |
| process liveness | `kill -0 <pid>` on the pid in `runs` projection | `zombie` if process dead + no `.orc-done.json` |
| completion marker | read `.orc-done.json` from worktree path | `done` or `failed` if marker present |

### Emitted events

- `WorkerHealthy` — re-emitted every poll cycle while worker is `running` + active (heartbeat)
- `WorkerStalled` — first time inactivity threshold exceeded; state transitions to `stalled`
- `WorkerZombie` — process dead, no marker; state transitions to `zombie`
- `WorkerRecovered` — worker was `stalled` but stdout resumed; transitions back to `running`

### Actions on health events

- **Stalled:** Lead is notified via in-process queue. Lead waits one more poll cycle, then emits `Abort` + schedules retry.
- **Zombie:** treated as `WorkerFailed` with `retryable: true`. Retry logic in §9 applies.
- **Healthy / Recovered:** no action, state updated in `tasks` projection.

The watchdog does **not** make retry decisions — it observes and emits. The Lead owns the retry decision.

---

## 18. Merge Coordinator [MVP] {#s18}

Merges are never run concurrently. All merge requests flow through a single serialized coordinator.

**Merge target is `run/<orchestration-id>`, not `main`.** Each orchestration run creates a dedicated integration branch (e.g. `run/abc123`). Section winners are merged into this branch one at a time. Only after all sections are merged and the run is marked `done` does the Mastermind fast-forward (or squash-merge) `run/<id>` → `main`. This prevents integration weirdness where an early-merged section assumes structure that later sections haven't yet produced.

### Merge flow

```
Lead reviewer completes → Lead emits MergeRequest
        ↓
MergeCoordinator appends to merge_queue (SQLite)
        ↓
Coordinator processes queue one at a time:
  1. fetch latest main
  2. git merge feat/<section> --no-ff  (onto run/<orchestration-id>)
  3a. clean merge → emit MergeComplete → next in queue
  3b. conflict → emit MergeConflict → Mastermind spawns merge-fix worker
        ↓
Merge-fix worker receives:
  - target branch (run/<id>) + winning branch
  - other candidate branch context (if useful)
  - conflict files + raw git merge output
  - explicit acceptance criteria ("produce a valid, runnable merged result")
  → Codex edits conflicted files in a fresh repair worktree
  → repair branch named: repair/<merge-id>-v{attempt}  (e.g. repair/abc123-v1)
  → runs lint / tests / build / preview check
  → emits MergeResolved { mergeId, repairBranch: "repair/abc123-v1", summary, checksPassed }
        ↓
Coordinator merges repair/<merge-id>-v{n} into run/<orchestration-id>
  (artifact lineage: original winner → conflict → repair branch → run branch)
        ↓
If merge-fix worker fails repeatedly (maxMergeRetries) →
  Mastermind surfaces high-level decision to user in dashboard:
    A. Retry with another candidate variation
    B. Skip this section (mark optional)
    C. Fail the orchestration
  User picks A/B/C — never touches code directly
        ↓
All merges done → Mastermind fast-forwards run/<id> → main → emits OrchestrationComplete
```

**The user never resolves code-level conflicts.** The merge-fix worker handles all code-level repair. The user only makes product-level decisions (A/B/C above) if automated repair fails.

### Merge-fix worker scope

**May:**
- Edit conflicted files in the repair worktree
- Run lint / tests / build to validate the fix
- Launch a preview to verify the result is runnable
- Summarize what it changed and why

**May not:**
- Re-plan the section or rewrite files unrelated to the conflict
- Spawn additional subworkers
- Change product intent without surfacing it to the user
- Broadly refactor beyond the conflicted scope

The merge-fix worker is a **repair worker**, not a second Mastermind. Its scope is bounded to the conflict and the acceptance criteria it was given.

### merge_queue projection

```sql
CREATE TABLE merge_queue (
  id                 INTEGER PRIMARY KEY,
  lead_id            TEXT    NOT NULL,
  winner_worktree_id TEXT    NOT NULL,
  target_branch      TEXT    NOT NULL,  -- run/<orchestration-id>
  status             TEXT    NOT NULL DEFAULT 'pending',
                             -- pending|merging|done|conflict|fixing|retrying|failed
  conflict_details   JSON,
  fix_worker_id      TEXT,   -- entity_id of the merge-fix worker, if spawned
  fix_attempts       INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  merged_at          INTEGER
);
```

### State machine

`pending → merging → done | conflict → fixing → retrying → done | failed`

### Key rules

- Only one merge runs at a time. Mutex: SQLite `status='merging'` as in-process lock. FIFO by `created_at`.
- On conflict: coordinator pauses, Mastermind spawns a merge-fix worker. Other pending merges stay queued.
- `conflict → fixing → retrying` is fully automated. User is not involved unless `maxMergeRetries` is exhausted.
- On unrecoverable failure: Mastermind surfaces A/B/C choice to user (no code interaction).
- On non-conflict git error (e.g. missing branch): mark `failed`, notify Mastermind, continue queue.
