import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const exec = promisify(execFile)
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout.trim()
}

export interface WorktreeInfo { path: string; branch: string | null; head: string }

/** Create a worktree on a NEW branch (branch must not exist yet) */
export async function createWorktree(repoRoot: string, wtPath: string, branch: string): Promise<void> {
  const resolved = path.resolve(wtPath)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await git(repoRoot, ['worktree', 'add', '-b', branch, resolved, 'HEAD'])
  await fs.mkdir(path.join(resolved, '.orc'), { recursive: true })
}

/** Create a worktree for an EXISTING branch (no -b flag) */
export async function addWorktreeForBranch(repoRoot: string, wtPath: string, branch: string): Promise<void> {
  const resolved = path.resolve(wtPath)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await git(repoRoot, ['worktree', 'add', resolved, branch])
  await fs.mkdir(path.join(resolved, '.orc'), { recursive: true })
}

export async function removeWorktree(repoRoot: string, wtPath: string): Promise<void> {
  const resolved = path.resolve(wtPath)
  await git(repoRoot, ['worktree', 'remove', '--force', resolved])
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  const result: WorktreeInfo[] = []
  let cur: Partial<WorktreeInfo> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur.path = line.slice(9)
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
    else if (line === '' && cur.path) { result.push(cur as WorktreeInfo); cur = {} }
  }
  if (cur.path) result.push(cur as WorktreeInfo)
  return result
}

export async function getWorktreeDiff(wtPath: string, baseBranch: string): Promise<string> {
  try { return await git(wtPath, ['diff', baseBranch, '--stat']) } catch { return '' }
}

export async function hasUncommittedChanges(wtPath: string): Promise<boolean> {
  try { return (await git(wtPath, ['status', '--porcelain'])).length > 0 } catch { return false }
}

export async function commitWorktreeChanges(
  wtPath: string,
  message: string,
): Promise<{ committed: boolean; sha?: string }> {
  const status = await git(wtPath, ['status', '--porcelain', '--untracked-files=all'])
    .catch(() => '')
  const changedPaths = status
    .split('\n')
    .map(line => line.slice(3))
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('.orc/'))

  if (changedPaths.length === 0) return { committed: false }

  await git(wtPath, ['add', '--', ...changedPaths])
  await git(wtPath, [
    '-c', 'user.name=ORC',
    '-c', 'user.email=orc@local',
    'commit',
    '-m',
    message,
  ])

  return { committed: true, sha: await git(wtPath, ['rev-parse', 'HEAD']) }
}

/** Create a branch at HEAD without switching the working tree — safe when run mid-orchestration */
export async function createBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ['branch', branch])
}

export function findRepoRootSync(startDir: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir, encoding: 'utf8' }).trim()
}

export function hasCommittedHeadSync(repoRoot: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function getCurrentBranchSync(repoRoot: string): string | null {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    return branch || null
  } catch {
    return null
  }
}

export function getHeadShaSync(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function getStatusEntriesSync(repoRoot: string): string[] {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean)
}

export function applyRunBranchToCurrentBranchSync(
  repoRoot: string,
  opts: { expectedBranch: string; expectedHead: string; runBranch: string },
): { applied: boolean; reason?: string } {
  const currentBranch = getCurrentBranchSync(repoRoot)
  if (!currentBranch) {
    return { applied: false, reason: 'repository is in detached HEAD state' }
  }
  if (currentBranch !== opts.expectedBranch) {
    return { applied: false, reason: `current branch changed from ${opts.expectedBranch} to ${currentBranch}` }
  }

  const relevantChanges = getStatusEntriesSync(repoRoot)
    .filter(entry => !entry.startsWith('.orc/'))
  if (relevantChanges.length > 0) {
    return { applied: false, reason: `repository has local changes: ${relevantChanges.slice(0, 3).join(', ')}` }
  }

  const currentHead = getHeadShaSync(repoRoot)
  if (currentHead !== opts.expectedHead) {
    return {
      applied: false,
      reason: `branch ${opts.expectedBranch} moved during the run (${opts.expectedHead.slice(0, 7)} -> ${currentHead.slice(0, 7)})`,
    }
  }

  try {
    execFileSync('git', ['merge', '--ff-only', opts.runBranch], { cwd: repoRoot, stdio: 'pipe' })
    return { applied: true }
  } catch (error: any) {
    const stderr = typeof error?.stderr === 'string'
      ? error.stderr.trim()
      : Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf8').trim()
        : ''
    return { applied: false, reason: stderr || error?.message || `failed to fast-forward ${opts.expectedBranch}` }
  }
}

/**
 * Merge sourceBranch into the worktree at targetWorktreePath.
 * The caller must pass a worktree that is already checked out to the target branch.
 * This never touches the main working directory.
 */
export async function mergeBranch(
  targetWorktreePath: string,
  sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  try {
    await git(targetWorktreePath, ['merge', sourceBranch, '--no-ff', '-m', `merge: ${sourceBranch}`])
    return { success: true, conflictFiles: [] }
  } catch {
    const conflicts = await git(targetWorktreePath, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    await git(targetWorktreePath, ['merge', '--abort']).catch(() => {})
    return { success: false, conflictFiles: conflicts.split('\n').filter(Boolean) }
  }
}
