# WorkTree Orchestrator — Design Spec
*2026-04-13 · v3*

---

## 0. MVP Scope

```
MUST HAVE (demo-able MVP, ~24-30h)          NICE TO HAVE (post-hackathon)
──────────────────────────────────          ──────────────────────────────
SQLite event_log + projections              Outbox processor
Git worktree manager                        Full crash recovery (§7)
CodexCLIAdapter (codex subprocess)          Security agent + patch worker
Mastermind decomposition (LLM call)         Strategic retry (Level 2+3)
maxConcurrentWorkers concurrency cap        Cross-lead context sharing
Worker health taxonomy + watchdog (§17)     Changelog generation
Workflow templates / task recipes (§16)     Literal agent-to-agent session talk
strudel-track.toml as first template        Outbox idempotency / degrade mode
Session event log per run (§8)
Lead → spawn N workers in parallel
Basic CLI: orc run, orc status
Reviewer (pick best diff, explain why)
Merge coordinator — serialized (§18)
Preview launcher — one-click per worktree
Web dashboard — live tree, event stream
Approve / compare / drop / preview in UI
```

**Demo story (MVP):** user runs `orc run "build X"` → mastermind decomposes into sections → each section spawns 2-3 parallel Codex workers in separate worktrees → reviewer picks the best output → winning branch merges to main. That is a complete, winning demo.

Sections below are marked **[MVP]** or **[nice-to-have]**. Nice-to-have sections are specced for future reference but not required for the hackathon build.

---

## 1. Overview [MVP]

A general-purpose agentic orchestration system. A single **Mastermind** agent decomposes a user goal into sections, delegates each section to a **Lead team**, and monitors progress. Each Lead team runs a PM agent, N parallel Implementer workers (each in its own git worktree), and a Reviewer that picks the best output and merges it.

Built on TypeScript + Codex CLI. Agent-agnostic by interface design.

---

## 2. Five-Layer Architecture [MVP core / nice-to-have edges]

| Layer | Technology | Owns | MVP? |
|---|---|---|---|
| `event_log` | SQLite (append-only) | Durable truth — what happened | MVP |
| `projections` | SQLite (mutable tables) | Current read state — what is | MVP |
| `outbox` | SQLite (pending queue) | Pending cross-boundary side effects | nice-to-have |
| Live coordination | Redis Streams | What's happening now (rebuildable) | MVP (required by dashboard) |
| Code truth | git worktrees | What was built | MVP |

**The one invariant (MVP):** every state transition writes to `event_log` and updates the relevant projection in a single SQLite transaction.

**For MVP**, Redis and the outbox are optional. The orchestrator runs in a single Node.js process; all coordination between Mastermind, Leads, and Workers uses in-process async queues. Redis and the outbox are added when you need multi-process coordination or live dashboard updates.

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

The watchdog derives health from: stdout inactivity timer, OS process liveness check (`kill -0`), and presence of `.orc-done.json`. Full watchdog loop is nice-to-have; the state taxonomy is MVP so dashboard cards and logs are meaningful from day one.

### PM / Reviewer states [MVP]
`idle → running → done | failed`

**Commands flow down** (Mastermind → Lead → Worker via in-process queues).
**Events flow up** (Worker → Lead → Mastermind via in-process queues).

---

## 4. SQLite Schema [MVP]

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
- **merge_candidates** — lead_id, winner_worker_id, target_branch, reviewer_reasoning
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

## 5. Redis Coordination [MVP — required by dashboard]

When Redis is added (post-MVP), use **Redis Streams** — not pub/sub — for all `lead:*` channels. Redis Streams are durable: messages persist until consumed and acknowledged, and consumers reconnect with their last-read cursor. This is what makes the boot order safe.

| Stream | Direction | Purpose |
|---|---|---|
| `lead:<id>:inbox` | commands → Lead | Spawn, Retry, Abort, Pause, ForceApprove |
| `lead:<id>:events` | Lead → Mastermind | LeadDone, LeadFailed, ReviewComplete… |
| `orchestration:broadcast` | any → dashboard | All events mirrored for WebSocket fanout |

Redis channels exist **only for Leads, not Workers.** All worker commands go via the Lead's in-process queue.

**Worker steering routing:** a directive like "drop bass-v2" is routed by the Mastermind to the **bass-lead Redis inbox** (`Abort` command with `targetWorkerId: bass-v2`). The Lead receives it and sends Abort to the worker via its in-process queue. Workers never receive Redis messages directly.

Redis is rebuilt from SQLite on every boot. Required for dashboard and live coordination.

---

## 6. Outbox Processor [nice-to-have]

Background loop:
1. Poll `outbox WHERE status='pending'` every ~50ms
2. Execute side effect (idempotently — check "already done" before acting)
3. Mark `done` on success, `failed` on error (retry up to N times)

On crash: `pending` entries replayed on next boot. Must run after coroutines resubscribe (see §7 boot order).

---

## 7. Crash Recovery — Boot Sequence [nice-to-have]

> For MVP: if the process crashes, restart with `orc resume`. Full recovery is a nice-to-have.

Full recovery boot order — note that coroutines **resubscribe to Redis Streams before** the outbox is drained. This is required because the outbox may publish to streams; consumers must be ready first. Redis Streams are durable so no messages are lost between drain and subscribe.

1. Open SQLite, run migrations
2. Connect Redis, verify reachable
3. Load entities from projections → reconstruct dependency tree
4. Classify: `done/failed` → skip | `running/retrying` → resume | `pending` → check parent
5. Reconcile worktrees via **completion marker** (`.orc-done.json` in worktree root, written by runner on exit):
   - Marker `status: done` → emit `WorkerDone`
   - Marker `status: failed` → treat as `WorkerFailed`, apply retry logic
   - No marker + uncommitted changes → Codex mid-run, re-spawn to continue
   - No marker + clean → re-spawn from scratch
   - Worktree missing → re-create branch + worktree, re-spawn
6. **Re-instantiate live coroutines + resubscribe to Redis Streams** (with last-read cursor from projection)
7. Drain outbox — safe now, consumers are ready
8. Repopulate Redis broadcast for dashboard
9. Start dashboard + WebSocket
10. Ready — orchestration continues

**Why completion marker, not "has commits":** a branch can have commits and still be incomplete, wrong, or semantically failed. `.orc-done.json` is the only reliable terminal signal from the runner.

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
- `routeDirective(text)` — NL directive → target entity + command type [nice-to-have]

**Cross-lead context** (sibling lead summaries in each lead's context) → [nice-to-have]

### User Steering [nice-to-have]

| Directive | Routes to | Command |
|---|---|---|
| "make the bass darker" | bass-lead (Redis inbox) | `InjectConstraint` |
| "drop bass-v2" | bass-lead (Redis inbox) | `Abort` with `targetWorkerId` — lead forwards via in-process queue |
| "bass-v1 is perfect, ship it" | bass-lead (Redis inbox) | `ForceApprove` |
| "add a guitar section" | mastermind | `SpawnLead` |

Note: workers are never addressed directly via Redis. All worker commands route through the owning Lead.

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

**Right panel [MVP]:** Live event stream from `orchestration:broadcast` Redis channel via WebSocket. Shows what every entity is doing in real time.

**Top bar [MVP]:** Global orchestration status + natural language steering input (routes to Mastermind).

**Preview launcher [MVP]:** one-click launch of a worktree's running app on localhost. Each worktree gets a port from a pool (tracked in the `previews` projection). For Strudel, this starts the Strudel dev server for that worktree so the user can hear the music directly from the dashboard. Port is shown on the worker card; clicking opens the preview in a new tab. Stopping the preview frees the port.

Frontend: Vite + React. WebSocket client subscribes to dashboard server, which subscribes to Redis broadcast. This is why Redis moves to MVP alongside the dashboard.

---

## 13. Project Structure [MVP layout]

```
src/
  core/           # pure types — events, commands, states, types
  db/             # journal.ts, queries.ts, projections/
                  # outbox.ts (nice-to-have)
  orchestrator/   # mastermind.ts, lead.ts, worker.ts, context.ts
                  # recovery.ts (nice-to-have)
  agents/         # types.ts (WorkerAgent interface), codex-cli.ts, mock.ts
  redis/          # client.ts, streams.ts, broadcast.ts  [MVP — dashboard requires it]
  git/            # worktree.ts, reconcile.ts
  dashboard/      # server.ts, routes.ts, ws.ts           [MVP]
  cli.ts          # entry point: orc run, orc status, orc resume

frontend/                                                  [MVP]
  src/components/ # TreePanel, DetailPanel, EventStream
  vite.config.ts

skills/
  mastermind.md · lead.md · pm-agent.md · implementer.md · reviewer.md  # MVP
  security.md · patch-worker.md                                          # post-MVP

templates/
  strudel-track.toml    # MVP — Strudel demo template
  # future: rest-api.toml, react-app.toml, ...

docs/superpowers/specs/
```

---

## 14. CLI

```bash
# MVP
orc run "build a lo-fi track"   # decompose → spawn leads → workers → review → merge
orc status                       # print current orchestration state from SQLite
orc resume                       # resume after restart (nice-to-have: full recovery)

# nice-to-have
orc steer "make bass darker"
orc approve bass-v1
orc preview bass-v2
orc dashboard
```

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
2. Render `prompt_hint` fields with known params + prior section outputs
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

## 15. Key Design Decisions

1. **Single Node.js process** — all coordination is in-process for MVP. Redis added for live dashboard.
2. **SQLite is always authoritative** — Redis rebuilt from SQLite on boot.
3. **Fresh worktree per retry** — clean isolation, `retry_of` lineage in task_edges.
4. **Completion marker** — `.orc-done.json` written by runner. Recovery never infers state from commits alone.
5. **Redis Streams, not pub/sub** — durable consumption, cursor-based reconnect, boot order safe.
6. **Outbox generation counters** — `spawn-{entity_id}-{spawn_gen}`, not permanent per entity, so crash-restart re-spawns are allowed.
7. **Worker commands always via Lead** — workers have no Redis channels. Steering routes to Lead inbox; Lead forwards via in-process queue.
8. **Skills files are first-class** — agent behavior in `skills/*.md`, not hardcoded.
9. **maxConcurrentWorkers is MVP, not optional** — without it, parallel Codex spawns collapse the demo on any real machine. Default 4, configurable.
10. **Health taxonomy over raw running/failed** — `queued|running|stalled|zombie|done|failed` gives watchdog and dashboard real signal. Taxonomy is MVP; full watchdog loop is post-MVP.
11. **Session event log per run** — `.orc-session.jsonl` in each worktree. Cheap to write, high value for retry prompts and debugging. Prior session summary injected into retry prompt.
12. **Workflow templates for known domains** — `strudel-track.toml` hardcodes the instrument decomposition and dependency ordering. Reduces LLM variance, makes the demo intentional. Mastermind falls back to free LLM decomposition when no template matches.
13. **Preview launcher is MVP** — one-click launch of any worktree's app. For Strudel: start the dev server so the user hears the music. Port pool tracked in `previews` projection.
14. **Merge coordinator is serialized** — merges never run concurrently. One queue, one merge at a time, with a defined state flow and conflict escalation path. Not just "merge winning worktree → main".

---

## 17. Watchdog [MVP — taxonomy + basic loop] {#s17}

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

Merges are never run concurrently. All merge requests flow through a single serialized coordinator to prevent git conflicts between simultaneous lead merges.

### Merge flow

```
Lead reviewer completes → Lead emits MergeRequest
        ↓
MergeCoordinator receives request → appends to merge_queue (SQLite)
        ↓
Coordinator processes queue one at a time:
  1. fetch latest main
  2. git merge feat/<section> --no-ff
  3a. clean merge → emit MergeComplete, update merge_candidates projection
  3b. conflict → emit MergeConflict → escalate to user (dashboard prompt)
        ↓
User resolves conflict in dashboard → emit ConflictResolved → coordinator retries merge
        ↓
All LeadDone + all merges complete → Mastermind emits OrchestrationComplete
```

### merge_queue projection

```sql
CREATE TABLE merge_queue (
  id           INTEGER PRIMARY KEY,
  lead_id      TEXT    NOT NULL,
  winner_worktree_id TEXT NOT NULL,
  target_branch TEXT   NOT NULL DEFAULT 'main',
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending|merging|done|conflict|failed
  conflict_details JSON,
  created_at   INTEGER NOT NULL,
  merged_at    INTEGER
);
```

### State machine

`pending → merging → done | conflict → (user resolves) → retrying → done | failed`

### Key rules

- Only one merge runs at a time (in-process mutex or SQLite `status='merging'` as lock).
- Merge order follows `merge_queue` insertion order (FIFO by `created_at`).
- On conflict: coordinator pauses queue, surfaces conflict diff to dashboard, waits for user resolution. Other pending merges stay in queue.
- On merge failure (non-conflict git error): mark `failed`, notify Mastermind, continue queue.
