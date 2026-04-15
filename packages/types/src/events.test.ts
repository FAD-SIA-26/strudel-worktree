import { describe, expect, it } from "vitest";
import { OrcEventSchema } from "./events";

describe('OrcEventSchema', () => {
  it('parses WorkerDone', () => {
    expect(OrcEventSchema.parse({
      entityId: 'rhythm-v1', entityType: 'worker', eventType: 'WorkerDone',
      sequence: 1, ts: 1, payload: { branch: 'feat/rhythm-v1', diff: '+x' },
    }).entityId).toBe('rhythm-v1')
  })

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

    expect(OrcEventSchema.parse({
      entityId: 'melody-v2',
      entityType: 'worker',
      eventType: 'WorkerStopping',
      sequence: 3,
      ts: 3,
      payload: { reason: 'winner already selected' },
    }).eventType).toBe('WorkerStopping')

    expect(OrcEventSchema.parse({
      entityId: 'melody-v2',
      entityType: 'worker',
      eventType: 'WorkerStopFailed',
      sequence: 4,
      ts: 4,
      payload: { reason: 'abort timed out' },
    }).eventType).toBe('WorkerStopFailed')

    expect(OrcEventSchema.parse({
      entityId: 'melody-lead',
      entityType: 'lead',
      eventType: 'LaneMergeStarted',
      sequence: 5,
      ts: 5,
      payload: { laneBranch: 'lane/r1/melody', selectedWinnerWorkerId: 'melody-v2' },
    }).eventType).toBe('LaneMergeStarted')

    expect(OrcEventSchema.parse({
      entityId: 'melody-lead',
      entityType: 'lead',
      eventType: 'LaneMergeCompleted',
      sequence: 6,
      ts: 6,
      payload: { laneBranch: 'lane/r1/melody', selectedWinnerWorkerId: 'melody-v2' },
    }).eventType).toBe('LaneMergeCompleted')
  })

  it('rejects unknown eventType', () => {
    expect(() => OrcEventSchema.parse({
      entityId: 'x', entityType: 'worker', eventType: 'NoSuchEvent',
      sequence: 1, ts: 1, payload: {},
    })).toThrow()
  })
})
