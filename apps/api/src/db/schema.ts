import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const eventLog = sqliteTable('event_log', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  entityId:   text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  eventType:  text('event_type').notNull(),
  sequence:   integer('sequence').notNull(),
  payload:    text('payload').notNull(),
  ts:         integer('ts').notNull(),
}, t => ({ uniqEntitySeq: uniqueIndex('entity_seq_uniq').on(t.entityId, t.sequence) }))

export const tasks = sqliteTable('tasks', {
  id:              text('id').primaryKey(),
  type:            text('type').notNull(),
  parentId:        text('parent_id'),
  state:           text('state').notNull().default('pending'),
  retryCount:      integer('retry_count').notNull().default(0),
  taskPrompt:      text('task_prompt'),
  strategy:        text('strategy'),
  spawnGeneration: integer('spawn_generation').notNull().default(0),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
})

export const runs = sqliteTable('runs', {
  id:          text('id').primaryKey(),
  entityId:    text('entity_id').notNull(),
  adapterType: text('adapter_type'),
  pid:         integer('pid'),
  startedAt:   integer('started_at').notNull(),
  lastSeenAt:  integer('last_seen_at'),
})

export const worktrees = sqliteTable('worktrees', {
  id:         text('id').primaryKey(),
  workerId:   text('worker_id').notNull(),
  path:       text('path').notNull(),
  branch:     text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  gitStatus:  text('git_status').default('clean'),
})

export const taskEdges = sqliteTable('task_edges', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  parentId: text('parent_id').notNull(),
  childId:  text('child_id').notNull(),
  edgeType: text('edge_type').notNull(),
})

export const mergeCandidates = sqliteTable('merge_candidates', {
  id:                text('id').primaryKey(),
  leadId:            text('lead_id').notNull(),
  winnerWorkerId:    text('winner_worker_id').notNull(),
  targetBranch:      text('target_branch').notNull(),
  reviewerReasoning: text('reviewer_reasoning'),
})

export const mergeQueue = sqliteTable('merge_queue', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  leadId:           text('lead_id').notNull(),
  winnerWorktreeId: text('winner_worktree_id').notNull(),
  targetBranch:     text('target_branch').notNull(),
  status:           text('status').notNull().default('pending'),
  conflictDetails:  text('conflict_details'),
  fixWorkerId:      text('fix_worker_id'),
  fixAttempts:      integer('fix_attempts').notNull().default(0),
  createdAt:        integer('created_at').notNull(),
  mergedAt:         integer('merged_at'),
})

export const previews = sqliteTable('previews', {
  id:         text('id').primaryKey(),
  worktreeId: text('worktree_id').notNull(),
  previewUrl: text('preview_url').notNull(),
  status:     text('status').notNull().default('inactive'),
  launchedAt: integer('launched_at'),
})

export const artifacts = sqliteTable('artifacts', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  entityId:     text('entity_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  path:         text('path').notNull(),
  updatedAt:    integer('updated_at').notNull(),
}, t => ({ uniqEntityArtifact: uniqueIndex('entity_artifact_uniq').on(t.entityId, t.artifactType) }))
