import * as path from 'node:path'
import type { Db } from '../db/client'
import { getArtifactPath, getWorktrees } from '../db/queries'

export interface WorkerRuntime {
  worktreePath: string
  branch: string
  baseBranch: string
  planPath: string
  logPath: string
  inferred: boolean
}

function inferRunId(workerId: string): string | null {
  const match = workerId.match(/^(.*)-[^-]+-v\d+(?:-r\d+)?$/)
  return match?.[1] ?? null
}

export function resolveWorkerRuntime(db: Db, workerId: string): WorkerRuntime | null {
  const worktrees = getWorktrees(db)
  const worktree = worktrees.find(candidate => candidate.workerId === workerId)

  if (worktree) {
    return {
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
      planPath: getArtifactPath(db, workerId, 'worker_plan') ?? path.join(worktree.path, '.orc', 'worker-plan.md'),
      logPath: getArtifactPath(db, workerId, 'session_log') ?? path.join(worktree.path, '.orc', '.orc-session.jsonl'),
      inferred: false,
    }
  }

  const runId = inferRunId(workerId)
  if (!runId) return null

  const runWorktree = worktrees.find(candidate =>
    candidate.workerId === `run-${runId}` || candidate.branch === `run/${runId}`,
  )
  if (!runWorktree) return null

  const worktreePath = path.join(path.dirname(runWorktree.path), workerId)

  return {
    worktreePath,
    branch: `feat/${workerId}`,
    baseBranch: runWorktree.baseBranch,
    planPath: getArtifactPath(db, workerId, 'worker_plan') ?? path.join(worktreePath, '.orc', 'worker-plan.md'),
    logPath: getArtifactPath(db, workerId, 'session_log') ?? path.join(worktreePath, '.orc', '.orc-session.jsonl'),
    inferred: true,
  }
}
