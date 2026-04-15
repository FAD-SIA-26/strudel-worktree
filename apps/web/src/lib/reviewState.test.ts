import { describe, expect, it } from 'vitest'
import type { OrchState, SectionInfo } from '@orc/types'
import { getProposedWorker, getSelectedWorker, showFinalPreviewCta } from './reviewState'

describe('reviewState helpers', () => {
  const melodySection: SectionInfo = {
    id: 'melody',
    state: 'awaiting_user_approval',
    proposedWinnerWorkerId: 'melody-v1',
    selectedWinnerWorkerId: 'melody-v2',
    selectionStatus: 'selected',
    awaitingUserApproval: true,
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
  }

  it('finds proposed and selected workers', () => {
    expect(getProposedWorker(melodySection)?.id).toBe('melody-v1')
    expect(getSelectedWorker(melodySection)?.id).toBe('melody-v2')
  })

  it('shows final preview CTA only when the run says it is available', () => {
    const state: OrchState = {
      runId: 'r1',
      mastermindState: 'review_ready',
      reviewReady: true,
      fullSongPreviewAvailable: true,
      sections: [
        melodySection,
        {
          id: 'arrangement',
          state: 'done',
          proposedWinnerWorkerId: 'arrangement-v1',
          selectedWinnerWorkerId: 'arrangement-v1',
          selectionStatus: 'lane_merged',
          awaitingUserApproval: false,
          workers: [
            {
              id: 'arrangement-v1',
              state: 'done',
              isProposed: true,
              isSelected: true,
              canBeSelected: false,
              isStopping: false,
              contextAvailable: true,
              previewArtifacts: [{ mode: 'solo', previewUrl: 'https://strudel.cc/#final' }],
            },
          ],
        },
      ],
    }

    expect(showFinalPreviewCta(state)).toBe(true)
  })
})
