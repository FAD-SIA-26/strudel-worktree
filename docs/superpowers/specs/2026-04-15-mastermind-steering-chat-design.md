# Mastermind Steering Chat Design

Date: 2026-04-15
Status: Approved for planning

## 1. Problem

The current MVP has no real user-facing control surface for redirecting an active orchestration run.

Today:

- the dashboard exposes no dedicated chat or steering interface for `mastermind`
- `POST /api/steer` only logs a string and returns a placeholder note
- there is no routed command path to the live `MastermindStateMachine`
- there is no persisted transcript that explains what the user asked for or how mastermind responded

That leaves an important product gap. Users cannot refine the goal, add constraints, or redirect future work from inside the product. They have to fall back to terminal-driven operation or code changes, which breaks the intended UX.

## 2. Goals

- Add a real steering chat interface targeted at `mastermind`.
- Make `/api/steer` a real routed backend path, not a stub.
- Persist user and mastermind messages for the active run.
- Let steering messages reach mastermind near-immediately during an active run.
- Show two-way chat in the dashboard: user messages and mastermind replies.
- Keep the first MVP scoped to freeform chat only, with no command classification.
- Limit the effect of steering to future decisions and future work, not retroactive mutation of completed work.

## 3. Non-Goals

- No typed-intent parser or natural-language command classifier in this MVP.
- No interruptive replanning that cancels in-flight workers.
- No post-run chat once the run is `done` or `failed`.
- No multi-user chat, presence, or collaboration model.
- No chat-driven direct lead control that bypasses existing lead routes such as `approve` or `drop`.
- No full conversational memory system beyond the persisted run transcript and the subset of messages mastermind chooses to fold into future prompts.

## 4. Product Behavior

### 4.1 Availability

The steering chat exists only for active runs.

Allowed mastermind states:

- `planning`
- `delegating`
- `monitoring`
- `merging_lanes`

Blocked mastermind states:

- `idle`
- `review_ready`
- `done`
- `failed`

If the run is not active, the route rejects new steering messages and the dashboard does not show an enabled composer. `review_ready` is explicitly non-steerable in this MVP because all orchestration decisions have already been made by that point.

### 4.2 Chat Model

The chat is a run-scoped transcript between two roles:

- `user`
- `mastermind`

Each user message is persisted immediately, then routed to the live mastermind command path. Mastermind consumes the message near-immediately and writes back a short reply. The reply should make one of these outcomes explicit:

- guidance accepted for future work
- guidance noted but only applicable to future sections or retries
- guidance understood but not supported in this MVP
- request rejected because the run is no longer steerable

The MVP is honest about its limits. A steering message may influence future prompt construction or future retries, but it does not silently rewrite already completed outputs and does not kill in-flight workers.

The reply mechanism is deterministic in this MVP. Mastermind does not call `llmCall` to generate a chat reply. Instead, it emits one of a small set of fixed reply templates based on the outcome of steering evaluation.

### 4.3 Timing

Near-immediate handling means:

- the route persists the message synchronously
- the live mastermind queue is signaled immediately after persistence
- mastermind handles the message as soon as its current awaited step allows
- the UI can show the user message before the mastermind reply arrives

This is intentionally stronger than checkpoint-only polling, but weaker than true interruption. If mastermind is waiting on lead completion, the reply may still be delayed briefly. That is acceptable for this MVP as long as the message is durably recorded and eventually acknowledged.

## 5. Architecture

### 5.1 Backend Boundary

Steering should not be implemented as ad hoc route logic inside `routes.ts`.

Introduce a small steering subsystem with three responsibilities:

1. validate and persist chat messages
2. route live steering signals to mastermind
3. provide transcript reads for the dashboard

This keeps the route thin and avoids mixing HTTP concerns with orchestration behavior.

### 5.2 Command Transport

The API already uses in-process `CommandQueue` instances for lead commands. The steering chat should extend this pattern with a dedicated mastermind queue owned by the active run.

Add a new command variant for mastermind:

- `Steer`: references the persisted message id and run id

The route does not pass raw text directly into business logic after validation. It stores the message first, then enqueues a command pointing at the stored record. That makes retry and debugging safer because the queue item refers to durable state instead of transient request payload.

### 5.3 Transcript Storage

Add a persisted store for steering messages. Minimum fields:

- `id`
- `run_id`
- `role`
- `body`
- `status`
- `created_at`
- `handled_at` nullable
- `in_reply_to_id` nullable
- `error` nullable

Recommended roles:

- `user`
- `mastermind`

Recommended statuses:

- `pending`
- `handled`
- `rejected`
- `delivery_failed`

The persisted transcript is the source of truth for the dashboard.

`in_reply_to_id` is used only for mastermind replies. User messages store `null`. A mastermind reply points to the triggering user message so the backend preserves the one-to-one acknowledgment relationship even if the dashboard renders the transcript as a flat list.

### 5.4 Mastermind Integration

`MastermindStateMachine` gains:

- access to a dedicated steering command queue
- a small internal steering handler
- a representation of active steering guidance that can be folded into future decisions

The state machine does not become a chat engine. Its responsibility is narrower:

1. receive a steering command
2. load the referenced user message
3. decide whether the message can affect future work
4. persist a mastermind reply
5. optionally update in-memory guidance used by future prompt builders

The guidance should be appended or merged into future prompt context rather than retroactively rewriting persisted plans.

Reply generation is deterministic and template-based. Mastermind does not perform an extra LLM round trip for steering acknowledgments. Required reply outcomes:

- `accepted_future_guidance`
  `Constraint noted. I will apply this guidance to upcoming planning and retries.`
- `accepted_future_only`
  `Guidance noted. It will affect future work only; completed outputs stay unchanged.`
- `unsupported_mvp`
  `I understood the request, but this chat only steers future work in this MVP.`
- `not_steerable`
  `Run is no longer active, so I cannot apply new steering.`

If the steering handler fails after the user message has been persisted, the backend must not leave the message in `pending` indefinitely. It updates the user message to `rejected` or `delivery_failed` with an error string and does not create a synthetic mastermind reply.

## 6. Data and Contract Design

### 6.1 Shared Types

Shared contracts belong in `packages/types`.

Add steering API schemas for:

- transcript message shape
- transcript list response
- steer request
- steer response

The dashboard should consume typed message objects instead of reconstructing chat state from event logs.

### 6.2 API Surface

Required endpoints:

- `GET /api/steer`
  returns the active run transcript plus whether steering is currently allowed
- `POST /api/steer`
  validates input, persists a user message, routes it to mastermind, and returns the stored message

`GET /api/steer` request shape:

- `runId` as a query parameter

In the single-run MVP, `runId` must be the literal string `current`. The server resolves `current` to the single active run known to the backend. The dashboard should not invent its own run lookup scheme.

`POST /api/steer` request shape:

- `runId`
- `message`

Validation:

- `message` must be present after trimming
- `runId` must equal `current`
- reject when no active run matches `current`
- reject when mastermind is not in a steerable state
- reject when no mastermind queue is registered for that run

Response behavior:

- on success, return the stored user message with status `pending`
- the route does not block on the mastermind reply
- the dashboard invalidates and refetches transcript data after submit to pick up the later reply

### 6.3 Error Semantics

Use explicit API errors instead of silent acceptance.

Examples:

- `400` for invalid body
- `404` when the run is unknown or `runId` does not resolve to the single active run
- `409` when the run exists but is not currently steerable
- `503` when the run is active but the live mastermind transport is unavailable

If persistence succeeds but queue delivery fails, the user message remains stored with `delivery_failed`. This avoids losing user intent and gives the UI something truthful to render.

These semantics apply to both `GET /api/steer` and `POST /api/steer`. `GET /api/steer?runId=current` returns `404` when there is no active run or when the backend cannot resolve `current`.

## 7. Dashboard UX

### 7.1 Placement

The dashboard already renders a `mastermind` node in the hierarchy, but there is no detail surface for it. Add a real mastermind detail view with:

- transcript pane
- composer
- steerability status

This must extend the existing dashboard layout, not create a parallel panel. Make the mastermind row selectable in `TreePanel`, and add a `selectedId === 'mastermind'` branch inside the existing `DetailPanel`. Selecting the mastermind row in the left tree should open this view instead of treating mastermind as a passive label.

### 7.2 Interaction Model

The transcript is append-only for this MVP.

Behavior:

1. user selects `mastermind`
2. dashboard loads transcript for the active run
3. user enters a freeform message
4. UI enters a local `sending` state and disables the composer
5. UI posts to `/api/steer`
6. on success, UI appends the persisted user message returned by the API response
7. UI invalidates and refetches transcript data
8. mastermind reply appears when persisted by the backend

The MVP does not introduce a new WebSocket event for steering replies. Transcript freshness comes from explicit invalidation after submit plus normal query refetching while the mastermind detail view is active.

The transcript renders oldest-to-newest with the composer anchored below it. On initial load the view scrolls to the bottom. When a new message arrives, the view auto-scrolls only if the user is already at or near the bottom.

The composer must disable when:

- there is no active run
- the selected run is not steerable
- mastermind state is `review_ready`
- a submit is currently in flight

### 7.3 Reply Style

Mastermind replies should be short and operational, not verbose assistant prose.

Good reply examples:

- `Constraint noted. I will apply this guidance to upcoming planning and retries.`
- `I can steer future work, but I cannot replace completed lane outputs through chat in this MVP.`
- `Run is no longer active, so I cannot apply new steering.`

The purpose is product clarity, not open-ended conversation.

## 8. Orchestration Semantics

### 8.1 What Steering Can Affect

Steering messages may affect:

- future prompt context built by mastermind
- future lead prompt generation
- future retry prompts if retries already exist elsewhere in the system
- future decomposition decisions that have not yet been finalized

### 8.2 What Steering Cannot Affect

Steering messages do not:

- rewrite completed worker outputs
- auto-approve winners
- directly abort workers through chat
- re-open finished runs
- silently change already persisted plan files

If a user asks for something outside MVP scope, mastermind replies clearly and does not pretend the action happened.

### 8.3 Guidance Folding

Use the simplest durable rule for MVP:

- maintain a list of handled user steering messages for the active run
- include only the last 5 handled user steering messages, oldest-to-newest, in future mastermind and PM prompt context
- do not include mastermind reply messages in prompt context
- render guidance in an explicit prompt block named `User steering guidance:`, with one bullet per included user message

This is enough to prove product value without inventing a complex memory or ranking system.

## 9. Testing Strategy

### 9.1 API Tests

Add route coverage for:

- `GET /api/steer` returns transcript and steerable flag
- `GET /api/steer` returns `404` when `runId=current` cannot be resolved
- `POST /api/steer` rejects empty messages
- `POST /api/steer` rejects inactive runs
- `POST /api/steer` persists a user message and enqueues a mastermind command
- `POST /api/steer` marks messages correctly when delivery fails

### 9.2 State Machine Tests

Add mastermind-focused tests for:

- consuming a steering command and persisting a reply
- using deterministic reply templates rather than `llmCall`
- storing handled guidance for future prompt construction
- acknowledging unsupported requests without mutating completed work
- ignoring or rejecting steering when the run is no longer active

### 9.3 Web Verification

Add targeted UI verification for:

- selecting mastermind opens the transcript surface
- transcript renders both user and mastermind messages
- mastermind selection is handled inside the existing detail panel layout
- composer is enabled only for active runs
- response-based user messages do not disappear after refetch
- backend error states are rendered clearly

## 10. File Boundaries

The feature should stay decomposed around existing repo patterns.

Likely responsibilities:

- API route layer: HTTP validation and JSON responses
- steering data access module: message persistence and reads
- steering service module: route-to-queue orchestration
- mastermind integration: command consumption and reply generation
- shared types: steer request and transcript contracts
- dashboard mastermind panel: transcript and composer UI

Avoid putting transcript persistence, queue wiring, and mastermind reply logic all into one large route file.

## 11. Acceptance Criteria

The MVP is complete when all of the following are true:

- selecting mastermind in the dashboard shows a real steering chat surface
- sending a message calls a real `/api/steer` backend path
- the user message is persisted for the active run
- the live mastermind instance is signaled through a real command queue
- mastermind posts a deterministic persisted reply visible in the dashboard
- steering affects only future work and future prompts
- `review_ready`, `done`, and `failed` runs cannot be steered
- tests cover the new route, persistence, and mastermind handling path
