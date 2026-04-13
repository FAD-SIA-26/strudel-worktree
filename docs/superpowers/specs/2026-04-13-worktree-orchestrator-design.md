# WorkTree Orchestrator — Design Spec
*2026-04-13*

## 1. Overview

A general-purpose agentic orchestration system. A single **Mastermind** agent decomposes a user goal into sections, delegates each section to a **Lead team**, and monitors progress. Each Lead team runs a full mini-team of agents — PM, Implementers, Reviewer, Security — each Implementer operating in its own git worktree. The user interacts only with the Mastermind (via CLI or dashboard) and can steer, approve, or redirect mid-flight.

Built for the hackathon on TypeScript + Codex CLI, but agent-agnostic by design.

---

## 2. Five-Layer Architecture

| Layer | Technology | Owns |
|---|---|---|
| `event_log` | SQLite (append-only) | Durable truth — what happened |
| `projections` | SQLite (mutable tables) | Current read state — what is |
| `outbox` | SQLite (pending queue) | Pending cross-boundary work — what must happen next |
| Live coordination | Redis streams + pub/sub | What's happening right now (rebuildable) |
| Code truth | git worktrees | What was built |

**The one invariant:** every state transition writes to `event_log` + updates the relevant projection + optionally appends to `outbox` — all in a single SQLite transaction. Redis is always rebuildable from SQLite. It is never the source of truth.

---

## 3. Entity Hierarchy & State Machines

```
Mastermind
└── SectionLead (one per section, e.g. "bass", "drums", "melody")
    ├── PM Agent          (read-only, produces sub-tasks + worker prompts)
    ├── Implementer ×N    (each owns a git worktree, runs WorkerAgent)
    ├── Reviewer          (read-only, picks best implementation)
    └── Security Agent    (read-only, can spawn a Patch Worker if critical issue found)
        └── Patch Worker? (optional, owns its own worktree)
```

### Mastermind states
`idle → planning → delegating → monitoring → merging → done | failed`

### SectionLead states
`idle → planning → running → reviewing → securing → merging → done | failed | escalated`

### Implementer/Worker states
`pending → spawning → running → done | failed | retrying | cancelled`

### PM / Reviewer / Security states
`idle → running → done | failed`

**Commands flow down** (Mastermind → Lead → Worker).
**Events flow up** (Worker → Lead → Mastermind).
All events are also mirrored to `orchestration:broadcast` → WebSocket → dashboard.

---

## 4. SQLite Schema

### 4.1 event_log (append-only journal)
```sql
CREATE TABLE event_log (
  id          INTEGER PRIMARY KEY,
  entity_id   TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,  -- mastermind|lead|worker|pm|reviewer|security
  event_type  TEXT    NOT NULL,
  sequence    INTEGER NOT NULL,  -- monotonic per entity_id
  payload     JSON    NOT NULL,
  ts          INTEGER NOT NULL,
  UNIQUE(entity_id, sequence)
);
```

### 4.2 Projections (current read state)

Initial set — exact schema evolves during implementation, categories are fixed:

- **tasks** — entity id, type, parent_id, state, retry_count, task_prompt, strategy
- **runs** — currently executing agents, adapter type, pid, started_at, last_output_ts
- **worktrees** — worker_id, path, branch, base_branch, git_status, diff_summary
- **previews** — worktree_id, port, url, status, launched_at
- **merge_candidates** — lead_id, winner_worker_id, target_branch, reviewer_reasoning
- **task_edges** *(likely extra)* — parent_id, child_id, dependency type (for ordering)
- **agent_sessions** *(likely extra)* — entity_id, adapter, pid, status

### 4.3 outbox (pending side effects)
```sql
CREATE TABLE outbox (
  id          INTEGER PRIMARY KEY,
  effect_type TEXT    NOT NULL,  -- redis_publish|agent_spawn|preview_launch|merge_job
  payload     JSON    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed
  created_at  INTEGER NOT NULL,
  processed_at INTEGER
);
```

All writes to `event_log` + relevant projection + `outbox` (if needed) happen in a **single SQLite transaction**.

---

## 5. Redis Coordination

| Channel / Stream | Direction | Purpose |
|---|---|---|
| `lead:<id>:inbox` | commands → Lead | Spawn, Retry, Abort, Pause, ForceApprove |
| `lead:<id>:events` | Lead → Mastermind | LeadDone, LeadFailed, ReviewComplete, etc. |
| `orchestration:broadcast` | any → dashboard | All events mirrored here for WebSocket fanout |

**Redis channels exist only for Leads, not Workers.** Lead↔Worker coordination uses in-process async queues (no Redis). Internal module calls within a Lead are direct function calls. Mastermind subscribes to all `lead:*:events` channels.

Redis is always rebuilt from SQLite on startup. If Redis is unavailable on boot, startup fails fast with a clear error.

---

## 6. Outbox Processor

A background loop (always running) that:
1. Polls `outbox WHERE status='pending'` every ~50ms
2. Executes the side effect (Redis publish / agent spawn / preview launch / merge job)
3. Marks the entry `done` on success, `failed` on error (with retry up to N times)

Covers the gap between "SQLite write" and "side effect happens". On crash, any `pending` entries are replayed on next boot before any entity coroutines restart.

---

## 7. Crash Recovery — Boot Sequence

1. Open SQLite, run schema migrations if needed
2. Connect Redis, verify reachable
3. Load all entities from projections → reconstruct dependency tree in memory
4. Classify each entity: `done/failed` → skip | `running/retrying` → resume | `pending` → check if parent is ready
5. Reconcile worktrees: run `git worktree list`, cross-reference against `worktrees` projection
   - Worktree exists + branch has commits → emit `WorkerDone` (Codex finished, event was lost)
   - Worktree exists + uncommitted changes → re-spawn agent to continue
   - Worktree exists + empty → re-spawn agent from scratch
   - Worktree missing → re-create, re-spawn agent from scratch
6. Drain outbox: replay all `pending` entries before anything else proceeds
7. Repopulate Redis from projections
8. Start dashboard server + WebSocket
9. Re-instantiate live entity coroutines, resubscribe to Redis channels
10. Ready — orchestration continues

---

## 8. Agent Runner Interface

```typescript
interface WorkerAgent {
  run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult>
  abort(): Promise<void>
}

interface WorkerTask {
  id: string
  prompt: string        // generated by PM agent
  maxRetries: number
  strategy?: string     // hint for retry — changes approach, not just retries
  errorHistory: string[] // prior attempt errors, appended to retry prompt
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

**First implementation:** `CodexCLIAdapter` — spawns `codex` as a child process in `ctx.worktreePath`, streams stdout to `WorkerProgress` events, reads git diff on exit.

**Future adapters:** `ClaudeCodeAdapter`, `OpenCodeAdapter` — same interface, drop-in swap.

---

## 9. Delegation Tree & Retry Logic

### Retry levels

**Level 1 — Worker (automatic):**
`WorkerFailed` → `retry_count < maxRetries` → re-spawn same worktree with full error history appended to prompt. On exhaustion → emit `WorkerExhausted` → escalate to Lead.

**Level 2 — Lead (strategic):**
On `WorkerExhausted` → LLM picks a new strategy based on all prior errors → spawn fresh worker with new strategy hint. If all strategies exhausted → emit `LeadFailed` → escalate to Mastermind.

**Level 3 — Mastermind:**
On `LeadFailed`: spawn fresh Lead team with revised task, or mark section optional and continue, or emit `OrchestrationFailed` and notify user.

**Error context threading:** every retry prompt includes the full error history from prior attempts. The agent sees what was tried, not just "try again".

---

## 10. Utility Layer

### ContextManager
Builds rich LLM context for each agent call. Four main builders:

- `buildMastermindCtx()` — user goal + project file tree + git log
- `buildLeadCtx(leadId)` — section task + sibling lead summaries (read from projections) + prior attempt errors
- `buildReviewerCtx(leadId)` — all worker diffs + acceptance criteria
- `buildSecurityCtx(leadId)` — winning diff + security checklist
- `routeDirective(text)` — NL user directive → target entity + command type

**Cross-lead context:** Leads do not communicate directly. Each Lead reads sibling entity states and summaries from SQLite projections (read-only). The Mastermind mediates if a Lead needs a blocking dependency.

### User Steering (mid-flight)
The user sends natural language directives via dashboard or `orc steer "..."`. The Mastermind's `routeDirective()` parses intent and routes as a typed command to the appropriate entity's inbox:

| Directive | Routes to | Command |
|---|---|---|
| "make the bass darker" | bass-lead | `InjectConstraint` |
| "drop bass-v2" | bass-v2 worker | `Abort` |
| "bass-v1 is perfect, ship it" | bass-lead | `ForceApprove` |
| "add a guitar section" | mastermind | `SpawnLead` |

### Output Artifacts
- **Orchestration report** — per-lead: variations tried, winner, reviewer reasoning, security findings. JSON + human-readable summary.
- **Changelog** — AI-generated per-lead summary from winning diff, aggregated into a final commit message.
- **Runnable preview** — any worktree launchable one-click from dashboard. Port assigned per worktree, tracked in `previews` projection.

---

## 11. Agent Skills Files

Each agent has a `skills/<agent>.md` file defining its system prompt, tools, and context schema. These are loaded at agent spawn time and injected as system context.

```
skills/
├── mastermind.md
├── lead.md
├── pm-agent.md
├── implementer.md       # base template — Codex-specific override in agents/codex-cli.ts
├── reviewer.md
├── security.md
└── patch-worker.md
```

### Skills file format (each file)
```markdown
# <AgentName> Skills

## Role
One paragraph: what this agent is, what it does, what it must not do.

## Tools
- list of tools/capabilities available to this agent

## Context schema
What fields are injected into the context at runtime (from ContextManager).

## Output schema
Structured output format expected (JSON where applicable).

## Constraints
Hard rules the agent must follow regardless of instructions.
```

### Source guidance per agent

| Agent | Starting point |
|---|---|
| `mastermind.md` | Custom — task decomposition + delegation logic is system-specific |
| `lead.md` | Custom — coordination pattern is system-specific |
| `pm-agent.md` | Adapt from: OpenAI PM/planning prompt patterns; Linear-style issue decomposition |
| `implementer.md` | Codex built-in system prompt + task-specific prefix; search community Codex prompt repos for implementation patterns |
| `reviewer.md` | Adapt from: community code review prompts (e.g. CR-GPT patterns, conventional comments) |
| `security.md` | Adapt from: OWASP LLM Top 10 checklist prompts; Semgrep rule descriptions as context |
| `patch-worker.md` | Adapt from: `implementer.md` + security fix prefix; targeted, minimal change constraint |

---

## 12. Web Dashboard

Three-panel layout served by Express + WebSocket on a configurable port (default `4000`).

**Left panel:** Orchestration tree (Mastermind → Leads → Workers) with live status badges. Expandable per lead. Launch preview button per worker.

**Center panel:** Selected entity detail.
- For a Lead: reviewer verdict, side-by-side code comparison of worker variations, approve/spawn/drop action buttons.
- For a Worker: diff view, agent output log, retry/abort controls.

**Right panel:** Live event stream from `orchestration:broadcast` Redis channel via WebSocket.

**Top bar:** Global status + steering input (natural language, routes to Mastermind).

Frontend: Vite + React. WebSocket client subscribes to dashboard server, which subscribes to Redis broadcast.

---

## 13. Project Structure

```
src/
  core/           # pure types, no I/O — events, commands, states, types
  db/             # SQLite: journal.ts, outbox.ts, queries.ts, projections/
  orchestrator/   # mastermind.ts, lead.ts, worker.ts, context.ts, recovery.ts
  agents/         # types.ts (WorkerAgent interface), codex-cli.ts, mock.ts
  redis/          # client.ts, streams.ts, broadcast.ts
  git/            # worktree.ts, reconcile.ts
  dashboard/      # server.ts, routes.ts, ws.ts
  cli.ts          # entry point

frontend/
  src/
    components/   # TreePanel, DetailPanel, EventStream
    ws.ts, App.tsx
  vite.config.ts

skills/           # agent skills files (see §11)
docs/
  superpowers/specs/  # this file and future specs
```

**Import direction:** `core` ← imported by everything, imports nothing. No circular deps.

---

## 14. CLI

```bash
orc run "build a lo-fi track"     # start new orchestration
orc resume                         # resume after shutdown/crash
orc steer "make bass darker"       # send directive to mastermind
orc approve bass-v1                # force-approve a worktree
orc preview bass-v2                # launch preview for a worktree
orc status                         # show current orchestration state
orc dashboard                      # open dashboard in browser
```

---

## 15. Key Design Decisions (summary)

1. **Single Node.js process** — Mastermind, Leads, Workers are async coroutines. Only `CodexCLIAdapter` spawns external processes. Makes recovery simple.
2. **SQLite is always authoritative** — Redis is never the source of truth. If Redis goes down and comes back, it is rebuilt.
3. **Transactional outbox** — journal + projection + outbox in one SQLite transaction. Crash between write and side effect? Outbox replays it.
4. **Hierarchical delegation with strategic retry** — Workers retry with error history. Leads escalate with strategy change. Mastermind has final say.
5. **Agent-agnostic runner** — `WorkerAgent` interface is the only contract. Codex CLI is the first adapter; Claude Code, OpenCode etc. slot in without touching the orchestrator.
6. **Skills files are first-class** — every agent's behavior is defined in a `skills/*.md` file, not hardcoded in the orchestrator. Swap prompts without touching orchestration logic.
