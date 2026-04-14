export function createLLMClient(cfg: { baseURL: string; model: string; apiKey: string }): (p: string) => Promise<string> {
  return async (prompt) => {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.choices[0].message.content as string
  }
}

export function createLLMClientFromEnv(): (p: string) => Promise<string> {
  return createLLMClient({
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model:   process.env.OPENAI_MODEL   ?? 'gpt-4o',
    apiKey:  process.env.OPENAI_API_KEY ?? '',
  })
}
