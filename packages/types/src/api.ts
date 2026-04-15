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

export type PreviewArtifactSummary = z.infer<typeof PreviewArtifactSummarySchema>
export type WorkerInfo = z.infer<typeof WorkerInfoSchema>
export type SectionInfo = z.infer<typeof SectionInfoSchema>
export type OrchState = z.infer<typeof OrchStateSchema>
