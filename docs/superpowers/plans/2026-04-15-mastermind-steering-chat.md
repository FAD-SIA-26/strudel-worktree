# Mastermind Steering Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real user-facing steering chat for `mastermind` that persists transcript messages, routes them through a separate mastermind command path, and renders the chat inside the existing dashboard detail panel.

**Architecture:** Keep steering isolated from existing lead commands. Add a separate shared `MastermindCommand` contract, a persisted `steering_messages` table, a thin API service for `GET /api/steer` and `POST /api/steer`, and a deterministic mastermind steering handler that folds the last handled user messages into future prompt context. On the frontend, make the existing mastermind node selectable in `TreePanel`, add a mastermind branch inside `DetailPanel`, and fetch transcript state through a dedicated React Query hook that appends the POST response and then replaces local cache state from the refetched server transcript.

**Tech Stack:** TypeScript, Zod, Express, SQLite/Drizzle, Next.js, React Query, Vitest

---

## Execution Preconditions

- Execute this plan in a **fresh git worktree from the current committed branch HEAD**, not in the existing dirty workspace.
- Do **not** mix this work with the unrelated untracked plan file already present in this workspace:
  - `docs/superpowers/plans/2026-04-15-dashboard-entity-detail-rendering.md`
- Use package-local commands with `COREPACK_ENABLE_STRICT=0` because root `pnpm build` and `pnpm test` currently fail in this repo due the missing root `packageManager` field.
- Treat the current codebase as the baseline:
  - `/api/steer` is still a stub in `apps/api/src/server/routes.ts`
  - `TreePanel` still renders `mastermind` as a non-selectable row
  - `DetailPanel` still branches only on lead vs worker
  - `packages/types/src/commands.ts` still defines only lead/worker command types
- This plan implements the steering-chat slice only. It must remain compatible with the later user-gated winner-selection work by handling both current mastermind states (`merging`, `done`) and future-approved spec states (`merging_lanes`, `review_ready`) in the steerability helper.

## File Structure / Planned Changes

- Create: `packages/types/src/mastermindCommands.ts`
  - Define the separate `MastermindCommandSchema` and `Steer` command.
- Create: `packages/types/src/mastermindCommands.test.ts`
  - Lock in the mastermind-only command contract.
- Create: `packages/types/src/steering.ts`
  - Define transcript message, steer request, and steer response schemas.
- Create: `packages/types/src/steering.test.ts`
  - Verify transcript and API payload schemas.
- Modify: `packages/types/src/index.ts`
  - Re-export the new steering and mastermind command types.

- Modify: `apps/api/src/db/schema.ts`
  - Add the `steering_messages` table.
- Create: `apps/api/src/db/steeringQueries.ts`
  - Encapsulate steering transcript persistence and reads.
- Create: `apps/api/src/db/steeringQueries.test.ts`
  - Verify inserts, reply linkage, and ordered transcript reads.
- Create: `apps/api/src/db/migrations/0002_mastermind_steering_chat.sql`
  - Migration for `steering_messages`.
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
  - Register the new migration.
- Generate or modify: `apps/api/src/db/migrations/meta/0002_snapshot.json`
  - Drizzle snapshot for the new table.

- Create: `apps/api/src/orchestrator/mastermindSteering.ts`
  - Deterministic reply templating, steerability rules, and guidance folding.
- Create: `apps/api/src/orchestrator/mastermindSteering.test.ts`
  - Verify reply templates, guidance truncation, and steerability.
- Modify: `apps/api/src/orchestrator/context.ts`
  - Accept a steering-guidance block in mastermind and PM prompts.
- Modify: `apps/api/src/orchestrator/mastermind.ts`
  - Add a mastermind queue, process `Steer` commands, persist replies, and include guidance in future prompt building.
- Modify: `apps/api/src/orchestrator/mastermind.test.ts`
  - Cover command consumption and future prompt folding.

- Create: `apps/api/src/server/steeringService.ts`
  - Thin service for current-run resolution, transcript loading, and route-level validation.
- Modify: `apps/api/src/server/app.ts`
  - Accept `mastermindQueues` and `getCurrentRunId`.
- Modify: `apps/api/src/server/routes.ts`
  - Add `GET /api/steer`, replace the `/api/steer` stub, and keep the route thin via `steeringService`.
- Modify: `apps/api/src/server/routes.test.ts`
  - Cover `GET /api/steer`, `POST /api/steer`, non-steerable runs, and queue registration errors.
- Modify: `apps/api/src/cli.ts`
  - Register the current run id and mastermind queue in app dependencies.

- Create: `apps/web/src/lib/steeringCache.ts`
  - Response-append and refetch-replace helpers keyed by message id.
- Create: `apps/web/src/lib/steeringCache.test.ts`
  - Verify transcript replacement semantics and no-duplicate merging.
- Create: `apps/web/src/hooks/useSteering.ts`
  - Fetch transcript, post messages, and replace transcript state from server data.
- Create: `apps/web/src/components/MastermindPanel.tsx`
  - Chat transcript and composer UI for the mastermind detail branch.
- Modify: `apps/web/src/components/TreePanel.tsx`
  - Make the mastermind row selectable.
- Modify: `apps/web/src/components/DetailPanel.tsx`
  - Add the `selectedId === 'mastermind'` branch and render `MastermindPanel`.
- Modify: `apps/web/src/app/page.tsx`
  - Keep `selected` compatible with the new mastermind entity and update the header helper copy to mention steering.
- Modify: `apps/web/src/hooks/useOrchestration.ts`
  - Keep mastermind state mapping compatible with current and future steerability states.

## Task 1: Add Steering Contracts and Transcript Persistence

**Files:**
- Create: `packages/types/src/mastermindCommands.ts`
- Create: `packages/types/src/mastermindCommands.test.ts`
- Create: `packages/types/src/steering.ts`
- Create: `packages/types/src/steering.test.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/steeringQueries.ts`
- Create: `apps/api/src/db/steeringQueries.test.ts`
- Create: `apps/api/src/db/migrations/0002_mastermind_steering_chat.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Generate or modify: `apps/api/src/db/migrations/meta/0002_snapshot.json`

- [ ] **Step 1: Write the failing shared-contract tests**

Create `packages/types/src/mastermindCommands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MastermindCommandSchema } from './mastermindCommands'

describe('MastermindCommandSchema', () => {
  it('parses a steer command', () => {
    expect(MastermindCommandSchema.parse({
      commandType: 'Steer',
      runId: 'run-123',
      messageId: 42,
    })).toEqual({
      commandType: 'Steer',
      runId: 'run-123',
      messageId: 42,
    })
  })
})
```

Create `packages/types/src/steering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SteeringTranscriptResponseSchema } from './steering'

describe('SteeringTranscriptResponseSchema', () => {
  it('parses a read-only mastermind transcript response', () => {
    expect(SteeringTranscriptResponseSchema.parse({
      runId: 'run-123',
      steerable: false,
      messages: [
        {
          id: 1,
          runId: 'run-123',
          role: 'user',
          body: 'Make the arrangement sparser',
          status: 'handled',
          createdAt: 1000,
          handledAt: 1010,
          inReplyToId: null,
          error: null,
        },
        {
          id: 2,
          runId: 'run-123',
          role: 'mastermind',
          body: 'Guidance noted. It will affect future work only; completed outputs stay unchanged.',
          status: 'handled',
          createdAt: 1011,
          handledAt: 1011,
          inReplyToId: 1,
          error: null,
        },
      ],
    }).steerable).toBe(false)
  })
})
```

Create `apps/api/src/db/steeringQueries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './client'
import {
  createSteeringMessage,
  markSteeringMessageHandled,
  listSteeringMessages,
} from './steeringQueries'

describe('steeringQueries', () => {
  it('stores transcript messages in created order with reply linkage', () => {
    const db = createTestDb()
    const user = createSteeringMessage(db, {
      runId: 'run-123',
      role: 'user',
      body: 'Make the drums lighter',
      status: 'pending',
      inReplyToId: null,
      error: null,
    })

    const reply = createSteeringMessage(db, {
      runId: 'run-123',
      role: 'mastermind',
      body: 'Constraint noted. I will apply this guidance to upcoming planning and retries.',
      status: 'handled',
      inReplyToId: user.id,
      error: null,
    })

    markSteeringMessageHandled(db, user.id)

    expect(listSteeringMessages(db, 'run-123')).toEqual([
      expect.objectContaining({ id: user.id, role: 'user', inReplyToId: null, status: 'handled' }),
      expect.objectContaining({ id: reply.id, role: 'mastermind', inReplyToId: user.id, status: 'handled' }),
    ])
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/packages/types
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/mastermindCommands.test.ts src/steering.test.ts
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/db/steeringQueries.test.ts
```

Expected:
- packages/types tests fail because the new files are not implemented or exported
- API test fails because `steering_messages` and `steeringQueries` do not exist

- [ ] **Step 3: Add the shared steering contracts**

Create `packages/types/src/mastermindCommands.ts`:

```ts
import { z } from 'zod'

export const SteerCmd = z.object({
  commandType: z.literal('Steer'),
  runId: z.string(),
  messageId: z.number().int().positive(),
})

export const MastermindCommandSchema = z.discriminatedUnion('commandType', [SteerCmd])

export type MastermindCommand = z.infer<typeof MastermindCommandSchema>
```

Create `packages/types/src/steering.ts`:

```ts
import { z } from 'zod'

export const SteeringMessageSchema = z.object({
  id: z.number().int().positive(),
  runId: z.string(),
  role: z.enum(['user', 'mastermind']),
  body: z.string(),
  status: z.enum(['pending', 'handled', 'rejected', 'delivery_failed']),
  createdAt: z.number().int(),
  handledAt: z.number().int().nullable(),
  inReplyToId: z.number().int().positive().nullable(),
  error: z.string().nullable(),
})

export const SteeringTranscriptResponseSchema = z.object({
  runId: z.string(),
  steerable: z.boolean(),
  messages: z.array(SteeringMessageSchema),
})

export const PostSteeringRequestSchema = z.object({
  runId: z.literal('current'),
  message: z.string().trim().min(1),
})

export const PostSteeringResponseSchema = SteeringMessageSchema

export type SteeringMessage = z.infer<typeof SteeringMessageSchema>
export type SteeringTranscriptResponse = z.infer<typeof SteeringTranscriptResponseSchema>
export type PostSteeringRequest = z.infer<typeof PostSteeringRequestSchema>
export type PostSteeringResponse = z.infer<typeof PostSteeringResponseSchema>
```

Modify `packages/types/src/index.ts`:

```ts
export * from './events'
export * from './commands'
export * from './api'
export * from './mastermindCommands'
export * from './steering'
```

- [ ] **Step 4: Add transcript persistence and the migration**

Modify `apps/api/src/db/schema.ts`:

```ts
export const steeringMessages = sqliteTable('steering_messages', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  runId:       text('run_id').notNull(),
  role:        text('role').notNull(),
  body:        text('body').notNull(),
  status:      text('status').notNull(),
  createdAt:   integer('created_at').notNull(),
  handledAt:   integer('handled_at'),
  inReplyToId: integer('in_reply_to_id'),
  error:       text('error'),
})
```

Create `apps/api/src/db/steeringQueries.ts`:

```ts
import { asc, eq } from 'drizzle-orm'
import type { Db } from './client'
import { steeringMessages } from './schema'

export function createSteeringMessage(
  db: Db,
  input: {
    runId: string
    role: 'user' | 'mastermind'
    body: string
    status: 'pending' | 'handled' | 'rejected' | 'delivery_failed'
    inReplyToId: number | null
    error: string | null
  },
) {
  const createdAt = Date.now()
  const result = db.insert(steeringMessages).values({
    runId: input.runId,
    role: input.role,
    body: input.body,
    status: input.status,
    createdAt,
    handledAt: input.status === 'pending' ? null : createdAt,
    inReplyToId: input.inReplyToId,
    error: input.error,
  }).returning().get()

  return result!
}

export function markSteeringMessageHandled(db: Db, id: number) {
  db.update(steeringMessages).set({
    status: 'handled',
    handledAt: Date.now(),
    error: null,
  }).where(eq(steeringMessages.id, id)).run()
}

export function markSteeringMessageFailed(db: Db, id: number, status: 'rejected' | 'delivery_failed', error: string) {
  db.update(steeringMessages).set({
    status,
    handledAt: Date.now(),
    error,
  }).where(eq(steeringMessages.id, id)).run()
}

export function getSteeringMessage(db: Db, id: number) {
  return db.select().from(steeringMessages).where(eq(steeringMessages.id, id)).get() ?? null
}

export function listSteeringMessages(db: Db, runId: string) {
  return db.select().from(steeringMessages)
    .where(eq(steeringMessages.runId, runId))
    .orderBy(asc(steeringMessages.createdAt), asc(steeringMessages.id))
    .all()
}
```

Create `apps/api/src/db/migrations/0002_mastermind_steering_chat.sql`:

```sql
CREATE TABLE `steering_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text NOT NULL,
  `role` text NOT NULL,
  `body` text NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `handled_at` integer,
  `in_reply_to_id` integer,
  `error` text
);
```

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/packages/types
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/mastermindCommands.test.ts src/steering.test.ts
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/db/steeringQueries.test.ts
```

Expected:
- all 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add \
  packages/types/src/mastermindCommands.ts \
  packages/types/src/mastermindCommands.test.ts \
  packages/types/src/steering.ts \
  packages/types/src/steering.test.ts \
  packages/types/src/index.ts \
  apps/api/src/db/schema.ts \
  apps/api/src/db/steeringQueries.ts \
  apps/api/src/db/steeringQueries.test.ts \
  apps/api/src/db/migrations/0002_mastermind_steering_chat.sql \
  apps/api/src/db/migrations/meta/_journal.json \
  apps/api/src/db/migrations/meta/0002_snapshot.json
git commit -m "feat: add steering contracts and transcript storage"
```

## Task 2: Route Steering Through a Separate Mastermind Command Path

**Files:**
- Create: `apps/api/src/orchestrator/mastermindSteering.ts`
- Create: `apps/api/src/orchestrator/mastermindSteering.test.ts`
- Create: `apps/api/src/server/steeringService.ts`
- Modify: `apps/api/src/orchestrator/context.ts`
- Modify: `apps/api/src/orchestrator/mastermind.ts`
- Modify: `apps/api/src/orchestrator/mastermind.test.ts`
- Modify: `apps/api/src/server/app.ts`
- Modify: `apps/api/src/server/routes.ts`
- Modify: `apps/api/src/server/routes.test.ts`
- Modify: `apps/api/src/cli.ts`

- [ ] **Step 1: Write the failing steering behavior tests**

Create `apps/api/src/orchestrator/mastermindSteering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSteeringGuidanceBlock, evaluateSteerability, renderSteeringReply } from './mastermindSteering'

describe('mastermindSteering', () => {
  it('treats review_ready as non-steerable and keeps merging compatible', () => {
    expect(evaluateSteerability('merging')).toBe(true)
    expect(evaluateSteerability('merging_lanes')).toBe(true)
    expect(evaluateSteerability('review_ready')).toBe(false)
  })

  it('renders deterministic replies', () => {
    expect(renderSteeringReply('accepted_future_guidance')).toContain('Constraint noted')
    expect(renderSteeringReply('not_steerable')).toContain('Run is no longer active')
  })

  it('limits guidance to the last five handled user messages', () => {
    const block = buildSteeringGuidanceBlock([
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6',
    ])
    expect(block).toContain('User steering guidance:')
    expect(block).toContain('- m6')
    expect(block).not.toContain('- m1')
  })
})
```

Add route coverage to `apps/api/src/server/routes.test.ts`:

```ts
it('GET /api/steer returns transcript plus steerable false for a non-steerable known run', async () => {
  const db = createTestDb()
  upsertTask(db, 'mastermind', 'mastermind', null, 'done')
  const mastermindQueues = new Map()
  const app = createApp({
    db,
    leadQueues: new Map(),
    mastermindQueues,
    getCurrentRunId: () => 'run-123',
  })

  const res = await request(app).get('/api/steer').query({ runId: 'current' })
  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ runId: 'run-123', steerable: false, messages: [] })
})

it('POST /api/steer enqueues a mastermind command for a steerable run', async () => {
  const db = createTestDb()
  upsertTask(db, 'mastermind', 'mastermind', null, 'monitoring')
  const mastermindQueue = new CommandQueue<any>()
  const app = createApp({
    db,
    leadQueues: new Map(),
    mastermindQueues: new Map([['run-123', mastermindQueue]]),
    getCurrentRunId: () => 'run-123',
  })

  const res = await request(app).post('/api/steer').send({
    runId: 'current',
    message: 'Make the outro shorter',
  })

  expect(res.status).toBe(202)
  expect(mastermindQueue.size).toBe(1)
})
```

- [ ] **Step 2: Run the failing API/orchestrator tests**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm vitest run \
  src/orchestrator/mastermindSteering.test.ts \
  src/server/routes.test.ts \
  src/orchestrator/mastermind.test.ts
```

Expected:
- the new steering helper tests fail because the module does not exist
- route tests fail because `createApp` and `/api/steer` do not support mastermind queues/current-run resolution

- [ ] **Step 3: Implement deterministic steering rules and prompt folding**

Create `apps/api/src/orchestrator/mastermindSteering.ts`:

```ts
export type SteeringReplyKind =
  | 'accepted_future_guidance'
  | 'accepted_future_only'
  | 'unsupported_mvp'
  | 'not_steerable'

const STEERABLE_STATES = new Set(['planning', 'delegating', 'monitoring', 'merging', 'merging_lanes'])

export function evaluateSteerability(state: string): boolean {
  return STEERABLE_STATES.has(state)
}

export function renderSteeringReply(kind: SteeringReplyKind): string {
  switch (kind) {
    case 'accepted_future_guidance':
      return 'Constraint noted. I will apply this guidance to upcoming planning and retries.'
    case 'accepted_future_only':
      return 'Guidance noted. It will affect future work only; completed outputs stay unchanged.'
    case 'unsupported_mvp':
      return 'I understood the request, but this chat only steers future work in this MVP.'
    case 'not_steerable':
      return 'Run is no longer active, so I cannot apply new steering.'
  }
}

export function buildSteeringGuidanceBlock(messages: string[]): string {
  const recent = messages.slice(-5)
  if (recent.length === 0) return ''
  return ['User steering guidance:', ...recent.map(message => `- ${message}`)].join('\n')
}
```

Modify `apps/api/src/orchestrator/context.ts` so mastermind and PM prompt builders can accept an optional `steeringGuidance` string and append it only when non-empty.

- [ ] **Step 4: Wire the API service, current run resolver, and mastermind queue**

Create `apps/api/src/server/steeringService.ts`:

```ts
import type { Db } from '../db/client'
import type { CommandQueue } from '../events/commandQueues'
import type { MastermindCommand } from '@orc/types'
import {
  createSteeringMessage,
  listSteeringMessages,
  markSteeringMessageFailed,
} from '../db/steeringQueries'
import { evaluateSteerability } from '../orchestrator/mastermindSteering'

export function createSteeringService(
  db: Db,
  getCurrentRunId: () => string | null,
  mastermindQueues: Map<string, CommandQueue<MastermindCommand>>,
  getMastermindState: () => string,
) {
  return {
    getTranscript(runId: 'current') {
      if (runId !== 'current') return { status: 404 as const, body: { error: 'run not found' } }
      const resolvedRunId = getCurrentRunId()
      if (!resolvedRunId) return { status: 404 as const, body: { error: 'run not found' } }
      return {
        status: 200 as const,
        body: {
          runId: resolvedRunId,
          steerable: evaluateSteerability(getMastermindState()),
          messages: listSteeringMessages(db, resolvedRunId),
        },
      }
    },

    postMessage(input: { runId: 'current'; message: string }) {
      const resolvedRunId = getCurrentRunId()
      if (!resolvedRunId) return { status: 404 as const, body: { error: 'run not found' } }
      if (!evaluateSteerability(getMastermindState())) {
        return { status: 409 as const, body: { error: 'run is not steerable' } }
      }
      const queue = mastermindQueues.get(resolvedRunId)
      if (!queue) return { status: 503 as const, body: { error: 'mastermind queue unavailable' } }

      const message = createSteeringMessage(db, {
        runId: resolvedRunId,
        role: 'user',
        body: input.message,
        status: 'pending',
        inReplyToId: null,
        error: null,
      })

      try {
        queue.enqueue({ commandType: 'Steer', runId: resolvedRunId, messageId: message.id })
      } catch (error) {
        markSteeringMessageFailed(db, message.id, 'delivery_failed', String(error))
        return { status: 503 as const, body: { error: 'mastermind queue unavailable' } }
      }

      return { status: 202 as const, body: message }
    },
  }
}
```

Modify `apps/api/src/server/app.ts` to accept:

```ts
import type { MastermindCommand } from '@orc/types'

export interface AppDeps {
  db: Db
  leadQueues: Map<string, CommandQueue<any>>
  mastermindQueues: Map<string, CommandQueue<MastermindCommand>>
  getCurrentRunId: () => string | null
  dashboardUrl?: string
}
```

Modify `apps/api/src/server/routes.ts` so `GET /api/steer` and `POST /api/steer` delegate to `createSteeringService(...)` instead of logging.

- [ ] **Step 5: Consume `Steer` commands inside mastermind**

Modify `apps/api/src/orchestrator/mastermind.ts`:

```ts
import type { MastermindCommand } from '@orc/types'
import {
  buildSteeringGuidanceBlock,
  evaluateSteerability,
  renderSteeringReply,
} from './mastermindSteering'
import {
  createSteeringMessage,
  getSteeringMessage,
  listSteeringMessages,
  markSteeringMessageHandled,
  markSteeringMessageFailed,
} from '../db/steeringQueries'

interface MastermindConfig {
  // existing fields...
  mastermindQueue?: CommandQueue<MastermindCommand>
}

async function drainSteeringCommandsOnce(): Promise<void> {
  while ((this.cfg.mastermindQueue?.size ?? 0) > 0) {
    const cmd = await this.cfg.mastermindQueue!.dequeue()
    if (cmd.commandType !== 'Steer') continue

    const message = getSteeringMessage(this.cfg.db, cmd.messageId)
    if (!message) continue

    if (!evaluateSteerability(this.state)) {
      markSteeringMessageFailed(this.cfg.db, message.id, 'rejected', 'run is not steerable')
      continue
    }

    markSteeringMessageHandled(this.cfg.db, message.id)
    createSteeringMessage(this.cfg.db, {
      runId: this.cfg.runId,
      role: 'mastermind',
      body: renderSteeringReply('accepted_future_guidance'),
      status: 'handled',
      inReplyToId: message.id,
      error: null,
    })
  }
}
```

Then call `await drainSteeringCommandsOnce()`:
- before the initial planning prompt
- before each dependency-batch selection loop
- before returning from monitoring/merge success or failure paths

Use `buildSteeringGuidanceBlock(...)` with handled user messages when building future mastermind and PM prompts.

- [ ] **Step 6: Re-run the API/orchestrator tests**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm vitest run \
  src/orchestrator/mastermindSteering.test.ts \
  src/server/routes.test.ts \
  src/orchestrator/mastermind.test.ts
```

Expected:
- all targeted tests pass

- [ ] **Step 7: Commit**

```bash
git add \
  apps/api/src/orchestrator/mastermindSteering.ts \
  apps/api/src/orchestrator/mastermindSteering.test.ts \
  apps/api/src/orchestrator/context.ts \
  apps/api/src/orchestrator/mastermind.ts \
  apps/api/src/orchestrator/mastermind.test.ts \
  apps/api/src/server/steeringService.ts \
  apps/api/src/server/app.ts \
  apps/api/src/server/routes.ts \
  apps/api/src/server/routes.test.ts \
  apps/api/src/cli.ts
git commit -m "feat: route steering through mastermind"
```

## Task 3: Add the Mastermind Chat UI Inside the Existing Detail Panel

**Files:**
- Create: `apps/web/src/lib/steeringCache.ts`
- Create: `apps/web/src/lib/steeringCache.test.ts`
- Create: `apps/web/src/hooks/useSteering.ts`
- Create: `apps/web/src/components/MastermindPanel.tsx`
- Modify: `apps/web/src/components/TreePanel.tsx`
- Modify: `apps/web/src/components/DetailPanel.tsx`
- Modify: `apps/web/src/hooks/useOrchestration.ts`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Write the failing frontend helper test**

Create `apps/web/src/lib/steeringCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeSteeringMessages, replaceSteeringMessages } from './steeringCache'

describe('steeringCache', () => {
  it('appends by id without creating duplicates after refetch', () => {
    const afterSend = mergeSteeringMessages([], [
      { id: 1, runId: 'run-123', role: 'user', body: 'trim the outro', status: 'pending', createdAt: 1, handledAt: null, inReplyToId: null, error: null },
    ])

    const afterRefetch = replaceSteeringMessages(afterSend, [
      { id: 1, runId: 'run-123', role: 'user', body: 'trim the outro', status: 'handled', createdAt: 1, handledAt: 2, inReplyToId: null, error: null },
      { id: 2, runId: 'run-123', role: 'mastermind', body: 'Constraint noted. I will apply this guidance to upcoming planning and retries.', status: 'handled', createdAt: 2, handledAt: 2, inReplyToId: 1, error: null },
    ])

    expect(afterRefetch).toHaveLength(2)
    expect(afterRefetch[0].status).toBe('handled')
  })
})
```

- [ ] **Step 2: Run the failing frontend helper test**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/lib/steeringCache.test.ts
```

Expected:
- the test fails because `steeringCache.ts` does not exist

- [ ] **Step 3: Add transcript cache helpers and the steering hook**

Create `apps/web/src/lib/steeringCache.ts`:

```ts
import type { SteeringMessage } from '@orc/types'

export function mergeSteeringMessages(current: SteeringMessage[], incoming: SteeringMessage[]) {
  const map = new Map(current.map(message => [message.id, message]))
  for (const message of incoming) map.set(message.id, message)
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
}

export function replaceSteeringMessages(_current: SteeringMessage[], incoming: SteeringMessage[]) {
  return [...incoming].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
}
```

Create `apps/web/src/hooks/useSteering.ts`:

```ts
'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostSteeringResponse, SteeringTranscriptResponse } from '@orc/types'
import { mergeSteeringMessages, replaceSteeringMessages } from '../lib/steeringCache'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function useSteering(selected: boolean) {
  const qc = useQueryClient()
  const queryKey = ['steering', 'current']

  const query = useQuery<SteeringTranscriptResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${API}/api/steer?runId=current`)
      if (!res.ok) throw new Error('failed to load steering transcript')
      const body = await res.json() as SteeringTranscriptResponse
      const current = qc.getQueryData<SteeringTranscriptResponse>(queryKey)
      return {
        ...body,
        messages: replaceSteeringMessages(current?.messages ?? [], body.messages),
      }
    },
    enabled: selected,
    refetchInterval: selected ? 2000 : false,
  })

  const send = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`${API}/api/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'current', message }),
      })
      if (!res.ok) throw new Error('failed to send steering message')
      return await res.json() as PostSteeringResponse
    },
    onSuccess: (message) => {
      qc.setQueryData<SteeringTranscriptResponse | undefined>(queryKey, current =>
        current
          ? { ...current, messages: mergeSteeringMessages(current.messages, [message]) }
          : { runId: message.runId, steerable: true, messages: [message] }
      )
      void qc.invalidateQueries({ queryKey })
    },
  })

  return { ...query, send }
}
```

- [ ] **Step 4: Render mastermind inside the existing detail panel**

Create `apps/web/src/components/MastermindPanel.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useSteering } from '../hooks/useSteering'

export function MastermindPanel({ mastermindState }: { mastermindState: string }) {
  const [draft, setDraft] = useState('')
  const { data, send, isLoading } = useSteering(true)
  const disabled = !data?.steerable || send.isPending

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="rounded-lg border border-[#1c2738] bg-[#0f1420] p-4">
        <p className="text-[11px] text-gray-500">
          State: <span className="font-mono text-gray-300">{mastermindState}</span>
        </p>
        <p className="text-[11px] text-gray-600 mt-1">
          {data?.steerable ? 'Steering affects future work only.' : 'Run is read-only; steering is unavailable.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-[#1c2738] bg-[#0f1420] p-4 space-y-3">
        {(data?.messages ?? []).map(message => (
          <div key={message.id} className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600">{message.role}</div>
            <div className="text-[12px] text-gray-200">{message.body}</div>
          </div>
        ))}
        {!isLoading && (data?.messages.length ?? 0) === 0 && (
          <p className="text-[11px] text-gray-600">No steering messages yet.</p>
        )}
      </div>

      <form
        className="rounded-lg border border-[#1c2738] bg-[#0f1420] p-4 space-y-3"
        onSubmit={event => {
          event.preventDefault()
          const next = draft.trim()
          if (!next || disabled) return
          send.mutate(next)
          setDraft('')
        }}
      >
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          disabled={disabled}
          className="w-full min-h-28 rounded border border-[#1c2738] bg-[#070a0e] px-3 py-2 text-[12px] text-gray-100"
          placeholder="Add a constraint or redirect future work"
        />
        <button
          type="submit"
          disabled={disabled || draft.trim().length === 0}
          className="text-[11px] bg-blue-500/12 hover:bg-blue-500/22 disabled:opacity-40 text-blue-400 px-3 py-1.5 rounded border border-blue-500/25"
        >
          {send.isPending ? 'Sending…' : 'Send to mastermind'}
        </button>
      </form>
    </div>
  )
}
```

Modify `apps/web/src/components/TreePanel.tsx`:

```tsx
<button
  onClick={() => onSelect('mastermind')}
  className={`flex items-center gap-2 px-3 py-2 rounded-md border mb-2 w-full text-left ${
    selected === 'mastermind'
      ? 'bg-indigo-500/14 border-indigo-400/40 ring-1 ring-indigo-400/30'
      : 'bg-indigo-500/8 border-indigo-500/20 hover:bg-indigo-500/12'
  }`}
>
```

Modify `apps/web/src/components/DetailPanel.tsx` so `selectedId === 'mastermind'` renders `MastermindPanel` before the lead/worker branches.

- [ ] **Step 5: Re-run the frontend tests and build**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/apps/web
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/lib/steeringCache.test.ts
COREPACK_ENABLE_STRICT=0 pnpm build
```

Expected:
- `steeringCache.test.ts` passes
- Next.js build passes

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/lib/steeringCache.ts \
  apps/web/src/lib/steeringCache.test.ts \
  apps/web/src/hooks/useSteering.ts \
  apps/web/src/components/MastermindPanel.tsx \
  apps/web/src/components/TreePanel.tsx \
  apps/web/src/components/DetailPanel.tsx \
  apps/web/src/hooks/useOrchestration.ts \
  apps/web/src/app/page.tsx
git commit -m "feat: add mastermind steering panel"
```

## Task 4: Verify End-to-End Steering Behavior and Compatibility

**Files:**
- Modify: `apps/api/src/integration.test.ts`
- Modify: `apps/api/src/server/routes.test.ts`
- Modify: `apps/web/src/hooks/useOrchestration.ts`

- [ ] **Step 1: Add an integration test for steering affecting future prompt context**

Modify `apps/api/src/integration.test.ts`:

Add the imports:

```ts
import type { MastermindCommand } from '@orc/types'
import { CommandQueue } from './events/commandQueues'
import { createSteeringMessage } from './db/steeringQueries'
```

```ts
it('folds handled steering messages into the initial mastermind prompt', async () => {
  repoDir = initTestRepo('integration-steering')
  const db = createTestDb()
  const gov = new ConcurrencyGovernor(2)
  const mastermindQueue = new CommandQueue<MastermindCommand>()
  const prompts: string[] = []

  const message = createSteeringMessage(db, {
    runId: 'int-run',
    role: 'user',
    body: 'Keep the ending sparse and shorter than the intro',
    status: 'pending',
    inReplyToId: null,
    error: null,
  })
  mastermindQueue.enqueue({ commandType: 'Steer', runId: 'int-run', messageId: message.id })

  const m = new MastermindStateMachine({
    repoRoot: repoDir,
    db,
    governor: gov,
    runId: 'int-run',
    baseBranch: 'main',
    mastermindQueue,
    agentFactory: () => new MockAgent({ delayMs: 5, outcome: 'done' }),
    llmCall: async prompt => {
      prompts.push(prompt)
      if (prompt.includes('Decompose')) {
        return JSON.stringify([{ id: 'main', goal: 'Build the track', numWorkers: 1, dependsOn: [] }])
      }
      if (prompt.includes('Generate 1 distinct implementation prompts')) {
        return JSON.stringify(['ship it'])
      }
      return JSON.stringify({ winnerId: 'int-run-main-v1', reasoning: 'only one candidate' })
    },
  })

  await m.run({ userGoal: 'Build lo-fi track' })

  expect(prompts[0]).toContain('User steering guidance:')
  expect(prompts[0]).toContain('Keep the ending sparse and shorter than the intro')
})
```

- [ ] **Step 2: Run the full targeted verification set**

Run:

```bash
cd /home/cbosle/hackatons/strudel-worktree/packages/types
COREPACK_ENABLE_STRICT=0 pnpm test
cd /home/cbosle/hackatons/strudel-worktree/apps/api
COREPACK_ENABLE_STRICT=0 pnpm vitest run \
  src/db/steeringQueries.test.ts \
  src/orchestrator/mastermindSteering.test.ts \
  src/orchestrator/mastermind.test.ts \
  src/server/routes.test.ts \
  src/integration.test.ts
cd /home/cbosle/hackatons/strudel-worktree/apps/web
COREPACK_ENABLE_STRICT=0 pnpm vitest run src/lib/steeringCache.test.ts
COREPACK_ENABLE_STRICT=0 pnpm build
```

Expected:
- all packages/types tests pass
- targeted API tests and integration pass
- web helper test passes
- web build passes

- [ ] **Step 3: Commit**

```bash
git add \
  apps/api/src/integration.test.ts \
  apps/api/src/server/routes.test.ts \
  apps/api/src/orchestrator/mastermind.test.ts \
  apps/web/src/hooks/useOrchestration.ts
git commit -m "test: verify mastermind steering flow"
```

- [ ] **Step 4: Final review before handoff**

Checklist:

- `GET /api/steer?runId=current` returns transcript for both steerable and non-steerable known runs
- `POST /api/steer` returns `409` for non-steerable known runs
- mastermind queue is separate from lead queues
- transcript response replacement does not duplicate the just-posted message
- `mastermind` is selectable in `TreePanel`
- `DetailPanel` renders a dedicated mastermind branch rather than a parallel page
- deterministic replies do not call `llmCall`

## Self-Review

- Spec coverage:
  - transcript persistence is covered in Task 1
  - separate mastermind transport and deterministic reply generation are covered in Task 2
  - existing-layout UI integration and response/refetch reconciliation are covered in Task 3
  - end-to-end future-guidance verification is covered in Task 4
- Placeholder scan:
  - no `TBD`, `TODO`, or “implement later” steps remain
  - every task has concrete files, commands, and expected outcomes
- Type consistency:
  - `MastermindCommand` is separate from `OrcCommand`
  - transcript messages use numeric `id` values consistently across API, persistence, and frontend cache helpers
  - the frontend flow uses response append plus refetch replacement keyed by message id, matching the approved spec
