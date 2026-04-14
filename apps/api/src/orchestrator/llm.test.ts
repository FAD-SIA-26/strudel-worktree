import { describe, it, expect, vi } from 'vitest'
import { createLLMClient } from './llm'

describe('LLM client', () => {
  it('calls OpenAI-compatible endpoint and returns content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'result' } }] }),
    })
    global.fetch = mockFetch as any
    const llm = createLLMClient({ baseURL: 'http://test/v1', model: 'gpt-4o', apiKey: 'k' })
    expect(await llm('hello')).toBe('result')
  })
})
