import { describe, expect, it } from 'vitest'
import { composeLanePreview, composeContextualPreview } from './previewComposer'

describe('composeLanePreview', () => {
  it('turns a single export into runnable solo code', () => {
    const source = 'export const drums = sound("bd hh").gain(0.8)\n'
    const result = composeLanePreview({ laneName: 'drums', source })
    expect(result.generatedCode).toBe('const drums = sound("bd hh").gain(0.8)\nstack(drums)\n')
    expect(result.sourceFiles).toEqual(['src/drums.js'])
    expect(result.contextWinnerIds).toEqual([])
  })

  it('rejects multiple named exports', () => {
    const source = 'export const drums = sound("bd")\nexport const hats = sound("hh")\n'
    expect(() => composeLanePreview({ laneName: 'drums', source })).toThrow(/multiple named exports/i)
  })
})

describe('composeContextualPreview', () => {
  it('stacks upstream winners with the selected lane', () => {
    const result = composeContextualPreview({
      laneEntries: [
        { laneName: 'drums', workerId: 'drums-v1', source: 'export const drums = sound("bd hh")\n', filePath: 'src/drums.js' },
        { laneName: 'bass', workerId: 'bass-v2', source: 'export const bass = note("c2").sound("sawtooth")\n', filePath: 'src/bass.js' },
        { laneName: 'melody', workerId: 'melody-v3', source: 'export const melody = note("a4 c5").sound("sine")\n', filePath: 'src/melody.js' },
      ],
    })

    expect(result.generatedCode).toContain('const drums = sound("bd hh")')
    expect(result.generatedCode).toContain('const bass = note("c2").sound("sawtooth")')
    expect(result.generatedCode).toContain('const melody = note("a4 c5").sound("sine")')
    expect(result.generatedCode).toContain('stack(drums, bass, melody)')
    expect(result.contextWinnerIds).toEqual(['drums-v1', 'bass-v2'])
  })
})
