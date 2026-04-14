# WorkTree Orchestrator (`orc`)

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

Watch everything in the dashboard at **http://localhost:3000** — live tree, event stream, per-lead compare view with ♪ Listen buttons.

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 — `npm install -g pnpm`
- **Git** ≥ 2.30 (for `git worktree`)
- **Codex CLI** — `npm install -g @openai/codex` (skip if using `--mock`)
- An **OpenAI-compatible API key** (skip if using `--mock`)

> **corepack conflict?** If your system has `yarn` set as the default package manager, prefix all `pnpm` commands with `COREPACK_ENABLE_STRICT=0`, or run `corepack disable` once to remove the restriction.

---

## Option A: Use `orc` globally (recommended)

Link globally — adds `orc` to your PATH. No build step needed; the wrapper uses `tsx` to run TypeScript directly.

```bash
git clone <this-repo>
cd worktree-orchestrator

# Install dependencies
pnpm install

# Generate SQLite migrations
cd apps/api && pnpm db:generate && pnpm db:migrate && cd ../..

# Link globally — adds `orc` to your PATH
cd apps/api && npm link && cd ../..
```

Verify it works:

```bash
orc --version    # should print 0.1.0
orc status       # prints empty task table (no runs yet)
```

Now `orc` is available from **any directory** on your machine. Run it from the root of the repo you want to orchestrate:

```bash
cd /your/project
orc run "build a lo-fi track" --mock --run-id test-1
```

---

## Option B: Run directly from this repo (development)

No build needed — uses `tsx` to run TypeScript directly.

```bash
git clone <this-repo>
cd worktree-orchestrator
pnpm install
cd apps/api && pnpm db:generate && pnpm db:migrate
```

Then from `apps/api/`:

```bash
# Using the npm script shorthand
pnpm orc run "build a lo-fi track" --mock

# Or directly
node_modules/.bin/tsx src/cli.ts run "build a lo-fi track" --mock
```

---

## Configuration

Set these in your shell, or create a `.env` file in the directory where you run `orc`:

```bash
# Required for real LLM calls (skip if using --mock)
export OPENAI_API_KEY=sk-...

# Optional — defaults to OpenAI gpt-4o
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4o

# Optional — defaults shown
export ORC_DB_PATH=./orc.db    # SQLite DB (written to current directory)
export ORC_PORT=4000            # API + WebSocket port
```

For the dashboard frontend, create `apps/web/.env.local` in the orchestrator repo:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

---

## Usage

### Start an orchestration run

```bash
# Dry run — MockAgent + built-in LLM stub, no API key needed
orc run "lo-fi hip-hop track" --mock

# Real run with Codex + LLM
orc run "lo-fi hip-hop track" --template strudel-track

# Custom run ID and worker cap
orc run "lo-fi hip-hop track" \
  --template strudel-track \
  --run-id demo-1 \
  --max-workers 6
```

`orc run` automatically starts the API server on `ORC_PORT` (default 4000). Open the dashboard while it runs.

### Open the dashboard

In a second terminal, from the orchestrator repo:

```bash
cd apps/web
pnpm dev
```

Open **http://localhost:3000**

- **Left panel** — orchestration tree: mastermind → leads → workers with live health states
- **Center panel** — select a lead → **Compare tab**: listen to each variant (♪ Listen), approve the winner (✓ Pick this). Select a worker for plan/logs/preview.
- **Right panel** — live event stream

### Approve a variation

Click any lead in the tree → **Compare tab** → listen to each variant → click **✓ Pick this** to force-approve before the reviewer finishes.

### Drop a worker

Click a worker → **✕ Drop** in the header. The Abort command is queued to the owning lead.

### Preview a Strudel variation

When a worker completes, click **▶ preview** on its card. Opens the Strudel playground with that worker's generated code pre-loaded.

### Check current state

```bash
orc status
```

Prints a table of all tasks and their states from SQLite.

### Resume after a restart

```bash
orc resume
```

Restarts the API server and loads persisted state from SQLite. In-flight task states are visible in the dashboard.

> [DEGRADED] Full worktree reconciliation is post-MVP — use this to re-attach the dashboard after a crash.

---

## Workflow templates

Templates live in `templates/`. The included template:

**`strudel-track.toml`** — 5 instrument lanes with dependency ordering:

```
drums ──────────────────────────────────┐
bass  ──────────── chords ── melody ────┤── arrangement
```

- `drums` and `bass` run in parallel (no dependencies)
- `chords` waits for `bass`; `melody` waits for `chords`
- `arrangement` waits for all four — imports each section file

Each section spawns 2–3 parallel workers. Each worker writes **only** to its own file (`src/drums.js`, `src/bass.js`, etc.) — merge conflicts between sections are impossible by design.

### Run with the Strudel template

```bash
orc run "lo-fi hip-hop track, 90bpm, key Dm" --template strudel-track
```

### Freeform decomposition (no template)

```bash
orc run "build a REST API for a todo app"
```

The Mastermind calls the LLM to decompose the goal from scratch.

---

## Agent skills

Skills live in `skills/` (in the orchestrator repo) — one markdown file per agent role. These are the system prompts injected at agent spawn time.

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
  api/          Express orchestrator + REST API + WebSocket (the orc binary)
  web/          Next.js dashboard (App Router)

packages/
  types/        @orc/types — canonical Zod schemas (shared contract)
  config/       @orc/config — shared Biome/ultracite lint config

skills/         Agent system prompts (one .md per role)
templates/      Workflow decomposition templates (.toml)

docs/
  superpowers/
    specs/      Design specification (19 sections)
    plans/      Implementation plan
```

When `orc` runs in a target repo, it creates:

```
<target-repo>/
  orc.db              SQLite state (gitignored)
  .orc/
    runs/<run-id>/
      run-plan.md     Mastermind plan artifact
      leads/
        <section>.md  Per-section lead plans
  .worktrees/
    <run-id>-<section>-v<n>/   Per-worker git worktrees
    run-<run-id>/              Integration branch worktree
```

---

## Development

```bash
# Run tests (from apps/api — tests live there)
cd apps/api && pnpm test

# Run a specific test
cd apps/api && pnpm test src/integration.test.ts

# Re-link after source changes (no rebuild needed — tsx runs source directly)
cd apps/api && npm link

# Regenerate SQLite migrations after schema changes
cd apps/api && pnpm db:generate

# Lint everything (from repo root)
pnpm lint
```

> `pnpm test` from the repo root does not currently work due to corepack workspace resolution. Always run tests from `apps/api` directly.

### Adding a new event type

1. Add the Zod schema to `packages/types/src/events.ts`
2. Add it to `OrcEventSchema` discriminated union
3. Add the eventType string to the canonical vocabulary in the design spec

The frontend `applyEvent()` and event stream color map pick it up automatically.

---

## Architecture in one diagram

```
User (in any repo)
 │
 ▼
orc run "goal"   ← runs from process.cwd() as repoRoot
 │
 ▼
MastermindStateMachine
 ├── git branch run/<id>              (no checkout — safe)
 ├── addWorktreeForBranch run/<id>    (dedicated merge worktree)
 ├── LLM decompose → [sections]
 └── for each batch (topological order):
      │
      ▼
      LeadStateMachine (one per section)
       ├── CommandQueue (ForceApprove/Abort from dashboard)
       ├── PM agent LLM call → N worker prompts
       └── WorkerStateMachine × N (parallel, gated by governor)
            ├── createWorktree(".worktrees/{runId}-{section}-v{n}")
            ├── createWorkerPlan(".orc/worker-plan.md")
            ├── CodexCLIAdapter (spawns codex → .orc-session.jsonl)
            └── writeDoneMarker(".orc/.orc-done.json")
       │
       └── Reviewer → ReviewComplete → MergeRequested
 │
 ▼
MergeCoordinator (serialized FIFO, merges into run/<id> worktree)
 ├── git merge feat/{runId}-{section}-v{n} → run/<id>
 └── conflict? → MergeConflict event surfaced in dashboard
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
| Full crash recovery | [DEGRADED] — `orc resume` reloads state, no worktree reconciliation |
| Preview | [DEGRADED] — generates a Strudel playground URL, no local dev-server |
| NL steering | [POST-DEMO] — `/api/steer` accepted but not routed to entity queues |
| Security agent | [POST-DEMO] |
| Redis / multi-process scaling | [POST-DEMO] — in-memory event bus is sufficient for demo |

---

## License

MIT
