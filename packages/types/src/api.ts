import { z } from 'zod'

export const PreviewArtifactSummarySchema = z.object({
  mode: z.enum(['solo', 'contextual']),
  previewUrl: z.string(),
})

export const WorkerInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  branch: z.string().optional(),
  isProposed: z.boolean().default(false),
  isSelected: z.boolean().default(false),
  canBeSelected: z.boolean().default(false),
  isStopping: z.boolean().default(false),
  contextAvailable: z.boolean().default(false),
  previewArtifacts: z.array(PreviewArtifactSummarySchema).default([]),
})

export const SectionInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  proposedWinnerWorkerId: z.string().nullable().default(null),
  selectedWinnerWorkerId: z.string().nullable().default(null),
  selectionStatus: z.enum(['waiting_for_review', 'waiting_for_user', 'selected', 'lane_merged']).default('waiting_for_review'),
  awaitingUserApproval: z.boolean().default(false),
  workers: z.array(WorkerInfoSchema),
})

export const OrchStateSchema = z.object({
  runId: z.string(),
  mastermindState: z.string(),
  reviewReady: z.boolean().default(false),
  fullSongPreviewAvailable: z.boolean().default(false),
  fullSongPreviewUrl: z.string().optional(),
  sections: z.array(SectionInfoSchema),
})

const ContentStatusSchema = z.enum(['ready', 'empty', 'missing', 'error'])

const ContentBlockSchema = z.object({
  status: ContentStatusSchema,
  content: z.string().nullable(),
  message: z.string().optional(),
})

export const LogEntrySchema = z.object({
  id: z.string(),
  ts: z.number().int(),
  kind: z.enum(['stdout', 'stderr', 'codex_event', 'lead_event']),
  title: z.string(),
  body: z.string(),
  raw: z.string(),
})

export const LogsResponseSchema = z.object({
  entries: z.array(LogEntrySchema),
  tailCursor: z.string().nullable(),
})

export const WorkerDetailSchema = z.object({
  entityId: z.string(),
  entityType: z.literal('worker'),
  title: z.string(),
  resolvedPaths: z.object({
    worktreePath: z.string(),
    planPath: z.string().nullable(),
    logPath: z.string().nullable(),
  }),
  plan: ContentBlockSchema,
  diff: ContentBlockSchema.extend({
    branch: z.string().optional(),
    baseBranch: z.string().optional(),
  }),
})

export const LeadDetailSchema = z.object({
  entityId: z.string(),
  entityType: z.literal('lead'),
  title: z.string(),
  resolvedPaths: z.object({
    planPath: z.string().nullable(),
    winnerWorktreePath: z.string().nullable(),
  }),
  plan: ContentBlockSchema,
  diff: ContentBlockSchema.extend({
    winnerWorkerId: z.string().nullable(),
    branch: z.string().optional(),
    baseBranch: z.string().optional(),
  }),
})

export const EntityDetailSchema = z.discriminatedUnion('entityType', [
  WorkerDetailSchema,
  LeadDetailSchema,
])

export type PreviewArtifactSummary = z.infer<typeof PreviewArtifactSummarySchema>
export type WorkerInfo = z.infer<typeof WorkerInfoSchema>
export type SectionInfo = z.infer<typeof SectionInfoSchema>
export type OrchState = z.infer<typeof OrchStateSchema>
export type LogEntry = z.infer<typeof LogEntrySchema>
export type LogsResponse = z.infer<typeof LogsResponseSchema>
export type WorkerDetail = z.infer<typeof WorkerDetailSchema>
export type LeadDetail = z.infer<typeof LeadDetailSchema>
export type EntityDetail = z.infer<typeof EntityDetailSchema>
