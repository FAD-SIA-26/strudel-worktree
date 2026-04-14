import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSQLite, type Db } from '../db/client'

function sectionIdForWorker(worktreeId: string): string {
  const namespacedMatch = worktreeId.match(/-([^-]+)-v\d+(?:-r\d+)?$/)
  if (namespacedMatch?.[1]) return namespacedMatch[1]
  return worktreeId.replace(/-v\d+(-r\d+)?$/, '')
}

async function codeFileForWorker(worktreePath: string, worktreeId: string): Promise<string> {
  const sectionId = sectionIdForWorker(worktreeId)
  const preferred = sectionId === 'arrangement'
    ? ['src/index.js']
    : [`src/${sectionId}.js`, 'src/index.js']

  for (const candidate of preferred) {
    try {
      await fs.access(path.join(worktreePath, candidate))
      return candidate
    } catch {}
  }

  try {
    const srcDirEntries = await fs.readdir(path.join(worktreePath, 'src'))
    const jsFiles = srcDirEntries.filter(entry => entry.endsWith('.js')).sort()
    if (jsFiles.includes('index.js')) return 'src/index.js'
    if (jsFiles[0]) return `src/${jsFiles[0]}`
  } catch {}

  return preferred[0] ?? 'src/index.js'
}

export async function generateStrudelPreviewUrl(worktreePath: string, worktreeId: string): Promise<string> {
  const codeFile = await codeFileForWorker(worktreePath, worktreeId)
  let code = ''
  try { code = await fs.readFile(path.join(worktreePath, codeFile), 'utf-8') }
  catch { code = `// ${codeFile} not yet written` }
  const encoded = Buffer.from(code).toString('base64')
  return `https://strudel.cc/#${encoded}`
}

export async function launchPreview(db: Db, worktreeId: string, worktreePath: string): Promise<string> {
  const previewUrl = await generateStrudelPreviewUrl(worktreePath, worktreeId)
  const id = `preview-${worktreeId}`
  getSQLite(db).prepare(`
    INSERT INTO previews(id, worktree_id, preview_url, status, launched_at)
    VALUES(?,?,?,'active',?)
    ON CONFLICT(id) DO UPDATE SET preview_url=excluded.preview_url, status='active', launched_at=excluded.launched_at
  `).run(id, worktreeId, previewUrl, Date.now())
  return previewUrl
}

export function stopPreview(db: Db, worktreeId: string): void {
  getSQLite(db).prepare("UPDATE previews SET status='inactive' WHERE worktree_id=?").run(worktreeId)
}
