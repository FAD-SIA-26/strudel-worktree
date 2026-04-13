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
Lead → spawn N workers in parallel          Dashboard (React + WebSocket)
Worker monitoring (JSONL/stdout stream)     User steering mid-flight
Basic CLI: orc run, orc status              Preview launcher (port allocation)
Reviewer (pick best diff, explain why)      Cross-lead context sharing
Merge winning worktree → main               Changelog generation
                                            Outbox idempotency / degrade mode
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
| Live coordination | Redis Streams | What's happening now (rebuildable) | nice-to-have |
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
`pending → spawning → running → done | failed | retrying | cancelled`

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
- **previews** *(nice-to-have)* — worktree_id, port, url, status, launched_at
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

## 5. Redis Coordination [nice-to-have]

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

**MVP implementation:** `CodexCLIAdapter` — spawns `codex` as a child process in `ctx.worktreePath`, streams stdout to `WorkerProgress` events. On exit, writes `.orc-done.json` to the worktree root (`{ status, exitCode, ts }`), then reads git diff for the result.

**Post-MVP adapters:** `ClaudeCodeAdapter`, `OpenCodeAdapter` — same interface, drop-in swap.

---

## 9. Delegation Tree & Retry Logic

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

## 12. Web Dashboard [nice-to-have]

Three-panel layout: orchestration tree (left) · selected entity detail with comparison + actions (center) · live event stream (right). Top bar: global status + steering input.

Frontend: Vite + React. Express + WebSocket on port 4000. Requires Redis.

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
  redis/          # client.ts, streams.ts, broadcast.ts  (nice-to-have)
  git/            # worktree.ts, reconcile.ts
  dashboard/      # server.ts, routes.ts, ws.ts  (nice-to-have)
  cli.ts          # entry point: orc run, orc status, orc resume

frontend/         # nice-to-have
  src/components/ # TreePanel, DetailPanel, EventStream
  vite.config.ts

skills/
  mastermind.md · lead.md · pm-agent.md · implementer.md · reviewer.md  # MVP
  security.md · patch-worker.md                                          # post-MVP

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

## 15. Key Design Decisions

1. **Single Node.js process** — all coordination is in-process for MVP. Redis added for live dashboard.
2. **SQLite is always authoritative** — Redis rebuilt from SQLite on boot.
3. **Fresh worktree per retry** — clean isolation, `retry_of` lineage in task_edges.
4. **Completion marker** — `.orc-done.json` written by runner. Recovery never infers state from commits alone.
5. **Redis Streams, not pub/sub** — durable consumption, cursor-based reconnect, boot order safe.
6. **Outbox generation counters** — `spawn-{entity_id}-{spawn_gen}`, not permanent per entity, so crash-restart re-spawns are allowed.
7. **Worker commands always via Lead** — workers have no Redis channels. Steering routes to Lead inbox; Lead forwards via in-process queue.
8. **Skills files are first-class** — agent behavior in `skills/*.md`, not hardcoded.
