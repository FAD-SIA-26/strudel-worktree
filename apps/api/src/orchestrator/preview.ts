import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getSQLite, type Db } from '../db/client'
import { getAllTasks, getMergeCandidates, getWorktrees } from '../db/queries'
import { composeContextualPreview, composeLanePreview } from './previewComposer'

export type PreviewMode = 'solo' | 'contextual'

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
  if (codeFile !== 'src/index.js') {
    code = composeLanePreview({
      laneName: sectionIdForWorker(worktreeId),
      source: code,
    }).generatedCode
  }
  const encoded = Buffer.from(code).toString('base64')
  return `https://strudel.cc/#${encoded}`
}

function encodePreviewUrl(generatedCode: string): string {
  return `https://strudel.cc/#${Buffer.from(generatedCode).toString('base64')}`
}

export async function generateRunPreviewUrl(worktreePath: string, runBranch: string): Promise<string> {
  const codePath = path.join(worktreePath, 'src/index.js')
  let generatedCode = ''
  try {
    generatedCode = await fs.readFile(codePath, 'utf8')
  } catch {
    generatedCode = `// src/index.js not yet written for ${runBranch}`
  }
  return encodePreviewUrl(generatedCode)
}

function persistPreviewArtifact(
  db: Db,
  workerId: string,
  mode: PreviewMode,
  previewUrl: string,
  generatedCode: string,
  sourceFiles: string[],
  contextWinnerIds: string[],
  generatedAt: number,
): void {
  getSQLite(db).prepare(`
    INSERT INTO previews(worker_id, mode, preview_url, generated_code, source_files, context_winner_ids, generated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(worker_id, mode) DO UPDATE SET
      preview_url=excluded.preview_url,
      generated_code=excluded.generated_code,
      source_files=excluded.source_files,
      context_winner_ids=excluded.context_winner_ids,
      generated_at=excluded.generated_at
  `).run(
    workerId,
    mode,
    previewUrl,
    generatedCode,
    JSON.stringify(sourceFiles),
    JSON.stringify(contextWinnerIds),
    generatedAt,
  )
}

export async function launchPreview(db: Db, workerId: string, worktreePath: string, mode: PreviewMode) {
  const laneName = sectionIdForWorker(workerId)
  const codeFile = await codeFileForWorker(worktreePath, workerId)

  // Fallback: generate placeholder if file doesn't exist (Issue #1 defense-in-depth)
  let source: string
  try {
    source = await fs.readFile(path.join(worktreePath, codeFile), 'utf8')
  } catch (error) {
    // File doesn't exist - generate placeholder
    source = `// Placeholder: ${codeFile} not yet written by worker\n// Worker ID: ${workerId}\nsetcpm(90 / 4);\n\nexport const ${laneName} = s("bd sd").fast(2);`
  }

  if (mode === 'solo') {
    const draft = codeFile === 'src/index.js'
      ? { generatedCode: source, sourceFiles: [codeFile], contextWinnerIds: [] as string[] }
      : composeLanePreview({ laneName, source })
    const previewUrl = encodePreviewUrl(draft.generatedCode)
    const generatedAt = Date.now()
    persistPreviewArtifact(db, workerId, mode, previewUrl, draft.generatedCode, draft.sourceFiles, draft.contextWinnerIds, generatedAt)
    return { workerId, mode, previewUrl, ...draft, generatedAt }
  }

  const tasks = getAllTasks(db)
  const leadId = tasks.find(t => t.type === 'worker' && t.id === workerId)?.parentId
  if (!leadId) {
    throw new Error(`lead not found for worker ${workerId}`)
  }

  const mergeCandidates = getMergeCandidates(db)
  const winnerIds = mergeCandidates
    .filter(c => c.leadId !== leadId && c.selectedWinnerWorkerId != null)
    .map(c => c.selectedWinnerWorkerId as string)

  if (winnerIds.length === 0) {
    throw new Error(`context unavailable for ${workerId}: no approved winners from other sections`)
  }

  const worktrees = getWorktrees(db)
  const upstreamEntries = await Promise.all(winnerIds.map(async winnerWorkerId => {
    const wt = worktrees.find(x => x.workerId === winnerWorkerId)
    if (!wt) {
      throw new Error(`worktree not found for context worker ${winnerWorkerId}`)
    }
    const upstreamLaneName = sectionIdForWorker(winnerWorkerId)
    const filePath = await codeFileForWorker(wt.path, winnerWorkerId)
    const upstreamSource = await fs.readFile(path.join(wt.path, filePath), 'utf8')
    return { laneName: upstreamLaneName, workerId: winnerWorkerId, filePath, source: upstreamSource }
  }))

  const draft = composeContextualPreview({
    laneEntries: [
      ...upstreamEntries,
      {
        laneName,
        workerId,
        filePath: codeFile,
        source,
      },
    ],
  })

  const previewUrl = encodePreviewUrl(draft.generatedCode)
  const generatedAt = Date.now()
  persistPreviewArtifact(db, workerId, mode, previewUrl, draft.generatedCode, draft.sourceFiles, draft.contextWinnerIds, generatedAt)
  return { workerId, mode, previewUrl, ...draft, generatedAt }
}

export async function launchRunPreview(db: Db, runId: string, worktreePath: string) {
  // Collect all approved winners across all sections and compose them into a
  // single self-contained Strudel snippet. This avoids ES module import issues
  // that arise when src/index.js uses `import { x } from './x.js'` syntax.
  const mergeCandidates = getMergeCandidates(db)
  const worktrees = getWorktrees(db)

  const winnerEntries = await Promise.all(
    mergeCandidates
      .filter(c => c.selectedWinnerWorkerId != null)
      .map(async c => {
        const winnerWorkerId = c.selectedWinnerWorkerId as string
        const wt = worktrees.find(x => x.workerId === winnerWorkerId)
        if (!wt) return null
        const laneName = sectionIdForWorker(winnerWorkerId)
        // Skip arrangement lane — it writes index.js which we compose ourselves
        if (laneName === 'arrangement') return null
        const filePath = await codeFileForWorker(wt.path, winnerWorkerId)
        let source: string
        try {
          source = await fs.readFile(path.join(wt.path, filePath), 'utf8')
        } catch {
          return null
        }
        return { laneName, workerId: winnerWorkerId, filePath, source }
      })
  )

  const validEntries = winnerEntries.filter((e): e is NonNullable<typeof e> => e !== null)

  if (validEntries.length === 0) {
    throw new Error('final preview unavailable: no approved winners with source files')
  }

  const draft = composeContextualPreview({ laneEntries: validEntries })
  const previewUrl = encodePreviewUrl(draft.generatedCode)
  const generatedAt = Date.now()
  persistPreviewArtifact(
    db,
    `run:${runId}:final`,
    'solo',
    previewUrl,
    draft.generatedCode,
    draft.sourceFiles,
    draft.contextWinnerIds,
    generatedAt,
  )
  return { workerId: `run:${runId}:final`, mode: 'solo' as const, previewUrl, generatedAt }
}

export function stopPreview(db: Db, workerId: string): void {
  getSQLite(db).prepare('DELETE FROM previews WHERE worker_id=?').run(workerId)
}
