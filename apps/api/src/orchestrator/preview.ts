import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSQLite, type Db } from '../db/client'

function codeFileForWorker(worktreeId: string): string {
  const sectionId = worktreeId.replace(/-v\d+(-r\d+)?$/, '')
  return sectionId === 'arrangement' ? 'src/index.js' : `src/${sectionId}.js`
}

export async function generateStrudelPreviewUrl(worktreePath: string, worktreeId: string): Promise<string> {
  const codeFile = codeFileForWorker(worktreeId)
  let code = ''
  try { code = await fs.readFile(path.join(worktreePath, codeFile), 'utf-8') }
  catch { code = `// ${codeFile} not yet written` }
  const encoded = Buffer.from(code).toString('base64url')
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
