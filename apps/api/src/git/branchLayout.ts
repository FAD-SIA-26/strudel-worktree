import * as path from 'node:path'
import { getOrcPaths } from '../runtime/paths'

export function laneBranchName(runId: string, sectionId: string): string {
  return `lane/${runId}/${sectionId}`
}

export function laneWorktreePath(repoRoot: string, runId: string, sectionId: string): string {
  return path.join(getOrcPaths(repoRoot).worktreesDir, `lane-${runId}-${sectionId}`)
}
