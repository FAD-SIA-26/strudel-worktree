import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'node:path'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createWorktree, listWorktrees, removeWorktree } from './worktree'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('worktree', () => {
  it('creates, lists, and removes a worktree', async () => {
    repoDir = initTestRepo('wt-test')
    const wtPath = path.resolve(`${repoDir}/../wt-rhythm-v1`)
    await createWorktree(repoDir, wtPath, 'feat/rhythm-v1')
    const wts = await listWorktrees(repoDir)
    expect(wts.some(w => w.path === wtPath)).toBe(true)
    await removeWorktree(repoDir, wtPath)
    const wts2 = await listWorktrees(repoDir)
    expect(wts2.some(w => w.path === wtPath)).toBe(false)
  })
})
