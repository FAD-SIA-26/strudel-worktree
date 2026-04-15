import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { launchFinalPreview, launchWorkerPreview } from './previewActions'

describe('previewActions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('navigates the first worker preview popup after the artifact is returned', async () => {
    const queryClient = new QueryClient()
    const assign = vi.fn()
    const close = vi.fn()
    const previewTab = {
      opener: { closed: false },
      location: { assign },
      close,
    }

    vi.stubGlobal('window', {
      open: vi.fn((_url?: string, _target?: string, features?: string) =>
        features?.includes('noopener') ? null : previewTab
      ),
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      previewUrl: 'https://strudel.cc/#worker',
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })))

    const artifact = await launchWorkerPreview(queryClient, 'melody-v1', 'solo')

    expect(artifact).toEqual({ previewUrl: 'https://strudel.cc/#worker' })
    expect(assign).toHaveBeenCalledWith('https://strudel.cc/#worker')
    expect(previewTab.opener).toBeNull()
    expect(close).not.toHaveBeenCalled()
  })

  it('navigates the first final preview popup after the artifact is returned', async () => {
    const queryClient = new QueryClient()
    const assign = vi.fn()
    const previewTab = {
      opener: { closed: false },
      location: { assign },
      close: vi.fn(),
    }

    vi.stubGlobal('window', {
      open: vi.fn((_url?: string, _target?: string, features?: string) =>
        features?.includes('noopener') ? null : previewTab
      ),
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      previewUrl: 'https://strudel.cc/#final',
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })))

    const artifact = await launchFinalPreview(queryClient)

    expect(artifact).toEqual({ previewUrl: 'https://strudel.cc/#final' })
    expect(assign).toHaveBeenCalledWith('https://strudel.cc/#final')
    expect(previewTab.opener).toBeNull()
  })
})
