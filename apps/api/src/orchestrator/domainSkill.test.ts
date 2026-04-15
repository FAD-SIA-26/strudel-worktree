import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveDomainSkill, resolveTemplateSelection } from './domainSkill'

async function makeRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-domain-skill-'))
  await fs.mkdir(path.join(repoRoot, 'skills', 'domains'), { recursive: true })
  await fs.mkdir(path.join(repoRoot, 'templates'), { recursive: true })
  await fs.writeFile(path.join(repoRoot, 'skills', 'domains', 'strudel.md'), '# Strudel\n- stay in lane\n')
  await fs.writeFile(
    path.join(repoRoot, 'templates', 'strudel-track.toml'),
    '[template]\nname = "strudel-track"\nversion = "1.0"\ndescription = "demo"\n',
  )
  await fs.writeFile(
    path.join(repoRoot, 'templates', 'explicit.toml'),
    '[template]\nname = "explicit"\nversion = "1.0"\ndescription = "demo"\n',
  )
  return repoRoot
}

describe('domain skill resolution', () => {
  it('loads the strudel skill file and default template metadata', async () => {
    const repoRoot = await makeRepo()
    const skill = await resolveDomainSkill(repoRoot, 'strudel')
    expect(skill).not.toBeNull()
    expect(skill?.name).toBe('strudel')
    expect(skill?.defaultTemplateName).toBe('strudel-track')
    expect(skill?.filePath).toBe(path.join(repoRoot, 'skills', 'domains', 'strudel.md'))
    expect(skill?.content).toContain('stay in lane')
  })

  it('selects the explicit template even when a valid skill default and a non-music goal are provided', async () => {
    const repoRoot = await makeRepo()
    const selection = await resolveTemplateSelection({
      repoRoot,
      userGoal: 'build admin dashboard',
      explicitTemplateName: 'explicit',
      skillName: 'strudel',
    })
    expect(selection).toBe(path.join(repoRoot, 'templates', 'explicit.toml'))
  })

  it('still uses the explicit template even when the skill is invalid', async () => {
    const repoRoot = await makeRepo()
    const selection = await resolveTemplateSelection({
      repoRoot,
      userGoal: 'write a track',
      explicitTemplateName: 'explicit',
      skillName: 'invalid-skill',
    })
    expect(selection).toBe(path.join(repoRoot, 'templates', 'explicit.toml'))
  })

  it('falls back to the skill default template when no explicit template is provided', async () => {
    const repoRoot = await makeRepo()
    const selection = await resolveTemplateSelection({
      repoRoot,
      userGoal: 'build admin dashboard',
      skillName: 'strudel',
    })
    expect(selection).toBe(path.join(repoRoot, 'templates', 'strudel-track.toml'))
  })

  it('auto-detects the template from a music-related goal when no skill or explicit template is supplied', async () => {
    const repoRoot = await makeRepo()
    const selection = await resolveTemplateSelection({
      repoRoot,
      userGoal: 'compose a bass-heavy beat',
    })
    expect(selection).toBe(path.join(repoRoot, 'templates', 'strudel-track.toml'))
  })

  it('rejects unknown skill names', async () => {
    const repoRoot = await makeRepo()
    await expect(resolveDomainSkill(repoRoot, 'unknown-skill')).rejects.toThrow(/Unknown skill/)
  })

  it('falls back to bundled assets when the target repo does not contain skills or templates', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-domain-skill-fallback-'))

    const skill = await resolveDomainSkill(repoRoot, 'strudel')
    const templatePath = await resolveTemplateSelection({
      repoRoot,
      userGoal: 'write a track',
      skillName: 'strudel',
    })

    expect(skill).not.toBeNull()
    expect(skill?.filePath).toContain(path.join('skills', 'domains', 'strudel.md'))
    expect(skill?.content.length).toBeGreaterThan(0)
    expect(templatePath).toContain(path.join('templates', 'strudel-track.toml'))
  })
})
