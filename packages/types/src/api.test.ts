import { describe, expect, it } from 'vitest'
import { OrchStateSchema } from './api'

describe('OrchStateSchema', () => {
  it('parses review and selection fields', () => {
    expect(OrchStateSchema.parse({
      runId: 'r1',
      mastermindState: 'review_ready',
      reviewReady: true,
      fullSongPreviewAvailable: true,
      fullSongPreviewUrl: 'https://strudel.cc/#final',
      sections: [
        {
          id: 'melody',
          state: 'done',
          proposedWinnerWorkerId: 'melody-v1',
          selectedWinnerWorkerId: 'melody-v2',
          selectionStatus: 'lane_merged',
          awaitingUserApproval: false,
          workers: [
            {
              id: 'melody-v1',
              state: 'done',
              isProposed: true,
              isSelected: false,
              canBeSelected: true,
              isStopping: false,
              contextAvailable: true,
              previewArtifacts: [],
            },
            {
              id: 'melody-v2',
              state: 'done',
              isProposed: false,
              isSelected: true,
              canBeSelected: false,
              isStopping: false,
              contextAvailable: true,
              previewArtifacts: [],
            },
          ],
        },
      ],
    }).reviewReady).toBe(true)
  })
})
