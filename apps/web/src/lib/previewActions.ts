import type { QueryClient } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

type PreviewArtifact = { previewUrl: string }

function openPreviewTab() {
  return window.open('about:blank', '_blank', 'noopener,noreferrer')
}

async function parseArtifact(res: Response): Promise<PreviewArtifact | null> {
  try {
    const artifact = (await res.json()) as PreviewArtifact
    return artifact?.previewUrl ? artifact : null
  } catch {
    return null
  }
}

export async function launchWorkerPreview(
  queryClient: QueryClient,
  workerId: string,
  mode: 'solo' | 'contextual',
): Promise<PreviewArtifact | null> {
  const previewTab = openPreviewTab()
  try {
    const res = await fetch(`${API}/api/preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId, mode }),
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

export async function launchFinalPreview(queryClient: QueryClient): Promise<PreviewArtifact | null> {
  const previewTab = openPreviewTab()
  try {
    const res = await fetch(`${API}/api/preview/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
