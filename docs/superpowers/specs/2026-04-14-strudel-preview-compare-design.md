# Strudel Preview + Compare — Phase 1 Design Spec
*2026-04-14 · v1*

---

## 0. Scope

This spec covers only the first UX slice from `TODO.md`:

- Fix Strudel preview generation
- Improve the Strudel compare / listen workflow
- Define phase-1 winner-picking behavior inside the compare surface

This spec does **not** cover:

- full logs / artifacts dashboard work
- Mastermind chat / steering
- approve / drop / steer beyond what is needed for `Pick winner now`
- full retry / recovery / merge-fix behavior

The output of this phase should be a clean Strudel demo loop:

1. a lead shows multiple worker variants as cards in the dashboard
2. each finished worker can launch a browser-runnable Strudel preview
3. the user can audition `solo` and, when available, `with context`
4. the user can pick a winner immediately
5. the lead records that winner and aborts still-running sibling variants

---

## 1. Current Problems

The current implementation has three structural issues:

1. **Preview code is invalid for `strudel.cc`.**
   `apps/api/src/orchestrator/preview.ts` base64-encodes raw repo files such as `src/drums.js` or `src/index.js` and opens them in `strudel.cc`. Those files often contain ES module syntax (`export const ...`, `import ...`) because the repo stores lane code as modular source files. `strudel.cc` expects runnable browser code, not raw module files, so previews fail with parser errors.

2. **Preview state is too thin.**
   A worker currently exposes at most one `previewUrl`. That is not enough for the desired Strudel UX, which needs:
   - `solo` preview for the selected lane
   - `contextual` preview when upstream winners exist
   - explicit refresh/regeneration
   - future inspection of generated preview code

3. **Compare is present visually but not modeled strongly enough.**
   The current dashboard already has worker cards, launch buttons, and a `Pick` action, but the compare flow is still too shallow. It lacks a first-class preview artifact model and does not clearly define the lead-owned “pick winner now and abort the rest” behavior.

---

## 2. Design Goals

Phase 1 should satisfy these goals:

- **Browser-runnable previews**
  Every launched Strudel preview must contain code that can run directly in `strudel.cc`.

- **Two preview modes**
  Workers should support:
  - `solo`: the worker lane by itself
  - `contextual`: the worker lane plus currently selected upstream winner lanes when available

- **Dashboard-first compare**
  The compare experience stays in the dashboard as a list of worker cards. We do not embed Strudel in-app for this phase.

- **Lead-owned winner selection**
  Picking a winner is not just a UI label. It is an orchestration decision owned by the lead:
  - select this worker immediately
  - abort sibling workers that are still running
  - keep the winner as the lead’s current selected output

- **DRY boundaries**
  Preview composition rules should live in exactly one backend module. The dashboard should render state, not re-derive Strudel logic.

---

## 3. Recommended Architecture

Use a hybrid of a **preview composer** and **lightweight persisted preview artifacts**.

### 3.1 Source of truth

- **Git/worktree files** remain the source of code truth.
- **Lead state** remains the source of truth for which worker is currently selected as the winner.
- **Preview artifacts** are derived state: cached browser-ready outputs generated from source files plus current winner context.

### 3.2 New backend component: `StrudelPreviewComposer`

Add a dedicated backend module responsible for all Strudel-specific preview logic.

It is the **only** place that may:

- resolve which file represents a worker lane
- read lane source files from the worktree
- strip or avoid repo-specific module syntax
- build runnable preview code
- decide what `solo` versus `contextual` means
- compute artifact metadata such as `sourceFiles` and `contextWinnerIds`

This module should not know about React or dashboard state.

### 3.3 Lightweight preview artifacts

Instead of storing just one URL per worker, preview generation persists one artifact per:

- `workerId`
- `mode`

Where `mode` is:

- `solo`
- `contextual`

Each artifact stores:

- `workerId`
- `mode`
- `previewUrl`
- `generatedCode`
- `sourceFiles`
- `generatedAt`
- `contextWinnerIds` (optional, empty for solo)

These artifacts are cacheable and refreshable, but always derived from current code truth plus current winner state.

### 3.4 Persistence strategy

Preview artifacts are persisted in **SQLite projections**, not in memory.

Phase 1 adds a dedicated projection table, for example:

```sql
preview_artifacts(
  worker_id TEXT NOT NULL,
  mode TEXT NOT NULL,                -- solo | contextual
  preview_url TEXT NOT NULL,
  generated_code TEXT NOT NULL,
  source_files JSON NOT NULL,
  context_winner_ids JSON NOT NULL,  -- [] for solo
  generated_at INTEGER NOT NULL,
  PRIMARY KEY(worker_id, mode)
)
```

This is required so that:

- launched previews survive dashboard refreshes
- compare cards can show current preview availability after reconnect
- `Refresh` has an explicit persisted target to overwrite

The existing `previews` table may be replaced or evolved to support this shape, but phase 1 must end with persisted per-worker, per-mode preview artifacts in SQLite.

---

## 4. Preview Composition Rules

### 4.1 Worker file model

The current Strudel template writes modular lane files such as:

- `src/drums.js`
- `src/bass.js`
- `src/chords.js`
- `src/melody.js`
- `src/index.js` for arrangement

Lane files often look like:

```js
export const drums = sound("bd hh")
```

The arrangement file may look like:

```js
import { drums } from './drums.js'
import { bass } from './bass.js'
stack(drums, bass)
```

Those are acceptable repo files, but not acceptable preview payloads for `strudel.cc`.

### 4.2 Browser-runnable preview output

The composer must produce preview code with **no ESM syntax**.

The rule is:

- repo files may stay modular
- preview artifacts must be plain runnable Strudel snippets

That means the composer must transform modular source into inline runnable code.

#### Concrete transformation rule

For lane files, phase 1 supports exactly **one named export** that represents the lane pattern.

Example input:

```js
export const drums = sound("bd hh").gain(0.8)
```

Expected `solo` output:

```js
const drums = sound("bd hh").gain(0.8)
stack(drums)
```

Expected `contextual` output for a melody worker with existing upstream winners:

```js
const drums = sound("bd hh").gain(0.8)
const bass = note("c2 c2 g1").sound("sawtooth")
const chords = note("<[d4 f4 a4] [bb3 d4 f4]>").sound("triangle")
const melody = note("a4 c5 d5").sound("sine")

stack(drums, bass, chords, melody)
```

Rules:

- `export` is removed and converted to `const`
- `import` statements are resolved and eliminated
- preview output must end in a runnable top-level Strudel expression
- lane previews use `stack(...)` even for a single lane, so the output shape is consistent
- files with multiple named exports are invalid phase-1 preview inputs and should return a structured preview-composition error
- files with no detectable named lane export are invalid phase-1 preview inputs unless they are arrangement files handled by the arrangement path

### 4.3 Solo mode

`solo` preview means:

- read the selected worker’s lane file
- extract the exported pattern expression
- emit browser-runnable code for only that lane

For arrangement workers:

- `solo` is just the runnable arrangement code itself after module resolution / normalization

### 4.4 Contextual mode

`contextual` preview means:

- include the selected worker lane
- include currently selected winner outputs from upstream dependencies, when available

#### Dependency ownership

The dependency graph lives in the rendered workflow template, not in `StrudelPreviewComposer`.

For the current Strudel demo, that source of truth is `templates/strudel-track.toml` via each section's `depends_on` declarations.

That means:

- the composer reads dependency information from orchestration/template-derived section metadata
- the composer does **not** hardcode lane order such as `drums -> bass -> chords -> melody`
- adding a future music template should not require changing composer code just to describe dependencies

Examples:

- `bass`: usually no upstream context, so `contextual` is disabled unless future templates add dependencies
- `chords`: can be auditioned with the currently selected `bass` winner
- `melody`: can be auditioned with the currently selected `drums`, `bass`, and `chords` winners when those winners exist
- `arrangement`: may already be effectively contextual by nature, but the artifact still records its dependencies explicitly

If required dependency winners do not exist yet:

- `contextual` is unavailable
- the dashboard should disable that action rather than generating partial invalid code silently

### 4.5 Refresh semantics

`Refresh` must:

- rebuild the artifact from current worktree files
- recompute winner context
- overwrite the previous artifact for the same `(workerId, mode)` pair

No client-side preview regeneration logic is allowed.

---

## 5. Dashboard UX

### 5.1 Compare surface

Keep the existing compare model: one card per worker variant inside a lead detail view.

Each worker card should show:

- worker id
- worker state
- winner badge when selected
- actions appropriate to current state

### 5.2 Card actions

For `done` workers:

- `Launch solo`
- `Launch with context` when context exists
- `Refresh` (implemented as another `POST /api/preview/launch` call for the same `workerId` + `mode`)
- `Pick winner`

For non-terminal workers:

- no preview launch buttons
- no `Pick winner` action yet

For this phase, the selected winner is chosen from a completed worker, even if sibling variants are still running.

### 5.3 Pick winner behavior

`Pick winner` means:

1. the lead records this worker as the selected winner immediately
2. sibling workers still running are sent abort commands
3. already completed siblings remain visible but are marked non-selected
4. the selected winner card becomes visually pinned or highlighted

This is not just an API acknowledgment. The UI should reflect the orchestration decision as soon as the lead accepts it.

### 5.4 No embedding yet

This phase does **not** embed a Strudel player in the dashboard.

Preview actions open `strudel.cc` in a new tab using generated browser-runnable code.

---

## 6. API Changes

### 6.1 `GET /api/orchestration`

Current worker payloads expose a single `previewUrl`.

Replace that with preview artifact summaries per worker, for example:

```json
{
  "id": "melody-v2",
  "state": "done",
  "branch": "feat/melody-v2",
  "selected": false,
  "previewArtifacts": [
    { "mode": "solo", "previewUrl": "..." },
    { "mode": "contextual", "previewUrl": "..." }
  ]
}
```

This should be summary-only. Full generated code may live behind a dedicated preview route if needed.

This is a **types contract change**. `packages/types/src/api.ts` must evolve from the current single-`previewUrl` worker shape to include:

- `selected: boolean`
- preview artifact summaries keyed by mode

### 6.2 `POST /api/preview/launch`

Current behavior accepts only `worktreeId`.

Change it to accept:

```json
{
  "workerId": "melody-v2",
  "mode": "solo"
}
```

or

```json
{
  "workerId": "melody-v2",
  "mode": "contextual"
}
```

Behavior:

- resolve the worker worktree
- invoke `StrudelPreviewComposer`
- persist/update the artifact
- return the artifact

### 6.3 `POST /api/approve`

Semantics become:

- `pick winner now`

This is an intentional semantic change from the current loose “approve” button behavior. In phase 1, `approve` means “select this completed worker as the lead winner immediately”.

Input remains lead + worker scoped, but the server contract changes from “queue a generic button action” to “route a lead-owned winner selection command”.

The lead must:

- validate the worker belongs to that lead
- mark the winner
- abort sibling workers still running

Sibling aborts are delivered through the existing in-process `CommandQueue` mechanism already used by the orchestration runtime. Phase 1 does not introduce a second abort transport.

### 6.4 No dedicated preview-inspection route in phase 1

Phase 1 does **not** add a separate `GET /api/previews/:workerId/:mode` route.

Artifact launch and summary data are handled through:

- `POST /api/preview/launch`
- `GET /api/orchestration`

If later dashboard slices need raw generated code or richer artifact inspection, that can be added as a follow-up spec.

---

## 7. Lead State Changes

The lead becomes the sole owner of winner-selection behavior.

### 7.1 Lead-owned winner state

The lead must track:

- current selected winner worker id, if any
- whether winner selection was reviewer-driven or user-forced

This state is needed for:

- compare UI highlighting
- downstream contextual previews
- later merge coordination

### 7.2 Idempotency rules

`Pick winner` must be idempotent:

- picking the already-selected winner is a no-op
- picking a new winner replaces the previous selection

### 7.3 Abort rules

After selecting a winner:

- running sibling workers receive `Abort` commands via the owning lead's existing command-queue path
- if a sibling exits naturally before abort lands, that is acceptable
- failure to abort a sibling must not unset the chosen winner

The winner decision is primary; abort cleanup is secondary.

---

## 8. DRY Boundaries

To avoid duplication and logical drift, the implementation must keep logic in these three places only:

### 8.1 `StrudelPreviewComposer`

Owns:

- preview composition
- lane resolution
- module-to-browser transformation
- contextual dependency assembly

Must **not** be duplicated in routes or React code.

### 8.2 Lead control path

Owns:

- winner selection
- sibling abort behavior
- selected-winner state

Must **not** be re-derived in the client.

### 8.3 Dashboard rendering layer

Owns:

- displaying worker cards
- calling preview / approve actions
- showing pending / selected / available states

Must **not** decide what counts as context or what winner state “means”.

---

## 9. Failure Handling

### 9.1 Preview failures

If preview generation fails:

- do not return a broken URL
- return a structured error for that `(workerId, mode)` request
- keep the previous successful artifact, if one exists

### 9.2 Missing context

If contextual dependencies are missing:

- the composer should return `context unavailable`
- the dashboard should disable or hide `Launch with context`

### 9.3 Winner selection failures

If a lead cannot accept a winner-selection command:

- the API should return an error
- the dashboard button should not pretend success

If aborting sibling workers fails:

- keep the winner selected
- surface abort cleanup failure separately in lead / worker state

---

## 10. Testing

Required coverage for this phase:

### 10.1 Composer tests

- lane file with `export const ...` becomes runnable Strudel preview code
- arrangement file with `import ...` becomes runnable Strudel preview code
- `solo` mode uses only the selected worker lane
- `contextual` mode includes upstream winner lanes
- missing context yields explicit unavailability, not malformed output

### 10.2 Route tests

- `POST /api/preview/launch` for `solo`
- `POST /api/preview/launch` for `contextual`
- `POST /api/approve` selects winner through the lead
- `POST /api/preview/launch` called repeatedly for the same `(workerId, mode)` overwrites the persisted artifact (`Refresh` behavior)

### 10.3 Lead tests

- selecting a winner records lead-owned winner state
- selecting a winner aborts running siblings
- selecting the same winner twice is idempotent

### 10.4 Browser / dashboard verification

One end-to-end dashboard check should verify:

- done worker cards show `Launch solo`
- contextual action appears only when context exists
- picking a winner changes card state immediately
- selected winner remains highlighted

---

## 11. Out of Scope

This phase explicitly does **not** solve:

- embedded Strudel playback in the dashboard
- full log and diff rendering
- natural-language steering
- generalized non-Strudel preview infrastructure
- retry / resume / recovery design beyond preserving selected winner state

Those belong to later slices.

---

## 12. Summary

Phase 1 introduces:

- a `StrudelPreviewComposer`
- lightweight persisted preview artifacts for `solo` and `contextual`
- dashboard compare cards with `Launch`, `Refresh`, and `Pick winner`
- lead-owned immediate winner selection with sibling aborts

This gives the Strudel demo a real, usable audition workflow without overbuilding a full artifact platform or embedded player.
