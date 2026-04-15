# Dashboard Entity Detail Rendering And Live Logs — Design Spec
*2026-04-15 · v1*

---

## 0. Goal

Make the dashboard entity detail panel real instead of placeholder-driven.

When the user clicks a worker, the dashboard should render:
- the worker's actual plan markdown
- the worker's actual git diff
- the worker's actual Codex session logs, live, from `.orc/.orc-session.jsonl`

When the user clicks a lead, the dashboard should render:
- the lead's actual plan markdown
- the selected winner's actual diff
- the lead's own activity logs only, live, from the journal

This feature must also replace stale `.worktrees/...` hints with resolved paths derived from current runtime metadata, especially the current `.orc/worktrees/...` layout.

---

## 1. Current State

The current implementation already has most of the raw data, but the dashboard does not expose it correctly.

### What exists now

- Worker worktree metadata is stored in the `worktrees` projection with `path`, `branch`, and `baseBranch`.
- Worker session output is written by `CodexCLIAdapter` to `<worktree>/.orc/.orc-session.jsonl`.
- Worker and lead plan files are written to disk by `planFiles.ts`.
- Worker completion diffs are already available via git worktree helpers.
- Lead activity is already journaled in `event_log`.

### What is broken now

- [apps/web/src/components/DetailPanel.tsx](/home/cbosle/hackatons/strudel-worktree/apps/web/src/components/DetailPanel.tsx) renders placeholder `Plan` and `Logs` tabs with hard-coded path strings instead of actual content.
- The current logs tab does not read or stream any real data.
- The current plan tab does not render markdown content.
- There is no inline diff tab.
- Path hints are interpolated in the client and still reflect stale assumptions instead of resolved metadata.
- The `artifacts` projection exists, but `upsertArtifact()` is currently unused, so the dashboard has no artifact-backed file registry.

---

## 2. Product Requirements

### 2.1 Worker detail requirements

When a worker is selected:
- `Plan` shows the real contents of `.orc/worker-plan.md`.
- `Logs` shows the real contents of `.orc/.orc-session.jsonl`.
- `Logs` continues updating while the worker is running.
- `Diff` shows the real git diff for that worker's worktree against its recorded base branch.
- `Preview` continues to work as today.

### 2.2 Lead detail requirements

When a lead is selected:
- `Plan` shows the real lead plan markdown.
- `Logs` shows only lead-owned activity.
- `Logs` updates live as new lead events are journaled.
- `Diff` shows only the currently selected winner's diff.
- `Compare` remains focused on winner selection and preview actions.

### 2.3 Path and artifact requirements

- The dashboard must stop assembling filesystem paths in the client.
- Returned file paths must come from backend resolution.
- Plan and log file paths must be artifact-backed where applicable.
- Worker worktree roots must come from the `worktrees` projection.
- The UI must display the actual current `.orc/worktrees/...` layout when that is the resolved runtime path.

### 2.4 Empty-state requirements

The API and UI must distinguish:
- not created yet
- not selected yet
- missing due to inconsistency
- unavailable because a git/file read failed

The dashboard must render these states clearly inside the tab instead of showing fake shell commands.

---

## 3. Source Of Truth

This feature should not create a second copy of logs or diffs in SQLite. The correct approach is read-from-source with live streaming.

### Worker sources

- Worktree root: `worktrees.path`
- Plan file: worker artifact record for `worker_plan`, falling back to `<worktrees.path>/.orc/worker-plan.md` only for backward compatibility
- Session log file: worker artifact record for `session_log`, falling back to `<worktrees.path>/.orc/.orc-session.jsonl` only for backward compatibility
- Diff: computed from the worker worktree path and recorded base branch

### Lead sources

- Plan file: lead artifact record for `lead_plan`, falling back to `.orc/runs/<runId>/leads/<sectionId>.md` only for backward compatibility
- Logs: `event_log` rows filtered to the lead entity only
- Diff: `merge_candidates.winner_worker_id -> worktrees -> git diff`

### Artifact policy

This feature should make the `artifacts` table real.

Required artifact types:
- `run_plan`
- `lead_plan`
- `worker_plan`
- `session_log`

Artifact upsert timing:
- `createRunPlan()` upserts `run_plan` immediately after writing `.orc/runs/<runId>/run-plan.md`
- `createLeadPlan()` upserts `lead_plan` immediately after writing `.orc/runs/<runId>/leads/<sectionId>.md`
- `createWorkerPlan()` upserts `worker_plan` immediately after writing `<worktree>/.orc/worker-plan.md`
- worker session initialization in `CodexCLIAdapter` upserts `session_log` as soon as `<worktree>/.orc/.orc-session.jsonl` is opened for append

Plan creation and worker session initialization should upsert these artifact rows when files are created.

This gives the API a stable path registry and removes path guessing from the client.

---

## 4. Backend Architecture

The lightweight orchestration tree returned by `GET /api/orchestration` should stay lightweight. Entity detail content should move to dedicated APIs.

### 4.0 Entity ID convention

`GET /api/entities/:entityId/...` uses the current `tasks.id` value as the route identifier for both workers and leads.

That means:
- worker `entityId` is the same identifier currently used in the dashboard selection state (`selectedId`) and the same value stored as `worktrees.worker_id`
- lead `entityId` remains the current lead task ID format, `<sectionId>-lead`

This slice does not introduce a second public alias such as plain `sectionId` for lead detail routes. The response's `entityType` discriminator is for rendering behavior, not for changing route-ID conventions.

### 4.1 Detail endpoint

Add:

`GET /api/entities/:entityId/detail`

This endpoint returns the non-streaming content required to render the selected tab set.

Proposed response shape:

```ts
type EntityDetail =
  | {
      entityId: string
      entityType: 'worker'
      title: string
      resolvedPaths: {
        worktreePath: string
        planPath: string | null
        logPath: string | null
      }
      plan: {
        status: 'ready' | 'missing' | 'error'
        content: string | null
        message?: string
      }
      diff: {
        status: 'ready' | 'empty' | 'missing' | 'error'
        content: string | null
        branch?: string
        baseBranch?: string
        message?: string
      }
    }
  | {
      entityId: string
      entityType: 'lead'
      title: string
      resolvedPaths: {
        planPath: string | null
        winnerWorktreePath: string | null
      }
      plan: {
        status: 'ready' | 'missing' | 'error'
        content: string | null
        message?: string
      }
      diff: {
        status: 'ready' | 'empty' | 'missing' | 'error'
        content: string | null
        winnerWorkerId: string | null
        branch?: string
        baseBranch?: string
        message?: string
      }
    }
```

### 4.2 Initial logs endpoint

Add:

`GET /api/entities/:entityId/logs`

This returns a recent window for initial render and reconnection recovery.

Default behavior:
- default window: last `500` entries
- maximum supported `limit`: `1000`
- response order: oldest-first
- the client appends streamed entries to the bottom of the list

The response also returns a concrete tail cursor for the live stream.

```ts
type LogsResponse = {
  entries: LogEntry[]
  tailCursor: string | null
}
```

### 4.3 Live log stream endpoint

Add:

`GET /api/entities/:entityId/logs/stream`

The stream accepts `after=<tailCursor>` from the initial logs response. If `after` is omitted, the stream begins at the current live tail boundary and only emits newly observed entries.

Use Server-Sent Events for the first implementation.

Why SSE:
- one-way streaming fits the use case
- simpler than extending the current WebSocket flow
- easier reconnection behavior for a single tail stream
- clean separation from the existing orchestration-state WebSocket updates

### 4.4 Log normalization

The client should not care whether the source is JSONL or SQLite rows.

Both worker and lead logs should stream a shared normalized shape:

```ts
type LogEntry = {
  id: string
  ts: number
  kind: 'stdout' | 'stderr' | 'codex_event' | 'lead_event'
  title: string
  body: string
  raw: string
}
```

`LogEntry.id` rules:
- worker log entries use append-only 1-based line numbering from the session file: `${entityId}:line:${lineNumber}`
- lead log entries use the durable SQLite row ID: `${entityId}:event:${eventLogId}`

`tailCursor` rules:
- workers use the last emitted session-file line number, encoded as `line:<n>`
- leads use the last emitted `event_log.id`, encoded as `event:<id>`

Worker normalization rules:
- JSON lines with `error` become `stderr`
- JSON lines with `output` that contain Codex JSON payloads become `codex_event`
- plain output becomes `stdout`

Lead normalization rules:
- `event_log` rows become `lead_event` only when `entity_id = :entityId AND entity_type = 'lead'`
- `title` comes from `eventType`
- `body` is a formatted view of the event payload
- `raw` contains the original serialized payload

---

## 5. Resolution Helpers

The backend should add focused helpers instead of embedding this logic directly in route handlers.

### 5.1 Worker resolution

Responsibilities:
- find worker row in `tasks`
- resolve worktree from `worktrees`
- resolve plan artifact path
- resolve session-log artifact path
- read plan content
- compute diff content

### 5.2 Lead resolution

Responsibilities:
- resolve lead plan artifact path
- read lead plan content
- resolve selected winner from `merge_candidates`
- resolve selected winner worktree from `worktrees`
- compute winner diff

### 5.3 Log readers

Two small modules should own log reading:

- worker session reader
  - parse `.orc-session.jsonl`
  - tail recent entries
  - stream appended entries
- lead journal reader
  - query recent `event_log` rows
  - subscribe/filter future lead-only events

These modules should return normalized `LogEntry` objects so the route layer stays thin.

---

## 6. UI Design

`DetailPanel` should become a real entity viewer driven by the new entity-detail API and the live log stream.

### 6.1 Worker tabs

Worker tab set:
- `Plan`
- `Logs`
- `Diff`
- `Preview`

Behavior:
- `Plan` renders markdown content inline in a scrollable panel.
- `Logs` loads an initial tail window, then appends streamed entries in real time.
- `Diff` renders full diff text inline.
- `Preview` keeps current preview actions, but preview URLs remain sourced from the orchestration snapshot plus the existing preview-launch route in this slice.

Preview source-of-truth decision for this slice:
- plan, log, diff, and resolved path content come from `GET /api/entities/:entityId/detail` plus the log endpoints
- preview URLs remain sourced from `GET /api/orchestration`
- `GET /api/entities/:entityId/detail` does not duplicate `previewArtifacts`

### 6.2 Lead tabs

Lead tab set:
- `Compare`
- `Plan`
- `Logs`
- `Diff`

Behavior:
- `Compare` keeps current winner-selection behavior.
- `Plan` renders real markdown content.
- `Logs` renders lead-only events.
- `Diff` renders the selected winner's diff only.

### 6.3 Shared rendering rules

- Show the resolved file path above `Plan` and `Logs` when available.
- Show precise empty states when content is not available.
- Do not show shell commands like `tail -f ...` as substitutes for real content.
- Preserve entity-specific tabs so clicking a worker versus a lead always feels stable.

---

## 7. Live Log Behavior

### 7.1 Worker logs

Worker logs are the real Codex session stream. The UI should not synthesize or summarize away the underlying content.

Required behavior:
- open with the most recent available window
- append new entries as the file grows
- tolerate the log file not existing yet
- keep raw content visible
- visually distinguish stdout, stderr, and structured Codex events

### 7.2 Lead logs

Lead logs are journaled activity, not a second Codex session.

Required behavior:
- filter strictly to the selected lead entity
- include planning/review/selection/merge-related lead events
- exclude worker events entirely
- stream new matching events live

### 7.3 Reconnection

On refresh or SSE reconnect:
- the client refetches the initial tail window from `GET /api/entities/:entityId/logs`
- the response returns `tailCursor`
- the client opens `GET /api/entities/:entityId/logs/stream?after=<tailCursor>`
- incoming entries deduplicate by `LogEntry.id`

The first cut does not need durable cross-session cursor persistence beyond this replay-and-resume flow.

---

## 8. Error Handling

The API should return structured states instead of collapsing all failures into 404s.

Examples:
- worker selected, but session log not created yet
- worker selected, but worktree row missing
- lead selected, but no winner selected yet
- lead selected, winner exists, but winner worktree missing
- plan path resolved, but file cannot be read
- diff resolution failed because git command failed

The UI should render these as:
- `Not created yet`
- `No selected winner yet`
- `Metadata inconsistent`
- `Read failed`

Each empty/error state should include a short explanatory message from the API.

---

## 9. File And Module Plan

Likely backend changes:
- [apps/api/src/server/routes.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/server/routes.ts)
- [apps/api/src/server/routes.test.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/server/routes.test.ts)
- [apps/api/src/db/queries.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/db/queries.ts)
- [apps/api/src/git/planFiles.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/git/planFiles.ts)
- [apps/api/src/agents/codex-cli.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/agents/codex-cli.ts)
- [apps/api/src/runtime/paths.ts](/home/cbosle/hackatons/strudel-worktree/apps/api/src/runtime/paths.ts)

Likely new backend modules:
- entity detail resolver
- worker session-log reader/tailer
- lead journal-log reader/streamer

Likely shared type changes:
- [packages/types/src/api.ts](/home/cbosle/hackatons/strudel-worktree/packages/types/src/api.ts)

Likely web changes:
- [apps/web/src/components/DetailPanel.tsx](/home/cbosle/hackatons/strudel-worktree/apps/web/src/components/DetailPanel.tsx)
- [apps/web/src/hooks/useOrchestration.ts](/home/cbosle/hackatons/strudel-worktree/apps/web/src/hooks/useOrchestration.ts)
- one new hook for entity detail
- one new hook for log loading and streaming

---

## 10. Testing Strategy

### 10.1 API tests

Add route coverage for:
- worker detail returns real plan content, resolved paths, and diff
- lead detail returns real plan content and selected-winner diff
- worker logs return parsed session entries
- lead logs return lead-only journal entries
- missing plan/log/winner states return structured empty states

### 10.2 Backend unit tests

Add focused tests for:
- artifact-backed plan resolution
- artifact-backed session-log resolution
- worker session JSONL parsing
- lead event filtering
- winner diff resolution

### 10.3 Web tests

Add `DetailPanel` coverage for:
- worker tabs rendering inline plan/log/diff content
- lead tabs rendering inline plan/log/diff content
- entity-specific empty states

### 10.4 Manual verification

Manual acceptance for this feature:
- start a live run
- click a running worker
- verify log entries append in real time
- verify plan content is real markdown
- verify diff content is real git diff
- click a lead
- verify only lead-owned activity appears in `Logs`
- verify `Diff` shows the selected winner only
- verify displayed paths resolve to `.orc/worktrees/...` when that is the active layout

---

## 11. Non-Goals

This feature does not:
- add worker logs into the lead log view
- add a multi-worker diff compare tab under leads
- persist a second copy of worker session logs in SQLite
- redesign the tree panel or compare workflow
- replace the current orchestration WebSocket transport

---

## 12. Recommendation

Implement this as read-from-source detail rendering with SSE log streaming.

That gives the dashboard truthful content with minimal duplication:
- workers read real files from resolved worktrees
- leads read real journal entries
- diffs come from git, not cached blobs
- paths come from artifacts and worktree metadata, not client-side guesswork

This directly fixes the product gap without inventing another persistence model to keep in sync.
