import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { resolveOrcAssetPath } from '../runtime/paths'

const DOMAIN_SKILLS = {
  strudel: {
    relativePath: 'skills/domains/strudel.md',
    defaultTemplateName: 'strudel-track',
  },
} as const

export type DomainSkillName = keyof typeof DOMAIN_SKILLS

export interface ResolvedDomainSkill {
  name: DomainSkillName
  filePath: string
  content: string
  defaultTemplateName: string
}

async function findReadablePath(primaryPath: string, fallbackPath?: string): Promise<string> {
  try {
    await fs.access(primaryPath)
    return primaryPath
  } catch {
    if (!fallbackPath) throw new Error(`Missing required asset at ${primaryPath}`)
    await fs.access(fallbackPath)
    return fallbackPath
  }
}

function autoDetectTemplateName(userGoal: string): string | undefined {
  return /\b(track|song|beat|melody|chords|bass|drums|strudel|arrangement)\b/i.test(userGoal)
    ? 'strudel-track'
    : undefined
}

export async function resolveDomainSkill(repoRoot: string, skillName?: string): Promise<ResolvedDomainSkill | null> {
  if (!skillName) return null

  const record = DOMAIN_SKILLS[skillName as DomainSkillName]
  if (!record) {
    throw new Error(
      `Unknown skill "${skillName}". Supported skills: ${Object.keys(DOMAIN_SKILLS).join(', ')}`,
    )
  }

  const repoPath = path.join(repoRoot, record.relativePath)
  const bundledPath = resolveOrcAssetPath(import.meta.url, record.relativePath)
  const filePath = await findReadablePath(repoPath, bundledPath)
  const content = await fs.readFile(filePath, 'utf8')

  return {
    name: skillName as DomainSkillName,
    filePath,
    content,
    defaultTemplateName: record.defaultTemplateName,
  }
}

export async function resolveTemplateSelection(opts: {
  repoRoot: string
  userGoal: string
  explicitTemplateName?: string
  skillName?: string
}): Promise<string | undefined> {
  if (opts.explicitTemplateName) {
    // Check if user provided a full path (contains / or \) or has .toml extension
    const isFullPath = opts.explicitTemplateName.includes('/') || opts.explicitTemplateName.includes('\\')
    const hasExtension = opts.explicitTemplateName.endsWith('.toml')

    if (isFullPath && hasExtension) {
      // User provided full path like "templates/strudel-track.toml"
      const fullPath = path.resolve(opts.repoRoot, opts.explicitTemplateName)
      return findReadablePath(
        fullPath,
        resolveOrcAssetPath(import.meta.url, opts.explicitTemplateName),
      )
    } else if (hasExtension) {
      // User provided filename with extension like "strudel-track.toml"
      const templateName = opts.explicitTemplateName.replace(/\.toml$/, '')
      return findReadablePath(
        path.join(opts.repoRoot, 'templates', `${templateName}.toml`),
        resolveOrcAssetPath(import.meta.url, 'templates', `${templateName}.toml`),
      )
    } else {
      // User provided just the name like "strudel-track"
      return findReadablePath(
        path.join(opts.repoRoot, 'templates', `${opts.explicitTemplateName}.toml`),
        resolveOrcAssetPath(import.meta.url, 'templates', `${opts.explicitTemplateName}.toml`),
      )
    }
  }

  const skill = await resolveDomainSkill(opts.repoRoot, opts.skillName)
  const templateName = skill?.defaultTemplateName ?? autoDetectTemplateName(opts.userGoal)

  if (!templateName) return undefined
  return findReadablePath(
    path.join(opts.repoRoot, 'templates', `${templateName}.toml`),
    resolveOrcAssetPath(import.meta.url, 'templates', `${templateName}.toml`),
  )
}
