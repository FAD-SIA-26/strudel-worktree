# User-Gated Winner Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change ORC so reviewer output is only a proposal, the user explicitly finalizes each lane winner, and successful runs stay alive in a persistent `review_ready` state until `Ctrl+C`.

**Architecture:** Keep winner ownership in the lead state machine. Persist reviewer proposal and user selection separately in `merge_candidates`, expose lead/worker approval state through `/api/orchestration`, and drive the dashboard from authoritative API flags plus a thin optimistic UI layer for “Selecting...” feedback. Replace automatic process exit with a signal-driven `review_ready` hold-open path in the CLI.

**Tech Stack:** TypeScript, Express, Drizzle + SQLite, Commander, Next.js, React Query, Vitest

---

## Execution Preconditions

- Execute this plan in a **fresh git worktree from the current committed branch HEAD**, not in the existing dirty workspace.
- Do **not** mix this work with unrelated in-flight edits already present in:
  - `apps/api/src/cli.ts`
  - `apps/api/src/db/schema.ts`
  - `apps/api/src/db/queries.ts`
  - `apps/api/src/orchestrator/lead.ts`
  - `apps/api/src/orchestrator/mastermind.ts`
  - `apps/api/src/server/routes.ts`
  - `apps/web/src/components/DetailPanel.tsx`
  - `packages/types/src/api.ts`
- Treat the current codebase as **pre-plan baseline** for this feature. The review correctly found that none of the user-gated winner-selection tasks are implemented yet.
- Existing untracked files from the earlier Strudel preview/compare slice such as `previewComposer.ts`, `runtime/ports.ts`, and generated runtime state are not part of this feature unless a task below explicitly touches them.

---

## File Structure / Planned Changes

- Modify: `packages/types/src/commands.ts`
  - Replace `ForceApprove` with explicit user-finalization commands.
- Modify: `packages/types/src/events.ts`
  - Add concrete approval-gate and stop-progress events.
- Modify: `packages/types/src/api.ts`
  - Extend lead/worker payloads with proposal/selection/review-ready fields.
- Create: `packages/types/src/commands.test.ts`
  - Verify the new command contracts.
- Modify: `packages/types/src/events.test.ts`
  - Verify the new event contracts.

- Modify: `apps/api/src/db/schema.ts`
  - Split `merge_candidates` into proposal vs selection columns.
- Modify: `apps/api/src/db/queries.ts`
  - Return both proposal and selection data to callers.
- Create: `apps/api/src/db/queries.test.ts`
  - Verify new query shape and column mapping.
- Create: `apps/api/src/db/migrations/0002_user_gated_winner_selection.sql`
  - Generated Drizzle migration for `merge_candidates`.
- Modify: `apps/api/src/db/migrations/meta/*`
  - Generated Drizzle snapshot/journal files.

- Modify: `apps/api/src/orchestrator/worker.ts`
  - Add a real `stopping` state and emit visible stop-progress events.
- Modify: `apps/api/src/orchestrator/lead.ts`
  - Add `awaiting_user_approval`, pause after reviewer proposal, and finalize only on user command.
- Modify: `apps/api/src/orchestrator/lead.test.ts`
  - Cover proposal-only, accept-proposal, override-proposal, and sibling-stop behavior.

- Modify: `apps/api/src/server/routes.ts`
  - Return approval-gate fields and update `/api/approve` semantics.
- Modify: `apps/api/src/server/routes.test.ts`
  - Cover new payload shape and approval command routing.

- Modify: `apps/api/src/orchestrator/mastermind.ts`
  - Replace `done` with `review_ready`.
- Modify: `apps/api/src/orchestrator/mastermind.test.ts`
  - Expect `review_ready`, not `done`.
- Create: `apps/api/src/runtime/reviewReady.ts`
  - Promise-based helper to keep ORC alive until a shutdown signal.
- Create: `apps/api/src/runtime/reviewReady.test.ts`
  - Verify the helper resolves only on signal.
- Modify: `apps/api/src/cli.ts`
  - Stop auto-exiting on success; hold open until `Ctrl+C`.

- Create: `apps/web/src/lib/reviewState.ts`
  - Pure helpers for proposed/selected/final-review worker lookup.
- Create: `apps/web/src/lib/reviewState.test.ts`
  - Verify helper logic without needing a React test harness.
- Create: `apps/web/src/lib/previewActions.ts`
  - Shared preview-launch helper for `DetailPanel` and top-level review UI.
- Modify: `apps/web/src/hooks/useOrchestration.ts`
  - Map new lead/worker/mastermind event states.
- Modify: `apps/web/src/components/DetailPanel.tsx`
  - Add approval banner, badges, pending selection states, and explicit winner feedback.
- Modify: `apps/web/src/components/TreePanel.tsx`
  - Add badges for `awaiting_user_approval` and `review_ready`.
- Modify: `apps/web/src/app/page.tsx`
  - Add persistent review-ready surface and full-song preview CTA.

## Task 1: Split Proposal vs Selection in Contracts and Persistence

**Files:**
- Create: `packages/types/src/commands.test.ts`
- Modify: `packages/types/src/commands.ts`
- Modify: `packages/types/src/events.ts`
- Modify: `packages/types/src/events.test.ts`
- Modify: `packages/types/src/api.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/queries.ts`
- Create: `apps/api/src/db/queries.test.ts`
- Modify: `apps/api/drizzle.config.ts` if the current config needs the new schema path picked up during generation
- Generate: `apps/api/src/db/migrations/0002_user_gated_winner_selection.sql`
- Generate: `apps/api/src/db/migrations/meta/*`

- [ ] **Step 1: Write the failing contract tests for commands and query shape**

Create `packages/types/src/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { OrcCommandSchema } from './commands'

describe('OrcCommandSchema', () => {
  it('parses AcceptProposal without a worker id', () => {
    expect(OrcCommandSchema.parse({ commandType: 'AcceptProposal' })).toEqual({
      commandType: 'AcceptProposal',
    })
  })

  it('parses SelectWinner with an explicit worker id', () => {
    expect(OrcCommandSchema.parse({ commandType: 'SelectWinner', workerId: 'melody-v2' })).toEqual({
      commandType: 'SelectWinner',
      workerId: 'melody-v2',
    })
  })
})
```

Create `apps/api/src/db/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTestDb, getSQLite } from './client'
import { getMergeCandidates } from './queries'

describe('getMergeCandidates', () => {
  it('returns both proposed and selected winner ids', () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'melody-lead',
      'melody-lead',
      'melody-v1',
      'melody-v2',
      'run/r1',
      'reviewer preferred v1',
      'user_override',
    )

    expect(getMergeCandidates(db)).toEqual([
      {
        leadId: 'melody-lead',
        proposedWinnerWorkerId: 'melody-v1',
        selectedWinnerWorkerId: 'melody-v2',
        selectionSource: 'user_override',
      },
    ])
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd packages/types && pnpm vitest run src/commands.test.ts
cd apps/api && pnpm vitest run src/db/queries.test.ts
```

Expected:
- `commands.test.ts` fails because `AcceptProposal` and `SelectWinner` are not part of `OrcCommandSchema`
- `queries.test.ts` fails because the schema/query still uses `winner_worker_id`

- [ ] **Step 3: Update the shared type contracts**

Modify `packages/types/src/commands.ts`:

```ts
import { z } from 'zod'

export const SpawnWorkerCmd      = z.object({ commandType: z.literal('SpawnWorker'), workerId: z.string(), prompt: z.string(), strategy: z.string().optional(), errorHistory: z.array(z.string()).default([]) })
export const AbortCmd            = z.object({ commandType: z.literal('Abort'), targetWorkerId: z.string().optional() })
export const AcceptProposalCmd   = z.object({ commandType: z.literal('AcceptProposal') })
export const SelectWinnerCmd     = z.object({ commandType: z.literal('SelectWinner'), workerId: z.string() })
export const InjectConstraintCmd = z.object({ commandType: z.literal('InjectConstraint'), constraint: z.string() })

export const OrcCommandSchema = z.discriminatedUnion('commandType', [
  SpawnWorkerCmd,
  AbortCmd,
  AcceptProposalCmd,
  SelectWinnerCmd,
  InjectConstraintCmd,
])

export type OrcCommand = z.infer<typeof OrcCommandSchema>
```

Modify the lead/worker/api contracts in `packages/types/src/api.ts`:

```ts
export const WorkerInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  branch: z.string().optional(),
  isProposed: z.boolean().default(false),
  isSelected: z.boolean().default(false),
  isStopping: z.boolean().default(false),
  contextAvailable: z.boolean().default(false),
  previewArtifacts: z.array(PreviewArtifactSummarySchema).default([]),
})

export const SectionInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  proposedWinnerId: z.string().nullable().default(null),
  selectedWinnerId: z.string().nullable().default(null),
  awaitingUserApproval: z.boolean().default(false),
  workers: z.array(WorkerInfoSchema),
})
```

Extend `packages/types/src/events.ts` with concrete approval-gate events:

```ts
export const WinnerProposedSchema = base.extend({
  eventType: z.literal('WinnerProposed'),
  payload: z.object({ proposedWinnerId: z.string(), reasoning: z.string() }),
})

export const WinnerSelectedSchema = base.extend({
  eventType: z.literal('WinnerSelected'),
  payload: z.object({
    selectedWinnerId: z.string(),
    selectionSource: z.enum(['proposal_accept', 'user_override']),
  }),
})

export const WorkerStoppingSchema = base.extend({
  eventType: z.literal('WorkerStopping'),
  payload: z.object({ reason: z.string() }),
})
```

And register them in the discriminated union.

- [ ] **Step 4: Reshape `merge_candidates` and queries**

Modify `apps/api/src/db/schema.ts`:

```ts
export const mergeCandidates = sqliteTable('merge_candidates', {
  id:                     text('id').primaryKey(),
  leadId:                 text('lead_id').notNull(),
  proposedWinnerWorkerId: text('proposed_winner_worker_id'),
  selectedWinnerWorkerId: text('selected_winner_worker_id'),
  targetBranch:           text('target_branch').notNull(),
  reviewerReasoning:      text('reviewer_reasoning'),
  selectionSource:        text('selection_source').notNull().default('proposal_accept'),
})
```

Modify `apps/api/src/db/queries.ts`:

```ts
export function getMergeCandidates(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      lead_id AS leadId,
      proposed_winner_worker_id AS proposedWinnerWorkerId,
      selected_winner_worker_id AS selectedWinnerWorkerId,
      selection_source AS selectionSource
    FROM merge_candidates
  `).all() as Array<{
    leadId: string
    proposedWinnerWorkerId: string | null
    selectedWinnerWorkerId: string | null
    selectionSource: 'proposal_accept' | 'user_override'
  }>
}
```

- [ ] **Step 5: Generate the Drizzle migration instead of writing SQL by hand**

Run:

```bash
cd apps/api && pnpm db:generate
```

Expected:
- Drizzle creates `apps/api/src/db/migrations/0002_user_gated_winner_selection.sql`
- Drizzle updates `apps/api/src/db/migrations/meta/*`

Review the generated SQL and confirm it rebuilds `merge_candidates` with:
- `proposed_winner_worker_id`
- `selected_winner_worker_id`
- `selection_source`

The data copy should preserve old rows by mapping:
- old `winner_worker_id` → both proposed and selected for legacy rows

- [ ] **Step 6: Update event tests to cover the new event names**

Add to `packages/types/src/events.test.ts`:

```ts
it('parses winner proposal and selection events', () => {
  expect(OrcEventSchema.parse({
    entityId: 'melody-lead',
    entityType: 'lead',
    eventType: 'WinnerProposed',
    sequence: 1,
    ts: 1,
    payload: { proposedWinnerId: 'melody-v1', reasoning: 'best hook' },
  }).eventType).toBe('WinnerProposed')

  expect(OrcEventSchema.parse({
    entityId: 'melody-lead',
    entityType: 'lead',
    eventType: 'WinnerSelected',
    sequence: 2,
    ts: 2,
    payload: { selectedWinnerId: 'melody-v2', selectionSource: 'user_override' },
  }).eventType).toBe('WinnerSelected')
})
```

- [ ] **Step 7: Run contract and query tests**

Run:

```bash
cd packages/types && pnpm vitest run
cd apps/api && pnpm vitest run src/db/queries.test.ts
```

Expected:
- all `@orc/types` tests pass
- `src/db/queries.test.ts` passes

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/commands.ts packages/types/src/commands.test.ts packages/types/src/events.ts packages/types/src/events.test.ts packages/types/src/api.ts apps/api/src/db/schema.ts apps/api/src/db/queries.ts apps/api/src/db/queries.test.ts apps/api/src/db/migrations apps/api/src/db/migrations/meta
git commit -m "feat: split proposed and selected winners"
```

## Task 2: Add the Lead Approval Gate

**Files:**
- Modify: `apps/api/src/orchestrator/worker.ts`
- Modify: `apps/api/src/orchestrator/lead.ts`
- Modify: `apps/api/src/orchestrator/lead.test.ts`

- [ ] **Step 1: Write the failing lead tests for proposal-only and user-finalized flows**

Add to `apps/api/src/orchestrator/lead.test.ts`:

```ts
it('reviewer proposes a winner and lead waits for user approval', async () => {
  repoDir = initTestRepo('lead-awaiting-approval-test')
  const db = createTestDb()
  const gov = new ConcurrencyGovernor(4)
  const q = new CommandQueue<any>()

  const lead = new LeadStateMachine({
    id: 'melody-lead',
    sectionId: 'melody',
    sectionGoal: 'Write melody',
    numWorkers: 2,
    baseBranch: 'main',
    runBranch: 'run/r1',
    runId: 'r1',
    repoRoot: repoDir,
    db,
    governor: gov,
    commandQueue: q,
    agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    llmCall: async p => {
      if (p.includes('Generate')) return JSON.stringify(['v1', 'v2'])
      return JSON.stringify({ winnerId: 'r1-melody-v1', reasoning: 'best phrase' })
    },
  })

  const runPromise = lead.run()
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(lead.state).toBe('awaiting_user_approval')

  let settled = false
  void runPromise.then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(settled).toBe(false)

  q.enqueue({ commandType: 'AcceptProposal' })
  const result = await runPromise
  expect(result.status).toBe('done')
  expect(result.winnerBranch).toBe('feat/r1-melody-v1')
})

it('user can override the reviewer proposal', async () => {
  repoDir = initTestRepo('lead-user-override-test')
  const db = createTestDb()
  const gov = new ConcurrencyGovernor(4)
  const q = new CommandQueue<any>()

  const lead = new LeadStateMachine({
    id: 'bass-lead',
    sectionId: 'bass',
    sectionGoal: 'Write bass',
    numWorkers: 2,
    baseBranch: 'main',
    runBranch: 'run/r2',
    runId: 'r2',
    repoRoot: repoDir,
    db,
    governor: gov,
    commandQueue: q,
    agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    llmCall: async p => {
      if (p.includes('Generate')) return JSON.stringify(['v1', 'v2'])
      return JSON.stringify({ winnerId: 'r2-bass-v1', reasoning: 'reviewer preferred v1' })
    },
  })

  const runPromise = lead.run()
  await new Promise(resolve => setTimeout(resolve, 50))
  q.enqueue({ commandType: 'SelectWinner', workerId: 'r2-bass-v2' })
  const result = await runPromise

  expect(result.status).toBe('done')
  expect(result.winnerBranch).toBe('feat/r2-bass-v2')
  expect(result.reasoning).toBe('user override')
})
```

- [ ] **Step 2: Run the lead tests to confirm the current auto-finalizing flow is wrong**

Run:

```bash
cd apps/api && pnpm vitest run src/orchestrator/lead.test.ts
```

Expected:
- tests fail because `LeadState` has no `awaiting_user_approval`
- `run()` completes before user approval arrives

- [ ] **Step 3: Add a real stopping state to workers**

Modify `apps/api/src/orchestrator/worker.ts`:

```ts
export type WorkerState =
  | 'queued'
  | 'spawning'
  | 'running'
  | 'stopping'
  | 'stalled'
  | 'zombie'
  | 'done'
  | 'failed'
  | 'retrying'
  | 'cancelled'

async abort(): Promise<void> {
  if (this.slotHeld) { this.cfg.governor.release(); this.slotHeld = false }
  this.state = 'stopping'
  this.emit('WorkerStopping', { reason: 'lead selected another winner' })
  await this.agent?.abort()
  this.state = 'cancelled'
  this.emit('WorkerFailed', { error: 'aborted', retryable: false })
}
```

- [ ] **Step 4: Refactor the lead state machine to pause after review**

Modify the type and helper structure in `apps/api/src/orchestrator/lead.ts`:

```ts
export type LeadState =
  | 'idle'
  | 'planning'
  | 'running'
  | 'reviewing'
  | 'awaiting_user_approval'
  | 'merging'
  | 'done'
  | 'failed'

type CompletedWorker = { workerId: string; diff: string; branch: string }

private persistProposal(proposedWinnerId: string, reasoning: string): void {
  getSQLite(this.cfg.db).prepare(`
    INSERT INTO merge_candidates(
      id,
      lead_id,
      proposed_winner_worker_id,
      selected_winner_worker_id,
      target_branch,
      reviewer_reasoning,
      selection_source
    ) VALUES (?, ?, ?, NULL, ?, ?, 'proposal_accept')
    ON CONFLICT(id) DO UPDATE SET
      proposed_winner_worker_id=excluded.proposed_winner_worker_id,
      reviewer_reasoning=excluded.reviewer_reasoning
  `).run(this.cfg.id, this.cfg.id, proposedWinnerId, this.cfg.runBranch, reasoning)
}

private persistSelection(selectedWinnerId: string, selectionSource: 'proposal_accept' | 'user_override'): void {
  getSQLite(this.cfg.db).prepare(`
    UPDATE merge_candidates
    SET selected_winner_worker_id=?, selection_source=?
    WHERE id=?
  `).run(selectedWinnerId, selectionSource, this.cfg.id)
}
```

- [ ] **Step 5: Replace the auto-finalizing reviewer block with an approval gate**

Inside `run()` in `apps/api/src/orchestrator/lead.ts`, replace the current review/abort/merge-candidate block with:

```ts
this.state = 'reviewing'

let proposedWinnerId = done[0].workerId
let reasoning = 'first available'
const reviewPrompt = this.ctx.buildReviewerPrompt(this.cfg.sectionGoal, done)

try {
  const raw = await this.cfg.llmCall(reviewPrompt)
  const rev = JSON.parse(raw)
  if (rev.winnerId) {
    proposedWinnerId = rev.winnerId
    reasoning = rev.reasoning
  }
} catch {}

this.persistProposal(proposedWinnerId, reasoning)
this.emit('WinnerProposed', { proposedWinnerId, reasoning })
this.state = 'awaiting_user_approval'

let selectedWinnerId: string | null = null
let selectionSource: 'proposal_accept' | 'user_override' = 'proposal_accept'

while (!selectedWinnerId) {
  const cmd = await this.cfg.commandQueue.dequeue()

  if (cmd.commandType === 'AcceptProposal') {
    selectedWinnerId = proposedWinnerId
    selectionSource = 'proposal_accept'
  } else if (cmd.commandType === 'SelectWinner' && done.some(d => d.workerId === cmd.workerId)) {
    selectedWinnerId = cmd.workerId
    selectionSource = cmd.workerId === proposedWinnerId ? 'proposal_accept' : 'user_override'
  } else if (cmd.commandType === 'Abort') {
    const w = workers.find(x => x.id === cmd.targetWorkerId)
    if (w) await w.abort()
  }
}

this.persistSelection(selectedWinnerId, selectionSource)
this.emit('WinnerSelected', { selectedWinnerId, selectionSource })
this.state = 'merging'

const winner = done.find(d => d.workerId === selectedWinnerId) ?? done[0]
await Promise.all(
  workers
    .filter(w => w.id !== winner.workerId)
    .map(w => w.abort().catch(() => undefined))
)

this.emit('MergeRequested', { leadId: this.cfg.id, worktreeId: winner.workerId, targetBranch: this.cfg.runBranch })
this.state = 'done'
this.emit('LeadDone', { branch: winner.branch, sectionId: this.cfg.sectionId })
return {
  status: 'done',
  winnerBranch: winner.branch,
  reasoning: selectionSource === 'user_override' ? 'user override' : reasoning,
}
```

- [ ] **Step 6: Run the lead tests**

Run:

```bash
cd apps/api && pnpm vitest run src/orchestrator/lead.test.ts
```

Expected:
- proposal gate test passes
- override test passes
- existing tests are updated to use `AcceptProposal` / `SelectWinner` instead of `ForceApprove`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/orchestrator/worker.ts apps/api/src/orchestrator/lead.ts apps/api/src/orchestrator/lead.test.ts
git commit -m "feat: gate lead completion on user approval"
```

## Task 3: Expose Approval State Through the API

**Files:**
- Modify: `apps/api/src/server/routes.ts`
- Modify: `apps/api/src/server/routes.test.ts`

- [ ] **Step 1: Write the failing route tests for the new payload and approve semantics**

Update `apps/api/src/server/routes.test.ts` with:

```ts
it('POST /api/approve accepts a proposal without a worker id', async () => {
  const db = createTestDb()
  const leadQ = new CommandQueue<any>()
  const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

  const res = await request(app).post('/api/approve').send({ leadId: 'melody-lead' })

  expect(res.status).toBe(202)
  expect(await leadQ.dequeue()).toEqual({ commandType: 'AcceptProposal' })
})

it('POST /api/approve selects an explicit winner when workerId is provided', async () => {
  const db = createTestDb()
  const leadQ = new CommandQueue<any>()
  const app = createApp({ db, leadQueues: new Map([['melody-lead', leadQ]]) })

  const res = await request(app).post('/api/approve').send({
    leadId: 'melody-lead',
    workerId: 'melody-v2',
  })

  expect(res.status).toBe(202)
  expect(await leadQ.dequeue()).toEqual({
    commandType: 'SelectWinner',
    workerId: 'melody-v2',
  })
})
```

Replace the old orchestration test seeding and expectation with the richer payload:

```ts
const now = Date.now()
sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run('melody-lead', 'lead', 'mastermind', 'awaiting_user_approval', now, now)
sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run('melody-v1', 'worker', 'melody-lead', 'done', now, now)
sqlite.prepare(`INSERT INTO tasks (id, type, parent_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run('melody-v2', 'worker', 'melody-lead', 'stopping', now, now)
upsertWorktree(db, 'melody-v1', 'melody-v1', '/tmp/melody-v1', 'feat/melody-v1', 'main')
upsertWorktree(db, 'melody-v2', 'melody-v2', '/tmp/melody-v2', 'feat/melody-v2', 'main')
sqlite.prepare(`
  INSERT INTO merge_candidates(
    id,
    lead_id,
    proposed_winner_worker_id,
    selected_winner_worker_id,
    target_branch,
    reviewer_reasoning,
    selection_source
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'melody-lead',
  'melody-lead',
  'melody-v1',
  'melody-v2',
  'run/test',
  'reviewer preferred v1',
  'user_override',
)

expect(melodySection).toMatchObject({
  id: 'melody',
  state: 'awaiting_user_approval',
  proposedWinnerId: 'melody-v1',
  selectedWinnerId: 'melody-v2',
  awaitingUserApproval: true,
})

expect(melodySection.workers[0]).toMatchObject({
  id: 'melody-v1',
  isProposed: true,
  isSelected: false,
  isStopping: false,
})

expect(melodySection.workers[1]).toMatchObject({
  id: 'melody-v2',
  isProposed: false,
  isSelected: true,
  isStopping: true,
})
```

- [ ] **Step 2: Run the route tests**

Run:

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

Expected:
- `/api/approve` tests fail because the route still requires `workerId`
- `/api/orchestration` test fails because it does not return proposal/selection flags

- [ ] **Step 3: Update `/api/orchestration` to return authoritative approval state**

Modify `apps/api/src/server/routes.ts`:

```ts
const sections = tasks.filter(t => t.type === 'lead').map(lead => {
  const candidate = mergeCandidates.find(c => c.leadId === lead.id)

  return {
    id: lead.id.replace('-lead', ''),
    state: lead.state,
    proposedWinnerId: candidate?.proposedWinnerWorkerId ?? null,
    selectedWinnerId: candidate?.selectedWinnerWorkerId ?? null,
    awaitingUserApproval: lead.state === 'awaiting_user_approval',
    workers: tasks
      .filter(t => t.type === 'worker' && t.parentId === lead.id)
      .map(w => {
        const wt = worktrees.find(x => x.workerId === w.id)
        const previewArtifacts = previews
          .filter(p => p.workerId === w.id)
          .map(p => ({ mode: p.mode, previewUrl: p.previewUrl }))
        const upstreamLeadIds = taskEdges
          .filter(edge => edge.edgeType === 'depends_on' && edge.childId === lead.id)
          .map(edge => edge.parentId)
        const contextAvailable = upstreamLeadIds.length > 0 && upstreamLeadIds.every(depLeadId =>
          mergeCandidates.some(c => c.leadId === depLeadId && c.selectedWinnerWorkerId)
        )

        return {
          id: w.id,
          state: w.state,
          branch: wt?.branch,
          isProposed: candidate?.proposedWinnerWorkerId === w.id,
          isSelected: candidate?.selectedWinnerWorkerId === w.id,
          isStopping: w.state === 'stopping',
          contextAvailable,
          previewArtifacts,
        }
      }),
  }
})
```

- [ ] **Step 4: Update `/api/approve` to enqueue the right user-finalization command**

Replace the route body in `apps/api/src/server/routes.ts` with:

```ts
r.post('/approve', (req, res) => {
  const { workerId, leadId } = req.body as { workerId?: string; leadId?: string }
  if (!leadId) {
    res.status(400).json({ error: 'leadId required' })
    return
  }

  const q = leadQueues.get(leadId)
  if (!q) {
    res.status(404).json({ error: `lead queue not found for ${leadId}` })
    return
  }

  if (workerId) q.enqueue({ commandType: 'SelectWinner', workerId })
  else q.enqueue({ commandType: 'AcceptProposal' })

  res.status(202).json({ ok: true })
})
```

- [ ] **Step 5: Run the route tests again**

Run:

```bash
cd apps/api && pnpm vitest run src/server/routes.test.ts
```

Expected:
- all route tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server/routes.ts apps/api/src/server/routes.test.ts
git commit -m "feat: expose winner approval state in api"
```

## Task 4: Keep ORC Alive in `review_ready`

**Files:**
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Modify: `apps/api/src/orchestrator/mastermind.test.ts`
- Create: `apps/api/src/runtime/reviewReady.ts`
- Create: `apps/api/src/runtime/reviewReady.test.ts`
- Modify: `apps/api/src/cli.ts`

- [ ] **Step 1: Write the failing runtime tests**

Add to `apps/api/src/orchestrator/mastermind.test.ts`:

```ts
it('enters review_ready after all merges succeed', async () => {
  repoDir = initTestRepo('mastermind-review-ready-test')
  const db = createTestDb()
  const gov = new ConcurrencyGovernor(4)
  const leadQueues = new Map<string, CommandQueue<any>>()

  const m = new MastermindStateMachine({
    repoRoot: repoDir,
    db,
    governor: gov,
    runId: 'r4',
    baseBranch: 'main',
    leadQueues,
    agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    llmCall: async p => {
      if (p.includes('Decompose')) return JSON.stringify([{ id: 'arrangement', goal: 'Write arrangement', numWorkers: 1, dependsOn: [] }])
      if (p.includes('Generate')) return JSON.stringify(['only variation'])
      return JSON.stringify({ winnerId: 'r4-arrangement-v1', reasoning: 'only one' })
    },
  })

  const autoApprove = setInterval(() => {
    const q = leadQueues.get('arrangement-lead')
    if (q && q.size === 0) q.enqueue({ commandType: 'AcceptProposal' })
  }, 10)

  const result = await m.run({ userGoal: 'Build track' })
  clearInterval(autoApprove)

  expect(result.status).toBe('review_ready')
  expect(m.state).toBe('review_ready')
})
```

Update the two existing happy-path tests in `apps/api/src/orchestrator/mastermind.test.ts` to use the same `leadQueues + autoApprove` pattern, otherwise they will block forever once leads stop auto-finalizing.

Create `apps/api/src/runtime/reviewReady.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { waitForShutdownSignal } from './reviewReady'

describe('waitForShutdownSignal', () => {
  it('resolves only after SIGINT', async () => {
    const wait = waitForShutdownSignal()
    process.emit('SIGINT')
    await expect(wait).resolves.toBe('SIGINT')
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts src/runtime/reviewReady.test.ts
```

Expected:
- `mastermind.test.ts` fails because `status` and state are still `done`
- `reviewReady.test.ts` fails because the helper does not exist

- [ ] **Step 3: Add the review-ready helper**

Create `apps/api/src/runtime/reviewReady.ts`:

```ts
export function waitForShutdownSignal(
  signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): Promise<NodeJS.Signals> {
  return new Promise(resolve => {
    const disposers = signals.map(signal => {
      const handler = () => {
        for (const [s, h] of disposers) process.off(s, h)
        resolve(signal)
      }
      process.once(signal, handler)
      return [signal, handler] as const
    })
  })
}
```

- [ ] **Step 4: Replace mastermind `done` with `review_ready`**

Modify `apps/api/src/orchestrator/mastermind.ts`:

```ts
export type MastermindState =
  | 'idle'
  | 'planning'
  | 'delegating'
  | 'monitoring'
  | 'merging'
  | 'review_ready'
  | 'failed'
```

And replace the success tail of `run()`:

```ts
this.state = 'review_ready'
this.emit('OrchestrationComplete', { runBranch })
return { status: 'review_ready', runBranch }
```

- [ ] **Step 5: Update the CLI success path to hold open**

Modify the success tail in `apps/api/src/cli.ts`:

```ts
import { waitForShutdownSignal } from './runtime/reviewReady'
```

Then replace:

```ts
console.log(`[orc] orchestration ${result.status}`)
unregisterCleanup()
dashboard.stop()
server.close(() => process.exit(result.status === 'done' ? 0 : 1))
```

with:

```ts
if (result.status === 'review_ready') {
  unregisterCleanup()
  console.log(`[orc] orchestration complete; review ready at ${dashboard.url} | press Ctrl+C to shut down`)
  await waitForShutdownSignal()
  dashboard.stop()
  server.close(() => process.exit(0))
  return
}

console.log(`[orc] orchestration ${result.status}`)
unregisterCleanup()
dashboard.stop()
server.close(() => process.exit(1))
```

- [ ] **Step 6: Run the runtime tests**

Run:

```bash
cd apps/api && pnpm vitest run src/orchestrator/mastermind.test.ts src/runtime/reviewReady.test.ts
```

Expected:
- both tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/orchestrator/mastermind.ts apps/api/src/orchestrator/mastermind.test.ts apps/api/src/runtime/reviewReady.ts apps/api/src/runtime/reviewReady.test.ts apps/api/src/cli.ts
git commit -m "feat: keep orc alive in review-ready state"
```

## Task 5: Build the Approval Banner, Winner Feedback, and Final Review UI

**Files:**
- Create: `apps/web/src/lib/reviewState.ts`
- Create: `apps/web/src/lib/reviewState.test.ts`
- Create: `apps/web/src/lib/previewActions.ts`
- Modify: `apps/web/src/hooks/useOrchestration.ts`
- Modify: `apps/web/src/components/DetailPanel.tsx`
- Modify: `apps/web/src/components/TreePanel.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write pure helper tests for proposed/selected/final-review lookup**

Create `apps/web/src/lib/reviewState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { OrchState, SectionInfo } from '@orc/types'
import { getFinalReviewWorker, getProposedWorker, getSelectedWorker } from './reviewState'

describe('reviewState helpers', () => {
  const melodySection: SectionInfo = {
    id: 'melody',
    state: 'awaiting_user_approval',
    proposedWinnerId: 'melody-v1',
    selectedWinnerId: 'melody-v2',
    awaitingUserApproval: true,
    workers: [
      { id: 'melody-v1', state: 'done', isProposed: true, isSelected: false, isStopping: false, contextAvailable: true, previewArtifacts: [] },
      { id: 'melody-v2', state: 'done', isProposed: false, isSelected: true, isStopping: false, contextAvailable: true, previewArtifacts: [] },
    ],
  }

  it('finds proposed and selected workers', () => {
    expect(getProposedWorker(melodySection)?.id).toBe('melody-v1')
    expect(getSelectedWorker(melodySection)?.id).toBe('melody-v2')
  })

  it('prefers arrangement as the final review worker', () => {
    const state: OrchState = {
      runId: 'r1',
      mastermindState: 'review_ready',
      sections: [
        melodySection,
        {
          id: 'arrangement',
          state: 'done',
          proposedWinnerId: 'arrangement-v1',
          selectedWinnerId: 'arrangement-v1',
          awaitingUserApproval: false,
          workers: [
            {
              id: 'arrangement-v1',
              state: 'done',
              isProposed: true,
              isSelected: true,
              isStopping: false,
              contextAvailable: true,
              previewArtifacts: [{ mode: 'solo', previewUrl: 'https://strudel.cc/#final' }],
            },
          ],
        },
      ],
    }

    expect(getFinalReviewWorker(state)?.id).toBe('arrangement-v1')
  })
})
```

- [ ] **Step 2: Run the failing helper test**

Run:

```bash
cd apps/web && pnpm vitest run src/lib/reviewState.test.ts
```

Expected:
- fails because `reviewState.ts` does not exist

- [ ] **Step 3: Add pure helpers for proposal/selection/final review**

Create `apps/web/src/lib/reviewState.ts`:

```ts
import type { OrchState, SectionInfo, WorkerInfo } from '@orc/types'

export function getProposedWorker(section: SectionInfo | undefined): WorkerInfo | undefined {
  return section?.workers.find(worker => worker.isProposed)
}

export function getSelectedWorker(section: SectionInfo | undefined): WorkerInfo | undefined {
  return section?.workers.find(worker => worker.isSelected)
}

export function getFinalReviewWorker(state: OrchState | undefined): WorkerInfo | undefined {
  if (!state || state.mastermindState !== 'review_ready') return undefined

  const arrangement = state.sections.find(section => section.id === 'arrangement')
  return getSelectedWorker(arrangement)
    ?? [...state.sections].reverse().map(getSelectedWorker).find(Boolean)
    ?? undefined
}
```

- [ ] **Step 4: Add a shared preview launcher so page and detail panel stay DRY**

Create `apps/web/src/lib/previewActions.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export async function launchWorkerPreview(
  queryClient: QueryClient,
  workerId: string,
  mode: 'solo' | 'contextual',
): Promise<{ previewUrl: string } | null> {
  const previewTab = window.open('about:blank', '_blank', 'noopener,noreferrer')
  const res = await fetch(`${API}/api/preview/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId, mode }),
  })

  if (!res.ok) {
    previewTab?.close()
    return null
  }

  const artifact = await res.json() as { previewUrl: string }
  previewTab?.location.assign(artifact.previewUrl)
  await queryClient.invalidateQueries({ queryKey: ['orchestration'] })
  return artifact
}
```

- [ ] **Step 5: Update the orchestration hook for the new states**

Modify `apps/web/src/hooks/useOrchestration.ts`:

```ts
const workerStateMap: Record<string, string> = {
  WorkerDone: 'done',
  WorkerFailed: 'failed',
  WorkerStalled: 'stalled',
  WorkerZombie: 'zombie',
  WorkerRecovered: 'running',
  WorkerProgress: 'running',
  WorkerStopping: 'stopping',
}

const leadStateMap: Record<string, string> = {
  LeadPlanReady: 'running',
  ReviewComplete: 'reviewing',
  WinnerProposed: 'awaiting_user_approval',
  MergeRequested: 'merging',
  LeadDone: 'done',
  LeadFailed: 'failed',
}

const mastermindStateMap: Record<string, string> = {
  PlanReady: 'delegating',
  OrchestrationComplete: 'review_ready',
  OrchestrationFailed: 'failed',
}
```

- [ ] **Step 6: Add explicit approval UX in `DetailPanel`**

Modify `apps/web/src/components/DetailPanel.tsx` with these structural changes:

```tsx
const [pendingWinnerId, setPendingWinnerId] = useState<string | null>(null)
const proposedWorker = getProposedWorker(section)
const selectedWorker = getSelectedWorker(section)

async function approveProposal(leadId: string) {
  setPendingWinnerId(proposedWorker?.id ?? null)
  const res = await fetch(`${API}/api/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId }),
  })
  if (res.ok) await qc.invalidateQueries({ queryKey: ['orchestration'] })
  setPendingWinnerId(null)
}

async function pickWinner(workerId: string, leadId: string) {
  setPendingWinnerId(workerId)
  const res = await fetch(`${API}/api/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId, leadId }),
  })
  if (res.ok) await qc.invalidateQueries({ queryKey: ['orchestration'] })
  setPendingWinnerId(null)
}
```

Render the approval banner above the worker cards:

```tsx
{section.awaitingUserApproval && proposedWorker && (
  <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-4 mb-4">
    <div className="text-[11px] text-amber-200">
      Mastermind: I think <span className="font-mono">{proposedWorker.id}</span> is the best variant for this lane.
    </div>
    <div className="flex gap-2 mt-3">
      <button
        onClick={() => approveProposal(`${section.id}-lead`)}
        className="text-[11px] bg-emerald-500/12 hover:bg-emerald-500/22 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/25"
      >
        Accept
      </button>
      <button
        onClick={() => launchWorkerPreview(qc, proposedWorker.id, 'solo')}
        className="text-[11px] bg-blue-500/12 hover:bg-blue-500/22 text-blue-400 px-2.5 py-1 rounded border border-blue-500/25"
      >
        Open preview
      </button>
    </div>
  </div>
)}
```

Update badges and button labels on each worker card:

```tsx
{w.isProposed && (
  <span className="text-[10px] text-amber-300 border border-amber-400/30 rounded px-2 py-0.5">
    PROPOSED
  </span>
)}
{w.isSelected && (
  <span className="text-[10px] text-emerald-300 border border-emerald-400/30 rounded px-2 py-0.5">
    SELECTED WINNER
  </span>
)}
{pendingWinnerId === w.id && (
  <span className="text-[10px] text-blue-300 border border-blue-400/30 rounded px-2 py-0.5">
    SELECTING...
  </span>
)}
{w.isStopping && (
  <span className="text-[10px] text-amber-300 border border-amber-400/30 rounded px-2 py-0.5">
    STOPPING SIBLINGS...
  </span>
)}
```

And replace direct preview launch calls with `launchWorkerPreview(qc, w.id, mode)`.

- [ ] **Step 7: Add review-ready affordances in `TreePanel` and `page.tsx`**

Extend `STATE_DOT`/badge maps in both files:

```ts
awaiting_user_approval: 'bg-amber-400 animate-pulse',
review_ready: 'bg-emerald-400',
```

In `apps/web/src/app/page.tsx`, add a persistent review-ready card:

```tsx
const qc = useQueryClient()
const finalReviewWorker = getFinalReviewWorker(data)

{mState === 'review_ready' && finalReviewWorker && (
  <div className="mx-4 mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 flex items-center gap-3">
    <div className="flex-1 min-w-0">
      <div className="text-[11px] text-emerald-300 font-medium">Review ready</div>
      <div className="text-[10px] text-emerald-100/80">
        Full song is ready to audition. ORC will stay alive until you press Ctrl+C in the terminal.
      </div>
    </div>
    <button
      onClick={() => launchWorkerPreview(qc, finalReviewWorker.id, 'solo')}
      className="text-[11px] bg-emerald-500/12 hover:bg-emerald-500/22 text-emerald-300 px-3 py-1.5 rounded border border-emerald-500/25"
    >
      ▶ Launch full song preview
    </button>
  </div>
)}
```

- [ ] **Step 8: Run web verification**

Run:

```bash
cd apps/web && pnpm vitest run src/lib/reviewState.test.ts
cd apps/web && pnpm build
```

Expected:
- helper test passes
- `next build` passes

Then perform a manual browser check:

1. start ORC in mock mode
2. wait for a lead to enter `awaiting_user_approval`
3. confirm the banner appears
4. click `Pick this one instead`
5. confirm the card shows `Selecting...` immediately
6. confirm the selected card later shows `Selected winner`
7. complete the run and confirm the review-ready banner appears without process exit

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/reviewState.ts apps/web/src/lib/reviewState.test.ts apps/web/src/lib/previewActions.ts apps/web/src/hooks/useOrchestration.ts apps/web/src/components/DetailPanel.tsx apps/web/src/components/TreePanel.tsx apps/web/src/app/page.tsx
git commit -m "feat: add user approval and review-ready dashboard ux"
```

## Task 6: End-to-End Verification

**Files:**
- Modify only if a verification failure exposes a real bug in the tasks above

- [ ] **Step 1: Run the backend and shared test suites**

Run:

```bash
cd packages/types && pnpm vitest run
cd apps/api && pnpm vitest run
```

Expected:
- all shared type tests pass
- all API tests pass

- [ ] **Step 2: Run the web verification suite**

Run:

```bash
cd apps/web && pnpm vitest run src/lib/reviewState.test.ts
cd apps/web && pnpm build
```

Expected:
- helper test passes
- web build passes

- [ ] **Step 3: Run a realistic ORC flow in mock mode**

Run:

```bash
cd apps/api && ORC_DASHBOARD_PORT=3316 ORC_PORT=4010 pnpm orc -- run "lets create a song like pacific rim" --mock --run-id review-ready-e2e -m 2
```

Expected terminal behavior:

```text
[orc] dashboard → http://127.0.0.1:3316  |  api → http://localhost:4010
[orc] run "lets create a song like pacific rim" (run-id: review-ready-e2e)
...
[orc] orchestration complete; review ready at http://127.0.0.1:3316 | press Ctrl+C to shut down
```

Important:
- process must still be alive after that line
- the line only appears after you approve every waiting lead in the dashboard
- it must only exit after `Ctrl+C`

- [ ] **Step 4: Verify the UI manually against the approved behavior**

Manual checklist:

- reviewer proposal appears as a visible banner
- `Accept` finalizes the proposed worker
- `Pick this one instead` overrides the proposal
- worker cards show `PROPOSED`, `SELECTED WINNER`, and `STOPPING SIBLINGS...` when appropriate
- final review banner appears when the run reaches `review_ready`
- `Launch full song preview` opens Strudel
- terminal `Ctrl+C` shuts down ORC cleanly

- [ ] **Step 5: Commit any follow-up fixes**

```bash
git add <only files changed during verification fixes>
git commit -m "fix: polish review-ready winner selection flow"
```

## Self-Review

- Spec coverage:
  - proposal vs selection split: Task 1
  - lead approval gate: Task 2
  - `/api/approve` semantics and enriched payload: Task 3
  - `review_ready` mastermind + CLI no-exit: Task 4
  - dashboard banner/badges/progressive UX/final review surface: Task 5
  - end-to-end review flow: Task 6
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to above” references remain
- Type consistency:
  - commands use `AcceptProposal` / `SelectWinner` everywhere
  - payload fields use `proposedWinnerId`, `selectedWinnerId`, `awaitingUserApproval`, `isProposed`, `isSelected`, `isStopping`
  - mastermind success state is `review_ready` consistently
