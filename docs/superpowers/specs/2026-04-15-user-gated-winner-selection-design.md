# User-Gated Winner Selection, Lane Branches, and Persistent Review-Ready Runtime

Date: 2026-04-15
Status: Approved for planning

## 1. Problem

Current ORC behavior is wrong for the intended product workflow in three ways:

1. A lead automatically finalizes a winner after reviewer selection, even though the user has not listened yet.
2. When the user clicks the winner action, the dashboard gives little or no visible confirmation, so the state transition is unclear.
3. When orchestration finishes, the CLI shuts down the API and dashboard immediately, which prevents post-run listening and review of the final song.

For Strudel and for the broader product direction, reviewer output should be a recommendation, not the final truth. The user is always the authority on which worker wins a lane.

## 2. Goals

- Reviewer proposes a winner, but never finalizes it.
- Every lane waits for explicit user approval, even if only one worker completed successfully.
- User can accept the reviewer suggestion or choose a different completed worker, and the user choice is always authoritative.
- A selected worker merges into a dedicated lane branch for that section, not directly into the run branch.
- Mastermind merges lane branches later, after every lane has a selected winner.
- Picking a winner becomes a visible, authoritative UI state transition with immediate feedback.
- When all lanes are selected and integrated, ORC stays alive in a persistent `review_ready` state until the user sends `Ctrl+C` from the launching terminal.
- The dashboard exposes a clear `Launch full song preview` action once the assembled song is ready.

## 3. Non-Goals

- No auto-accept timeout.
- No automatic shutdown after success.
- No auto-opening of the full-song preview.
- No embedded Strudel player inside the dashboard.
- No redesign of reviewer prompting beyond changing it from final selector to proposer.
- No multi-user approval workflow.

## 4. Runtime Model

### 4.1 Winner Ownership

Split the current single winner concept into two fields:

- `proposedWinnerWorkerId`: reviewer recommendation
- `selectedWinnerWorkerId`: user-approved winner

Rules:

- Reviewer may set `proposedWinnerWorkerId`.
- Reviewer may not set `selectedWinnerWorkerId`.
- Only a user action may set `selectedWinnerWorkerId`.
- If the user chooses a different worker than `proposedWinnerWorkerId`, the user-selected worker becomes authoritative immediately.

### 4.2 Lead Lifecycle

Lead state model becomes:

- `planning`
- `running`
- `awaiting_user_approval`
- `merging_lane`
- `done`
- `failed`

Transition rules:

1. Lead starts in `planning`, then enters `running`.
2. Once worker outcomes are known, the reviewer proposes a best completed worker.
3. Lead persists `proposedWinnerWorkerId` and enters `awaiting_user_approval`.
4. Lead remains in `awaiting_user_approval` indefinitely until the user:
   - accepts the proposal, or
   - selects another completed worker.
5. After user choice, lead sets `selectedWinnerWorkerId`, stops any still-running siblings, merges the selected worker branch into the lane branch, then enters `done`.
6. If reviewer proposal or lane merge fails, lead enters `failed`.

Even if there is only one completed candidate, the lead still enters `awaiting_user_approval` and waits for an explicit user action.

### 4.3 Branch Hierarchy

The branch model becomes hierarchical:

- worker branch: `feat/<runId>-<section>-vN`
- lane branch: one branch per section or lane
- run branch: one integration branch per orchestration run

Required merge order:

1. Worker branches are produced by individual workers.
2. User selects the winning worker for a lane.
3. Lead merges the selected worker branch into the lane branch.
4. Mastermind later merges lane branches into the run branch.

Workers are experiments inside a lane. Leads finalize lane truth. Mastermind only integrates lane truth.

### 4.4 Run Lifecycle

Run-level state becomes:

- `idle`
- `planning`
- `delegating`
- `monitoring`
- `merging_lanes`
- `review_ready`
- `failed`

Rules:

- Mastermind does not consider a run complete when reviewers have merely proposed winners.
- Mastermind does not consider a run complete when workers have merely finished.
- Mastermind reaches `review_ready` only after:
  - every lane has a `selectedWinnerWorkerId`
  - every selected winner has been merged into its lane branch
  - mastermind has merged lane branches into the run branch
  - the full-song preview can be launched from the dashboard

`OrchestrationComplete` remains a durable event, but success no longer implies process shutdown.

## 5. API and Contract Changes

### 5.1 Lead Payload

Lead payload returned to the dashboard must include:

- `state`
- `proposedWinnerWorkerId: string | null`
- `selectedWinnerWorkerId: string | null`
- `selectionStatus: 'waiting_for_review' | 'waiting_for_user' | 'selected' | 'lane_merged'`
- `awaitingUserApproval: boolean`

`awaitingUserApproval` is derived from:

- `state === 'awaiting_user_approval'`

### 5.2 Worker Payload

Worker payload should expose derived flags so the dashboard does not duplicate winner logic:

- `isProposed`
- `isSelected`
- `canBeSelected`
- `isStopping`

Any short-lived `selectionInFlight` state may remain client-side as an optimistic UI concern.

### 5.3 Approve Route Semantics

`POST /api/approve` becomes the user-finalization route.

Rules:

- if no worker id is provided, finalize `proposedWinnerWorkerId`
- if a worker id is provided, finalize that worker instead
- final selection always overrides reviewer recommendation
- the route must reject requests when there is no eligible completed worker to finalize

### 5.4 Run Payload

Run payload should expose enough state for a persistent review surface:

- `mastermindState`
- `reviewReady: boolean`
- `fullSongPreviewAvailable: boolean`
- `fullSongPreviewUrl` only when already generated, otherwise omitted
- lane-level status derived from authoritative backend data rather than inferred ad hoc in React

## 6. UX Design

### 6.1 Lead Compare View

When a lead is in `awaiting_user_approval`, the compare view shows a clear approval banner:

`Mastermind suggests <worker-id> for this lane. You can accept it or choose another completed worker.`

Worker card behavior:

- reviewer-proposed worker shows a `Suggested by reviewer` badge
- user-selected worker shows a stronger `Selected winner` badge
- every completed non-selected worker shows `Choose this winner`
- if the suggestion card is not yet selected, its primary action is `Accept suggestion`
- running sibling workers may remain visible while approval is pending

### 6.2 Picking a Winner

Winner selection is not a silent mutation. The UI must show progress immediately.

Required visible states:

- `Selecting...`
- `Selected winner`
- `Stopping siblings...`
- `Merged into lane`

Behavior:

1. User clicks `Accept suggestion` or `Choose this winner`.
2. UI marks that card as pending selection immediately.
3. Once API confirms, that card becomes `Selected winner`.
4. Section-level confirmation banner appears, for example `Winner selected for melody`.
5. Running sibling workers show `Stopping...` while they are being wound down.
6. After lane merge succeeds, the selected card and section status may show `Merged into lane`.

The user should never need to infer success from a silent refetch.

### 6.3 Final Review Surface

When mastermind reaches `review_ready`:

- dashboard stays available
- lane winners remain visible for inspection
- the page exposes a clear primary action: `Launch full song preview`
- the full-song preview does not auto-open
- the UI communicates that ORC remains alive for listening until terminal `Ctrl+C`

Expected CLI message shape:

`[orc] orchestration complete; review ready at <dashboard-url> | press Ctrl+C to shut down`

## 7. DRY and ETC Boundaries

This feature must not scatter winner logic across routes, orchestrator code, and React components.

### 7.1 Backend Ownership

- Lead state machine owns proposal, waiting-for-user, selected winner, sibling shutdown, and lane merge progression.
- Persistence layer owns the projection shape for proposed winner, selected winner, and lane-level merge state.
- Mastermind owns only cross-lane coordination: waiting for lane branches, merging lane branches into the run branch, and entering `review_ready`.
- Preview generation stays centralized in shared preview helpers and is extended to support full-song launch from selected lane outputs.

### 7.2 Frontend Ownership

- A small review-state mapping layer should convert raw API payload into display-friendly flags and labels.
- A shared preview-launch helper should handle window opening, API calls, cache invalidation, and failure cleanup in one place.
- Compare UI components should render from derived flags rather than re-implementing approval semantics inline.

### 7.3 ETC Guardrail

If selection semantics change again, the system should be changeable by updating:

- lead workflow logic
- persistence and API mapping
- the frontend review-state mapper

It should not require editing duplicated conditional logic across multiple unrelated UI and route files.

## 8. Runtime Behavior

### 8.1 Lead Approval Gate

Reviewer selection no longer triggers merge directly.

Required flow:

1. workers complete or fail
2. reviewer proposes the best completed worker
3. lead stores `proposedWinnerWorkerId`
4. lead enters `awaiting_user_approval`
5. user accepts proposal or selects another completed worker
6. lead stores `selectedWinnerWorkerId`
7. lead stops running siblings
8. lead merges selected worker into the lane branch

### 8.2 User Override Rule

User is always right.

If reviewer proposes `worker-a` and user chooses `worker-b`:

- `worker-b` becomes `selectedWinnerWorkerId`
- `worker-a` remains only historical proposal data
- downstream lane merge, mastermind integration, and preview composition use `worker-b`

### 8.3 Persistent Review-Ready Runtime

`orc run` must no longer shut down the API server and dashboard after successful completion.

New behavior:

- success path ends in `review_ready`
- API server remains running
- dashboard remains running
- process exits only when the user sends `Ctrl+C`

Signal handling:

- `Ctrl+C` triggers shutdown of dashboard and API
- success alone does not call `process.exit(...)`

## 9. Failure Handling

### 9.1 Reviewer Failure

If reviewer cannot produce a proposal:

- lead enters `failed`
- no approval banner is shown for that lane

### 9.2 Sibling Shutdown Failure

If selected winner is finalized but a running sibling does not stop cleanly:

- selected winner remains authoritative
- lead continues tracking the stuck sibling as degraded state
- UI shows a degraded status such as `Stopping failed`

### 9.3 Lane Merge Failure

If lane merge fails after the user selects a worker:

- lead enters `failed`
- selected worker remains visible as the user choice
- the user-visible state does not lose the fact that a selection was made

### 9.4 Full-Song Preview Failure

If lane integration is complete but full-song preview generation fails:

- ORC remains alive
- dashboard shows the run as review-ready but with a retryable preview failure
- the user may retry preview launch without rerunning the orchestration

## 10. Testing Requirements

Tests must cover:

- reviewer proposal does not finalize winner
- lead enters `awaiting_user_approval`
- a lead with only one completed worker still waits for explicit user approval
- accepting a proposal sets `selectedWinnerWorkerId`
- selecting another worker overrides `proposedWinnerWorkerId`
- selected winner merges into the lane branch, not directly into the run branch
- mastermind waits for lane branches rather than raw worker winners
- dashboard payload exposes proposed and selected winner fields plus derived worker flags
- UI shows immediate pending feedback when a winner is selected
- UI keeps reviewer suggestion and actual selection visually distinct
- successful orchestration enters `review_ready`
- dashboard exposes `Launch full song preview` only when the full song is ready
- CLI does not auto-exit on success
- `Ctrl+C` still shuts down dashboard and API

## 11. Summary

This design changes ORC from:

- reviewer selects final winner
- winner merges directly into the run branch
- successful run shuts down

to:

- reviewer proposes
- user finalizes
- selected worker merges into a lane branch
- mastermind later integrates lane branches into the run branch
- run stays alive in `review_ready` until explicit `Ctrl+C`

That is the correct interaction model for music review and for any workflow where the human must inspect and listen before the run is truly complete.
