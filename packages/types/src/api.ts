import { z } from 'zod'

export const PreviewArtifactSummarySchema = z.object({
  mode: z.enum(['solo', 'contextual']),
  previewUrl: z.string(),
})

export const WorkerInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  branch: z.string().optional(),
  selected: z.boolean().default(false),
  contextAvailable: z.boolean().default(false),
  previewArtifacts: z.array(PreviewArtifactSummarySchema).default([]),
})

export const SectionInfoSchema = z.object({
  id: z.string(),
  state: z.string(),
  workers: z.array(WorkerInfoSchema),
})

export const OrchStateSchema = z.object({
  runId: z.string(),
  mastermindState: z.string(),
  sections: z.array(SectionInfoSchema),
})

export type PreviewArtifactSummary = z.infer<typeof PreviewArtifactSummarySchema>
export type WorkerInfo = z.infer<typeof WorkerInfoSchema>
export type SectionInfo = z.infer<typeof SectionInfoSchema>
export type OrchState = z.infer<typeof OrchStateSchema>
