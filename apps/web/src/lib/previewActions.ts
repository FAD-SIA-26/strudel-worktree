import type { QueryClient } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

type PreviewArtifact = { previewUrl: string }

function openPreviewTab() {
  const previewTab = window.open('about:blank', '_blank')
  try {
    if (previewTab) previewTab.opener = null
  } catch {}
  return previewTab
}

async function parseArtifact(res: Response): Promise<PreviewArtifact | null> {
  try {
    const artifact = (await res.json()) as PreviewArtifact
    return artifact?.previewUrl ? artifact : null
  } catch {
    return null
  }
}

async function launchPreview(
  queryClient: QueryClient,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<PreviewArtifact | null> {
  const previewTab = openPreviewTab()
  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      previewTab?.close()
      return null
    }

    const artifact = await parseArtifact(res)
    if (!artifact) {
      previewTab?.close()
      return null
    }

    previewTab?.location.assign(artifact.previewUrl)
    await queryClient.invalidateQueries({ queryKey: ['orchestration'] })
    return artifact
  } catch {
    previewTab?.close()
    return null
  }
}

export async function launchWorkerPreview(
  queryClient: QueryClient,
  workerId: string,
  mode: 'solo' | 'contextual',
): Promise<PreviewArtifact | null> {
  return launchPreview(queryClient, '/api/preview/launch', { workerId, mode })
}

export async function launchFinalPreview(queryClient: QueryClient): Promise<PreviewArtifact | null> {
  return launchPreview(queryClient, '/api/preview/final')
}
