import { describe, it, expect } from 'vitest'
import { createTestDb } from '../db/client'
import { MergeCoordinator } from './mergeCoordinator'

describe('MergeCoordinator', () => {
  it('processes clean merge and calls onComplete', async () => {
    const db = createTestDb()
    const completed: string[] = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async () => ({ success: true, conflictFiles: [] }),
      onComplete: id => completed.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', winnerBranch: 'feat/rhythm-v1', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(completed).toHaveLength(1)
  })

  it('calls onConflict when merge fails', async () => {
    const db = createTestDb()
    const conflicts: string[] = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async () => ({ success: false, conflictFiles: ['a.ts'] }),
      onConflict: (id) => conflicts.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', winnerBranch: 'feat/rhythm-v1', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(conflicts).toHaveLength(1)
  })
})
