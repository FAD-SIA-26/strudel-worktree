import { describe, it, expect } from 'vitest'
import { createTestDb } from '../db/client'
import { MergeCoordinator } from './mergeCoordinator'

describe('MergeCoordinator', () => {
  it('processes clean merge and calls onComplete', async () => {
    const db = createTestDb()
    const completed: string[] = []
    const seenMerges: Array<{ target: string; source: string }> = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async (target, source) => {
        seenMerges.push({ target, source })
        return { success: true, conflictFiles: [] }
      },
      onComplete: id => completed.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', sourceBranch: 'lane/r1/rhythm', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(completed).toHaveLength(1)
    expect(seenMerges).toEqual([{ target: 'run/r1', source: 'lane/r1/rhythm' }])
  })

  it('calls onConflict when merge fails', async () => {
    const db = createTestDb()
    const conflicts: string[] = []
    const mc = new MergeCoordinator({
      db, repoRoot: '/tmp',
      doMerge: async () => ({ success: false, conflictFiles: ['a.ts'] }),
      onConflict: (id) => conflicts.push(id),
    })
    mc.enqueue({ leadId: 'l1', worktreeId: 'w1', sourceBranch: 'lane/r1/rhythm', targetBranch: 'run/r1' })
    await mc.processNext()
    expect(conflicts).toHaveLength(1)
  })
})
