export interface PreviewArtifactDraft {
  generatedCode: string
  sourceFiles: string[]
  contextWinnerIds: string[]
}

export interface LanePreviewInput {
  laneName: string
  source: string
}

export interface ContextLaneEntry {
  laneName: string
  workerId: string
  source: string
  filePath: string
}

function extractLaneConst(laneName: string, source: string): string {
  // Extract only the export const lines (not setcpm, imports, etc.)
  const exportConstRegex = /^export\s+const\s+([A-Za-z0-9_]+)/gm
  const exportMatches = [...source.matchAll(exportConstRegex)]

  if (exportMatches.length === 0) {
    throw new Error(`no export const found in source for lane ${laneName}`)
  }
  if (exportMatches.length > 1) {
    throw new Error('multiple named exports are not supported in phase 1 previews')
  }

  // Extract the full export statement
  const matches = [...source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*([\s\S]*?)(?:;\s*$|$)/gm)]
  const [, exportedName, expr] = matches[0]!

  if (exportedName !== laneName) {
    throw new Error(`expected export const ${laneName}, got ${exportedName}`)
  }

  return `const ${laneName} = ${expr.trim()}\n`
}

export function composeLanePreview({ laneName, source }: LanePreviewInput): PreviewArtifactDraft {
  const laneConst = extractLaneConst(laneName, source)
  return {
    generatedCode: `${laneConst}stack(${laneName})\n`,
    sourceFiles: [`src/${laneName}.js`],
    contextWinnerIds: [],
  }
}

export function composeContextualPreview({ laneEntries }: { laneEntries: ContextLaneEntry[] }): PreviewArtifactDraft {
  const consts = laneEntries.map(entry => extractLaneConst(entry.laneName, entry.source))
  const laneNames = laneEntries.map(entry => entry.laneName)
  const sourceFiles = laneEntries.map(entry => entry.filePath)
  const contextWinnerIds = laneEntries.slice(0, -1).map(entry => entry.workerId)

  return {
    generatedCode: `${consts.join('')}stack(${laneNames.join(', ')})\n`,
    sourceFiles,
    contextWinnerIds,
  }
}
