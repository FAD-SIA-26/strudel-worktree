import type { OrchState, SectionInfo, WorkerInfo } from '@orc/types'

export function getProposedWorker(section: SectionInfo | undefined): WorkerInfo | undefined {
  return section?.workers.find(worker => worker.isProposed)
}

export function getSelectedWorker(section: SectionInfo | undefined): WorkerInfo | undefined {
  return section?.workers.find(worker => worker.isSelected)
}

export function showFinalPreviewCta(state: OrchState | undefined): boolean {
  return Boolean(state?.reviewReady && state?.fullSongPreviewAvailable)
}
