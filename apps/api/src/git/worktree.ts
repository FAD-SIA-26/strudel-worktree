import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const exec = promisify(execFile)
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout.trim()
}

export interface WorktreeInfo { path: string; branch: string | null; head: string }

export async function createWorktree(repoRoot: string, wtPath: string, branch: string): Promise<void> {
  const resolved = path.resolve(wtPath)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await git(repoRoot, ['worktree', 'add', '-b', branch, resolved, 'HEAD'])
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

export async function createBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ['checkout', '-b', branch])
}

export async function mergeBranch(
  repoRoot: string, targetBranch: string, sourceBranch: string,
): Promise<{ success: boolean; conflictFiles: string[] }> {
  try {
    await git(repoRoot, ['checkout', targetBranch])
    await git(repoRoot, ['merge', sourceBranch, '--no-ff', '-m', `merge: ${sourceBranch}`])
    return { success: true, conflictFiles: [] }
  } catch {
    const conflicts = await git(repoRoot, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    await git(repoRoot, ['merge', '--abort']).catch(() => {})
    return { success: false, conflictFiles: conflicts.split('\n').filter(Boolean) }
  }
}
