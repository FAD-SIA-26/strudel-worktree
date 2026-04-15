import { describe, expect, it } from 'vitest'
import * as url from 'node:url'
import { loadTemplate } from './templateLoader'

const strudelTemplatePath = url.fileURLToPath(
  new URL('../../../../templates/strudel-track.toml', import.meta.url),
)

describe('loadTemplate', () => {
  it('loads the bundled strudel template with fully parallel sections', async () => {
    const template = await loadTemplate(strudelTemplatePath)

    expect(
      template.sections.map(section => ({
        id: section.id,
        dependsOn: section.depends_on,
      })),
    ).toEqual([
      { id: 'drums', dependsOn: [] },
      { id: 'bass', dependsOn: [] },
      { id: 'chords', dependsOn: [] },
      { id: 'melody', dependsOn: [] },
      { id: 'arrangement', dependsOn: [] },
    ])
  })
})
