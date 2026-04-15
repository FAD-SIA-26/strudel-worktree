import * as fs from 'node:fs/promises'
import type { EntityDetail } from '@orc/types'
import type { Db } from '../db/client'
import { getAllTasks, getArtifactPath, getMergeCandidates, getWorktrees } from '../db/queries'
import { getWorktreePatch } from '../git/worktree'
import { resolveWorkerRuntime } from './workerRuntime'

type ContentState = { status: 'ready' | 'empty' | 'missing' | 'error'; content: string | null; message?: string }

async function readText(pathValue: string | null): Promise<ContentState> {
  if (!pathValue) {
    return { status: 'missing', content: null, message: 'artifact path not registered' }
  }

  try {
    return { status: 'ready', content: await fs.readFile(pathValue, 'utf8') }
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { status: 'missing', content: null, message: 'file does not exist yet' }
    }
    return { status: 'error', content: null, message: error?.message ?? 'failed to read file' }
  }
}

export async function getEntityDetail(db: Db, entityId: string): Promise<EntityDetail | null> {
  const task = getAllTasks(db).find(candidate => candidate.id === entityId)
  if (!task) return null

  if (task.type === 'worker') {
    const workerRuntime = resolveWorkerRuntime(db, entityId)
    if (!workerRuntime) {
      return {
        entityId,
        entityType: 'worker',
        title: entityId,
        resolvedPaths: {
          worktreePath: '',
          planPath: null,
          logPath: null,
        },
        plan: {
          status: 'missing',
          content: null,
          message: 'worktree metadata missing',
        },
        diff: {
          status: 'missing',
          content: null,
          message: 'worktree metadata missing',
        },
      }
    }

    const plan = await readText(workerRuntime.planPath)
    const patch = workerRuntime.inferred
      ? ''
      : await getWorktreePatch(workerRuntime.worktreePath, workerRuntime.baseBranch)
    const missingPlanMessage = task.state === 'queued'
      ? 'worker is queued; plan file will be created when a slot opens'
      : 'worker plan is not available yet'

    return {
      entityId,
      entityType: 'worker',
      title: entityId,
      resolvedPaths: {
        worktreePath: workerRuntime.worktreePath,
        planPath: workerRuntime.planPath,
        logPath: workerRuntime.logPath,
      },
      plan: workerRuntime.inferred && plan.status === 'missing'
        ? { ...plan, message: missingPlanMessage }
        : plan,
      diff: patch
        ? {
            status: 'ready',
            content: patch,
            branch: workerRuntime.branch,
            baseBranch: workerRuntime.baseBranch,
          }
        : workerRuntime.inferred
          ? {
              status: 'missing',
              content: null,
              branch: workerRuntime.branch,
              baseBranch: workerRuntime.baseBranch,
              message: task.state === 'queued'
                ? 'worker is queued; worktree will be created when a slot opens'
                : 'worker worktree has not been created yet',
            }
          : {
            status: 'empty',
            content: '',
            branch: workerRuntime.branch,
            baseBranch: workerRuntime.baseBranch,
            message: 'no diff yet',
          },
    }
  }

  if (task.type === 'lead') {
    const planPath = getArtifactPath(db, entityId, 'lead_plan')
    const plan = await readText(planPath)
    const winner = getMergeCandidates(db).find(candidate => candidate.leadId === entityId)
    const winnerWorkerId = winner?.selectedWinnerWorkerId ?? null

    if (!winnerWorkerId) {
      return {
        entityId,
        entityType: 'lead',
        title: entityId,
        resolvedPaths: {
          planPath,
          winnerWorktreePath: null,
        },
        plan,
        diff: {
          status: 'missing',
          content: null,
          winnerWorkerId: null,
          message: 'no selected winner yet',
        },
      }
    }

    const worktree = getWorktrees(db).find(candidate => candidate.workerId === winnerWorkerId)
    if (!worktree) {
      return {
        entityId,
        entityType: 'lead',
        title: entityId,
        resolvedPaths: {
          planPath,
          winnerWorktreePath: null,
        },
        plan,
        diff: {
          status: 'missing',
          content: null,
          winnerWorkerId,
          message: 'winner worktree metadata missing',
        },
      }
    }

    const patch = await getWorktreePatch(worktree.path, worktree.baseBranch)

    return {
      entityId,
      entityType: 'lead',
      title: entityId,
      resolvedPaths: {
        planPath,
        winnerWorktreePath: worktree.path,
      },
      plan,
      diff: patch
        ? {
            status: 'ready',
            content: patch,
            winnerWorkerId,
            branch: worktree.branch,
            baseBranch: worktree.baseBranch,
          }
        : {
            status: 'empty',
            content: '',
            winnerWorkerId,
            branch: worktree.branch,
            baseBranch: worktree.baseBranch,
            message: 'winner diff is empty',
          },
    }
  }

  return null
}
