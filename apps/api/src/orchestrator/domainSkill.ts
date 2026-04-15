import * as fs from 'node:fs/promises'
import * as path from 'node:path'

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

  const filePath = path.join(repoRoot, record.relativePath)
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
    return path.join(opts.repoRoot, 'templates', `${opts.explicitTemplateName}.toml`)
  }

  const skill = await resolveDomainSkill(opts.repoRoot, opts.skillName)
  const templateName = skill?.defaultTemplateName ?? autoDetectTemplateName(opts.userGoal)

  if (!templateName) return undefined
  return path.join(opts.repoRoot, 'templates', `${templateName}.toml`)
}
