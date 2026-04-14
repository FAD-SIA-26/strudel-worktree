import { z } from "zod";

export const EntityTypeSchema = z.enum([
  "mastermind",
  "lead",
  "worker",
  "pm",
  "reviewer",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

const base = z.object({
  entityId: z.string(),
  entityType: EntityTypeSchema,
  sequence: z.number().int().nonnegative(),
  ts: z.number().int(),
  payload: z.record(z.unknown()),
});

export const WorkerProgressSchema = base.extend({
  eventType: z.literal("WorkerProgress"),
  payload: z.object({ output: z.string(), ts: z.number() }),
});
export const WorkerDoneSchema = base.extend({
  eventType: z.literal("WorkerDone"),
  payload: z.object({ branch: z.string(), diff: z.string() }),
});
export const WorkerFailedSchema = base.extend({
  eventType: z.literal("WorkerFailed"),
  payload: z.object({ error: z.string(), retryable: z.boolean() }),
});
export const WorkerStalledSchema = base.extend({
  eventType: z.literal("WorkerStalled"),
  payload: z.object({ lastSeenAt: z.number() }),
});
export const WorkerZombieSchema = base.extend({
  eventType: z.literal("WorkerZombie"),
  payload: z.object({ pid: z.number() }),
});
export const WorkerRecoveredSchema = base.extend({
  eventType: z.literal("WorkerRecovered"),
  payload: z.object({}),
});
export const LeadPlanReadySchema = base.extend({
  eventType: z.literal("LeadPlanReady"),
  payload: z.object({ workerPrompts: z.array(z.string()) }),
});
export const ReviewCompleteSchema = base.extend({
  eventType: z.literal("ReviewComplete"),
  payload: z.object({ winnerId: z.string(), reasoning: z.string() }),
});
export const LeadDoneSchema = base.extend({
  eventType: z.literal("LeadDone"),
  payload: z.object({ branch: z.string(), sectionId: z.string() }),
});
export const LeadFailedSchema = base.extend({
  eventType: z.literal("LeadFailed"),
  payload: z.object({ reason: z.string() }),
});
export const MergeRequestedSchema = base.extend({
  eventType: z.literal("MergeRequested"),
  payload: z.object({
    leadId: z.string(),
    worktreeId: z.string(),
    targetBranch: z.string(),
  }),
});
export const MergeConflictSchema = base.extend({
  eventType: z.literal("MergeConflict"),
  payload: z.object({
    mergeId: z.string(),
    conflictFiles: z.array(z.string()),
  }),
});
export const MergeCompleteSchema = base.extend({
  eventType: z.literal("MergeComplete"),
  payload: z.object({ mergeId: z.string(), targetBranch: z.string() }),
});
export const PlanReadySchema = base.extend({
  eventType: z.literal("PlanReady"),
  payload: z.object({ sections: z.array(z.string()), runId: z.string() }),
});
export const LeadDelegatedSchema = base.extend({
  eventType: z.literal("LeadDelegated"),
  payload: z.object({ leadId: z.string(), sectionId: z.string() }),
});
export const CommandIssuedSchema = base.extend({
  eventType: z.literal("CommandIssued"),
  payload: z.object({
    from: z.string(),
    to: z.string(),
    commandType: z.string(),
    commandPayload: z.record(z.unknown()),
  }),
});
export const OrchCompleteSchema = base.extend({
  eventType: z.literal("OrchestrationComplete"),
  payload: z.object({ runBranch: z.string() }),
});
export const OrchFailedSchema = base.extend({
  eventType: z.literal("OrchestrationFailed"),
  payload: z.object({ reason: z.string() }),
});

export const OrcEventSchema = z.discriminatedUnion("eventType", [
  WorkerProgressSchema,
  WorkerDoneSchema,
  WorkerFailedSchema,
  WorkerStalledSchema,
  WorkerZombieSchema,
  WorkerRecoveredSchema,
  LeadPlanReadySchema,
  ReviewCompleteSchema,
  LeadDoneSchema,
  LeadFailedSchema,
  MergeRequestedSchema,
  MergeConflictSchema,
  MergeCompleteSchema,
  PlanReadySchema,
  LeadDelegatedSchema,
  CommandIssuedSchema,
  OrchCompleteSchema,
  OrchFailedSchema,
]);
export type OrcEvent = z.infer<typeof OrcEventSchema>;
