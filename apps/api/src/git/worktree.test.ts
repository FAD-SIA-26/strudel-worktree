import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import {
  addWorktreeForBranch,
  applyRunBranchToCurrentBranchSync,
  commitWorktreeChanges,
  createWorktree,
  getCurrentBranchSync,
  getHeadShaSync,
  listWorktrees,
  removeWorktree,
} from './worktree'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('worktree', () => {
  it('creates, lists, and removes a worktree', async () => {
    repoDir = initTestRepo('wt-test')
    await fs.mkdir(path.join(repoDir, 'node_modules'), { recursive: true })
    await fs.mkdir(path.join(repoDir, 'apps', 'web', 'node_modules'), { recursive: true })
    const wtPath = path.resolve(`${repoDir}/../wt-rhythm-v1`)
    await createWorktree(repoDir, wtPath, 'feat/rhythm-v1')
    const wts = await listWorktrees(repoDir)
    expect(wts.some(w => w.path === wtPath)).toBe(true)
    expect((await fs.lstat(path.join(wtPath, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(path.join(wtPath, 'apps', 'web', 'node_modules'))).isSymbolicLink()).toBe(true)
    await removeWorktree(repoDir, wtPath)
    const wts2 = await listWorktrees(repoDir)
    expect(wts2.some(w => w.path === wtPath)).toBe(false)
  })

  it('detects the current branch name for non-main repos', () => {
    repoDir = initTestRepo('wt-branch-test', { initialBranch: 'trunk' })
    expect(getCurrentBranchSync(repoDir)).toBe('trunk')
  })

  it('can skip dependency hydration for merge-only worktrees', async () => {
    repoDir = initTestRepo('wt-run-branch-test')
    await fs.mkdir(path.join(repoDir, 'node_modules'), { recursive: true })
    execFileSync('git', ['branch', 'run/r1'], { cwd: repoDir, stdio: 'pipe' })

    const wtPath = path.resolve(`${repoDir}/../run-r1-${path.basename(repoDir)}`)
    await addWorktreeForBranch(repoDir, wtPath, 'run/r1', { hydrateDependencies: false })

    await expect(fs.lstat(path.join(wtPath, 'node_modules'))).rejects.toThrow()
  })

  it('fast-forwards the user branch to the completed run branch while ignoring .orc state', async () => {
    repoDir = initTestRepo('wt-apply-run-test')
    const expectedHead = getHeadShaSync(repoDir)
    execFileSync('git', ['branch', 'run/r1'], { cwd: repoDir, stdio: 'pipe' })

    const runWtPath = path.resolve(`${repoDir}/../run-r1-${path.basename(repoDir)}`)
    await addWorktreeForBranch(repoDir, runWtPath, 'run/r1')
    await fs.writeFile(path.join(runWtPath, 'index.html'), '<h1>Cows</h1>\n')
    execFileSync('git', ['add', 'index.html'], { cwd: runWtPath, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'add landing page'], { cwd: runWtPath, stdio: 'pipe' })
    await fs.mkdir(path.join(repoDir, '.orc'), { recursive: true })
    await fs.writeFile(path.join(repoDir, '.orc', 'dashboard.log'), 'running\n')

    const applied = applyRunBranchToCurrentBranchSync(repoDir, {
      expectedBranch: 'main',
      expectedHead,
      runBranch: 'run/r1',
    })

    expect(applied).toEqual({ applied: true })
    expect(await fs.readFile(path.join(repoDir, 'index.html'), 'utf8')).toBe('<h1>Cows</h1>\n')
  })

  it('refuses to apply the run branch when the user repo has real local edits', async () => {
    repoDir = initTestRepo('wt-apply-guard-test')
    const expectedHead = getHeadShaSync(repoDir)
    await fs.writeFile(path.join(repoDir, 'README.md'), '# changed locally\n')

    const applied = applyRunBranchToCurrentBranchSync(repoDir, {
      expectedBranch: 'main',
      expectedHead,
      runBranch: 'run/r1',
    })

    expect(applied.applied).toBe(false)
    expect(applied.reason).toContain('README.md')
  })

  it('commits modified tracked files without truncating the first path from porcelain status output', async () => {
    repoDir = initTestRepo('wt-commit-porcelain-test')
    await fs.writeFile(path.join(repoDir, 'README.md'), '# updated\n')
    await fs.writeFile(path.join(repoDir, 'track.md'), 'track draft\n')

    const result = await commitWorktreeChanges(repoDir, 'test commit')

    expect(result.committed).toBe(true)
    expect(execFileSync('git', ['show', 'HEAD:README.md'], { cwd: repoDir, encoding: 'utf8' })).toBe('# updated\n')
    expect(execFileSync('git', ['show', 'HEAD:track.md'], { cwd: repoDir, encoding: 'utf8' })).toBe('track draft\n')
  })
})
