import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export function initTestRepo(label = `${Date.now()}`): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `orc-test-${label}-`))
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@orc.test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "OrcTest"', { cwd: dir, stdio: 'pipe' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# orc test repo')
  execSync('git add .', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  return dir
}

export function cleanupTestRepo(dir?: string): void {
  if (!dir) return
  fs.rmSync(dir, { recursive: true, force: true })
}
