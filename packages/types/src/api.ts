import { z } from 'zod'
export const WorkerInfoSchema  = z.object({ id: z.string(), state: z.string(), branch: z.string().optional(), previewUrl: z.string().optional() })
export const SectionInfoSchema = z.object({ id: z.string(), state: z.string(), workers: z.array(WorkerInfoSchema) })
export const OrchStateSchema   = z.object({ runId: z.string(), mastermindState: z.string(), sections: z.array(SectionInfoSchema) })
export type WorkerInfo  = z.infer<typeof WorkerInfoSchema>
export type SectionInfo = z.infer<typeof SectionInfoSchema>
export type OrchState   = z.infer<typeof OrchStateSchema>
