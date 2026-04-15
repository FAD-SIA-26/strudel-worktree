# User-Gated Winner Selection and Persistent Review-Ready Runtime

Date: 2026-04-15
Status: Draft approved for planning

## 1. Problem

Current ORC behavior is wrong for the intended product workflow in two ways:

1. A lead automatically finalizes a winner after reviewer selection, even though the user has not listened to the variants yet.
2. When the user clicks `Pick winner`, the dashboard gives little or no visible confirmation, so the state transition is unclear.
3. When orchestration finishes, the CLI shuts down the API and dashboard immediately, which prevents post-run listening and review.

For Strudel and for the broader product direction, reviewer output should be a recommendation, not the final truth. The user is always the final authority on which variant wins.

## 2. Goals

- Reviewer proposes a winner, but does not finalize it.
- Lead pauses and waits indefinitely for explicit user approval.
- User can accept the proposed winner or choose another completed worker instead.
- `Pick winner` becomes a visible, authoritative state transition in the dashboard.
- When all leads are merged, ORC stays alive in a persistent `review_ready` state until the user sends `Ctrl+C` from the terminal that launched ORC.
- The dashboard exposes the final full-song preview after orchestration completes.

## 3. Non-Goals

- No auto-accept timeout.
- No background auto-shutdown after success.
- No embedded Strudel player in the dashboard.
- No redesign of the reviewer model beyond changing it from final selector to proposer.
- No multi-user approval workflow.

## 4. State Model

### 4.1 Lead-Level Winner Model

Split the current winner concept into two fields:

- `proposedWinnerId`: reviewer recommendation
- `selectedWinnerId`: user-approved winner

Rules:

- Reviewer may set `proposedWinnerId`.
- Reviewer may not set `selectedWinnerId`.
- Only a user action may set `selectedWinnerId`.
- If the user chooses a different worker than `proposedWinnerId`, the user-selected worker becomes authoritative immediately.

### 4.2 Lead States

Lead state model becomes:

- `planning`
- `running`
- `awaiting_user_approval`
- `merging`
- `done`
- `failed`

Transition rules:

1. Lead starts in `planning`, then enters `running`.
2. When reviewer picks the best completed worker, lead persists `proposedWinnerId` and enters `awaiting_user_approval`.
3. Lead remains in `awaiting_user_approval` indefinitely until the user:
   - accepts the proposal, or
   - selects another worker.
4. After user choice, lead sets `selectedWinnerId`, aborts running siblings, enters `merging`, then `done`.
5. If merge fails, lead enters `failed`.

### 4.3 Run-Level State

Mastermind should stop treating success as an automatic shutdown point.

Run-level state becomes:

- `idle`
- `planning`
- `delegating`
- `monitoring`
- `merging`
- `review_ready`
- `failed`

Rule:

- when all leads are merged successfully, mastermind enters `review_ready`
- `review_ready` means the run is complete and stable, but the process remains alive for user inspection and listening

`OrchestrationComplete` should still be emitted as a durable event, but it must no longer imply process shutdown.

## 5. UX Design

### 5.1 Lead Compare View

When a lead is in `awaiting_user_approval`, the compare view shows a clear approval banner:

`Mastermind: I think <worker-id> is the best variant for this lane.`

Banner actions:

- `Accept`
- `Open preview` for the proposed worker when available

Worker card behavior:

- reviewer-proposed worker shows a `Proposed` badge
- user-selected worker shows a stronger `Selected winner` badge
- every completed non-selected worker shows `Pick this one instead`
- running sibling workers may still be visible while approval is pending

### 5.2 Picking a Winner

`Pick winner` is not a silent mutation. The UI must show progress immediately.

Required visible states:

- `Selecting...`
- `Selected winner`
- `Stopping siblings...`
- `Merged`

Behavior:

1. User clicks `Pick this one instead`.
2. UI marks that card as pending selection immediately.
3. Once API confirms, that card becomes `Selected winner`.
4. Running sibling workers show `Stopping...`.
5. After merge succeeds, selected card may show `Merged`.

### 5.3 Final Review Surface

When mastermind reaches `review_ready`:

- dashboard stays available
- full-song preview is exposed as a primary action
- lane winners remain visible for inspection
- terminal output tells the user that review is ready and the process is still running

Expected CLI message shape:

`[orc] orchestration complete; review ready at <dashboard-url> | press Ctrl+C to shut down`

## 6. API and Contract Changes

### 6.1 Lead Payload

Lead payload returned to the dashboard must include:

- `state`
- `proposedWinnerId: string | null`
- `selectedWinnerId: string | null`
- `awaitingUserApproval: boolean`

`awaitingUserApproval` is derived from:

- `state === 'awaiting_user_approval'`

### 6.2 Worker Payload

Worker payload should expose derived flags:

- `isProposed`
- `isSelected`
- `isStopping`

These are view-facing convenience fields so the dashboard does not re-derive winner logic locally.

### 6.3 Approve Route Semantics

`POST /api/approve` becomes the user-finalization route.

Rules:

- if no worker id is provided, accept `proposedWinnerId`
- if a worker id is provided, finalize that worker instead
- final selection always overrides reviewer recommendation

This is a semantic change from “force approve current winner” to “finalize winner selection.”

### 6.4 Event Expectations

At minimum, the runtime must emit enough events to support immediate UI feedback for:

- reviewer proposed winner
- user selected winner
- sibling abort requested
- sibling abort completed or failed
- merge started
- merge completed

Exact event names may follow existing code conventions, but the state transitions must be durable and externally visible.

## 7. Runtime Behavior

### 7.1 Lead Approval Gate

Reviewer selection no longer triggers merge directly.

Required flow:

1. workers complete
2. reviewer proposes best candidate
3. lead stores `proposedWinnerId`
4. lead enters `awaiting_user_approval`
5. user accepts proposal or selects another completed worker
6. lead stores `selectedWinnerId`
7. lead aborts running siblings
8. lead merges selected winner

### 7.2 User Override Rule

User is always right.

If reviewer proposes `worker-a` and user chooses `worker-b`:

- `worker-b` becomes `selectedWinnerId`
- `worker-a` remains only historical proposal data
- downstream merge and context use `worker-b`

### 7.3 Persistent Review-Ready Runtime

`orc run` must no longer shut down the API server and dashboard after successful completion.

New behavior:

- success path ends in `review_ready`
- API server remains running
- dashboard remains running
- process exits only when the user sends `Ctrl+C`

Signal handling:

- `Ctrl+C` triggers shutdown of dashboard and API
- success alone does not call `process.exit(...)`

## 8. Failure Handling

### 8.1 Reviewer Failure

If reviewer cannot produce a proposal:

- lead enters `failed`
- no approval banner is shown

### 8.2 Sibling Abort Failure

If selected winner is finalized but a running sibling does not stop cleanly:

- selected winner remains authoritative
- lead continues tracking the stuck sibling
- UI shows a degraded status such as `Stopping failed` or equivalent

### 8.3 Merge Failure After User Selection

If merge fails after the user selects a worker:

- lead enters `failed`
- selected worker remains visible as the user’s choice
- dashboard may let the user choose a different completed worker

The user should not lose the fact that a selection was made just because merge failed.

## 9. Testing Requirements

Tests must cover:

- reviewer proposal does not finalize winner
- lead enters `awaiting_user_approval`
- accepting proposal sets `selectedWinnerId`
- selecting another worker overrides `proposedWinnerId`
- running siblings are aborted after final selection
- dashboard payload exposes `proposedWinnerId`, `selectedWinnerId`, and derived worker flags
- UI shows visible proposed vs selected states
- successful orchestration enters `review_ready`
- CLI does not auto-exit on success
- `Ctrl+C` still shuts down dashboard and API

## 10. Design Constraints

- Keep winner ownership in the lead, not the dashboard.
- Keep dashboard logic view-only: it renders state and sends commands; it does not decide winner semantics.
- Avoid duplicate state derivation in React when the API can provide authoritative flags.
- Preserve existing compare/listen direction: user evaluates variants from the dashboard, not from terminal output.

## 11. Summary

This design changes ORC from:

- reviewer selects final winner
- merge happens immediately
- successful run shuts down

to:

- reviewer proposes
- user finalizes
- run stays alive in `review_ready` until explicit `Ctrl+C`

That is the correct interaction model for music review and for any workflow where the human must inspect outputs before declaring the run complete.
