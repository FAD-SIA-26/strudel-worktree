# WorkTree Orchestrator

A hierarchical multi-agent orchestration system. One command decomposes your goal into parallel sections, spawns Codex workers in isolated git worktrees, reviews the outputs, and merges the best results into a final branch — all visible in a live web dashboard.

Built for the hackathon on top of Codex CLI. Ships with a Strudel.js music demo template.

---

## How it works

```
orc run "build a lo-fi track" --template strudel-track
```

1. **Mastermind** calls an LLM to decompose your goal into sections (drums, bass, chords, melody, arrangement)
2. **Leads** spawn parallel Codex workers — each in its own git worktree — gated by `maxConcurrentWorkers`
3. Each **Worker** runs Codex, writes code to `src/<section>.js`, emits progress to the live dashboard
4. A **Reviewer** picks the best variation per section
5. The **Merge Coordinator** serializes all winners into a `run/<id>` branch, then fast-forwards to `main`

Watch everything in the dashboard at `http://localhost:3000` — live tree, event stream, per-lead compare view with ♪ Listen buttons.

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 — `npm install -g pnpm`
- **Git** ≥ 2.30 (for `git worktree`)
- **Codex CLI** — `npm install -g @openai/codex` (or use `--mock` for a dry run without Codex)
- An **OpenAI-compatible API key** (or set `OPENAI_BASE_URL` to point at a local model)

> **Note:** if your system has `yarn` configured as the default package manager via corepack, prefix pnpm commands with `COREPACK_ENABLE_STRICT=0`.

---

## Installation

```bash
git clone <this-repo>
cd worktree-orchestrator

# Install all workspace dependencies
pnpm install

# Generate the SQLite migrations
pnpm db:generate && pnpm db:migrate
```

---

## Configuration

Copy the example env file or set these variables in your shell:

```bash
# Required for real LLM calls (skip if using --mock)
export OPENAI_API_KEY=sk-...

# Optional — defaults to OpenAI
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-5.4

# Optional — defaults shown
export ORC_DB_PATH=./orc.db          # SQLite database file
export ORC_PORT=4000                  # API + WebSocket port
```

For the dashboard frontend, create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

---

## Usage

### Start an orchestration run

```bash
cd apps/api

# Real run with Codex + LLM
pnpm tsx src/cli.ts run "build a lo-fi track" --template strudel-track

# Dry run with MockAgent (no Codex, no API key needed — great for testing)
pnpm tsx src/cli.ts run "build a lo-fi track" --template strudel-track --mock

# Custom run ID and worker cap
pnpm tsx src/cli.ts run "build a lo-fi track" \
  --template strudel-track \
  --run-id demo-1 \
  --max-workers 6
```

The API server starts automatically on `ORC_PORT` (default 4000). Open the dashboard while it runs.

### Open the dashboard

In a second terminal:

```bash
cd apps/web
pnpm dev
```

Open **http://localhost:3000**

- **Left panel** — orchestration tree: mastermind → leads → workers with live health states
- **Center panel** — select a lead to see the Compare tab (♪ Listen + ✓ Pick this per variation); select a worker for logs/plan/preview
- **Right panel** — live event stream

### Approve a variation

Click any lead in the tree → **Compare tab** → listen to each variant → click **✓ Pick this** to force-approve before the reviewer finishes.

### Drop a worker

Click a worker → **✕ Drop** in the header. The lead's command queue receives an Abort.

### Preview a Strudel variation

When a worker completes, click **▶ preview** on its card or the **▶ Preview** button in the header. Opens the Strudel playground with that worker's generated code.

### Check current state

```bash
pnpm tsx src/cli.ts status
```

Prints a table of all tasks and their states from SQLite.

### Resume after a restart

```bash
pnpm tsx src/cli.ts resume
```

Restarts the API server and loads persisted state from SQLite. In-flight task states are visible in the dashboard. Full worktree reconciliation is post-MVP — use this to re-attach the dashboard after a crash.

---

## Workflow templates

Templates live in `templates/`. The included template:

**`strudel-track.toml`** — 5 instrument lanes with dependency ordering:

```
drums ──────────────────────────────────┐
bass  ──────────── chords ── melody ────┤── arrangement
```

- `drums` and `bass` run in parallel (no dependencies)
- `chords` waits for `bass` to complete
- `melody` waits for `chords`
- `arrangement` waits for all four — imports from each section file

Each section spawns 2–3 parallel workers. Each worker writes **only** to its own file (`src/drums.js`, `src/bass.js`, etc.) — merge conflicts by design are impossible between sections.

### Run with the Strudel template

```bash
pnpm tsx src/cli.ts run "lo-fi hip-hop track, 90bpm, key Dm" \
  --template strudel-track
```

### Freeform decomposition (no template)

```bash
pnpm tsx src/cli.ts run "build a REST API for a todo app"
```

The Mastermind calls the LLM to decompose the goal from scratch.

---

## Agent skills

Skills live in `skills/` — one markdown file per agent role. These are the system prompts injected at agent spawn time.

| File | Role |
|---|---|
| `mastermind.md` | Goal decomposition, section planning |
| `lead.md` | Section coordination, worker spawning, review |
| `pm-agent.md` | Generates distinct worker prompts per section |
| `implementer.md` | Focused implementation in worktree |
| `reviewer.md` | Picks best worker output |
| `run-planner.md` | Writes the run-plan.md artifact |
| `lead-planner.md` | Writes the lead section plan artifact |
| `worker-planner.md` | Maintains the worker task sheet |

Edit these to tune agent behavior without touching orchestrator code.

---

## Project structure

```
apps/
  api/          Express orchestrator + REST API + WebSocket
  web/          Next.js dashboard (App Router)

packages/
  types/        @orc/types — canonical Zod schemas (shared contract)
  config/       @orc/config — shared Biome/ultracite lint config

skills/         Agent system prompts (one .md per role)
templates/      Workflow decomposition templates (.toml)

docs/
  superpowers/
    specs/      Design specification (18 sections)
    plans/      Implementation plan
```

---

## Development

```bash
# Run all tests
pnpm test

# Run api tests only
cd apps/api && pnpm vitest run

# Run a specific test
cd apps/api && pnpm vitest run src/integration.test.ts

# Regenerate SQLite migrations after schema changes
pnpm db:generate

# Lint everything
pnpm lint
```

### Adding a new event type

1. Add the Zod schema to `packages/types/src/events.ts`
2. Add it to `OrcEventSchema` discriminated union
3. Add the eventType string to the vocabulary section in the design spec

The frontend's `applyEvent()` and the event stream color map pick it up automatically for known event types.

---

## Architecture in one diagram

```
User
 │
 ▼
orc run "goal"
 │
 ▼
MastermindStateMachine
 ├── createBranch("run/<id>")
 ├── LLM decompose → [sections]
 └── for each batch (topological order):
      │
      ▼
      LeadStateMachine (one per section)
       ├── CommandQueue (receives ForceApprove/Abort from dashboard)
       ├── PM agent → N worker prompts
       └── WorkerStateMachine × N (parallel, gated by governor)
            ├── createWorktree(".worktrees/<id>")
            ├── createWorkerPlan(".orc/worker-plan.md")
            ├── CodexCLIAdapter (spawns codex, streams to .orc-session.jsonl)
            └── writeDoneMarker(".orc/.orc-done.json")
       │
       └── Reviewer → ReviewComplete → MergeRequested
 │
 ▼
MergeCoordinator (serialized FIFO)
 ├── each winner → git merge feat/<section>-v<n> → run/<id>
 └── conflict? → MergeConflict event → dashboard surfaces A/B/C
 │
 ▼
fast-forward run/<id> → main
OrchestrationComplete


All state transitions → event_log (SQLite, append-only)
                      → projection tables (SQLite, read side)
                      → eventBus.publish() → WebSocket → dashboard
```

---

## Known limitations (hackathon MVP)

| Feature | Status |
|---|---|
| Merge conflict auto-repair | [POST-DEMO] — conflicts surface in dashboard, no auto-fix |
| Full crash recovery | [DEGRADED] — `orc resume` reloads state but no worktree reconciliation |
| Preview | [DEGRADED] — generates a Strudel playground URL, no local dev-server |
| NL steering | [POST-DEMO] — `/api/steer` accepted but not routed to entity queues |
| Security agent | [POST-DEMO] |
| Redis / multi-process scaling | [POST-DEMO] — single process with in-memory event bus is sufficient for demo |

---

## License

MIT
