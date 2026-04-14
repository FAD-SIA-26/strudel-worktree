import { describe, expect, it } from 'vitest'
import { pickDashboardCandidateUrls, pickReusableDashboardUrl } from './dashboard'

describe('pickReusableDashboardUrl', () => {
  it('returns the already-running dashboard URL from Next duplicate-server output', () => {
    const output = [
      '▲ Next.js 16.2.3 (Turbopack)',
      '- Local:         http://127.0.0.1:3301',
      '✓ Ready in 184ms',
      '⨯ Another next dev server is already running.',
      '',
      '- Local:        http://localhost:3121',
      '- PID:          2093291',
    ].join('\n')

    expect(pickReusableDashboardUrl(output)).toBe('http://localhost:3121')
  })

  it('returns null for normal startup output', () => {
    const output = [
      '▲ Next.js 16.2.3 (Turbopack)',
      '- Local:         http://127.0.0.1:3301',
      '✓ Ready in 184ms',
    ].join('\n')

    expect(pickReusableDashboardUrl(output)).toBeNull()
  })
})

describe('pickDashboardCandidateUrls', () => {
  it('prefers the reused dashboard URL and keeps the requested port as a fallback', () => {
    const output = [
      '▲ Next.js 16.2.3 (Turbopack)',
      '- Local:         http://127.0.0.1:3301',
      '✓ Ready in 184ms',
      '⨯ Another next dev server is already running.',
      '',
      '- Local:        http://localhost:3121',
      '- PID:          2093291',
    ].join('\n')

    expect(pickDashboardCandidateUrls(output, 3121)).toEqual([
      'http://localhost:3121',
      'http://127.0.0.1:3121',
      'http://127.0.0.1:3301',
    ])
  })

  it('deduplicates repeated Local URLs', () => {
    const output = [
      '- Local:         http://127.0.0.1:3121',
      '- Local:         http://127.0.0.1:3121',
    ].join('\n')

    expect(pickDashboardCandidateUrls(output, 3121)).toEqual([
      'http://127.0.0.1:3121',
      'http://localhost:3121',
    ])
  })
})
