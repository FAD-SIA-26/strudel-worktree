import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailPanel } from './DetailPanel'

const useEntityDetailMock = vi.fn()
const useEntityLogsMock = vi.fn()

vi.mock('../hooks/useEntityDetail', () => ({
  useEntityDetail: (entityId: string | null) => useEntityDetailMock(entityId),
}))

vi.mock('../hooks/useEntityLogs', () => ({
  useEntityLogs: (entityId: string | null) => useEntityLogsMock(entityId),
}))

function renderPanel(selectedId: string) {
  const client = new QueryClient()

  return render(
    <QueryClientProvider client={client}>
      <DetailPanel
        selectedId={selectedId}
        sections={[
          {
            id: 'main',
            state: 'running',
            workers: [
              {
                id: 'main-v1',
                state: 'running',
                branch: 'feat/main-v1',
                selected: false,
                contextAvailable: false,
                previewArtifacts: [{ mode: 'solo', previewUrl: 'https://example.test/solo' }],
              },
            ],
          },
        ]}
      />
    </QueryClientProvider>,
  )
}

describe('DetailPanel', () => {
  beforeEach(() => {
    useEntityDetailMock.mockReset()
    useEntityLogsMock.mockReset()
  })

  it('renders worker plan, logs, diff, and preview tabs with inline content', () => {
    useEntityDetailMock.mockReturnValue({
      data: {
        entityId: 'main-v1',
        entityType: 'worker',
        title: 'main-v1',
        resolvedPaths: {
          worktreePath: '/repo/.orc/worktrees/main-v1',
          planPath: '/repo/.orc/worktrees/main-v1/.orc/worker-plan.md',
          logPath: '/repo/.orc/worktrees/main-v1/.orc/.orc-session.jsonl',
        },
        plan: { status: 'ready', content: '# Worker Plan\n\n- [ ] inspect\n' },
        diff: { status: 'ready', content: 'diff --git a/README.md b/README.md', branch: 'feat/main-v1', baseBranch: 'main' },
      },
      isLoading: false,
    })
    useEntityLogsMock.mockReturnValue({
      entries: [{ id: 'main-v1:line:1', ts: 1, kind: 'stdout', title: 'stdout', body: 'hello worker', raw: '{"ts":1,"output":"hello worker"}' }],
      status: 'ready',
      error: null,
    })

    renderPanel('main-v1')

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText('/repo/.orc/worktrees/main-v1/.orc/worker-plan.md')).toBeInTheDocument()
    expect(screen.getByText('# Worker Plan', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText('/repo/.orc/worktrees/main-v1/.orc/.orc-session.jsonl')).toBeInTheDocument()
    expect(screen.getByText('hello worker')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByText(/diff --git a\/README.md b\/README.md/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
  })

  it('renders lead plan, lead-only logs, and selected winner diff', () => {
    useEntityDetailMock.mockReturnValue({
      data: {
        entityId: 'main-lead',
        entityType: 'lead',
        title: 'main-lead',
        resolvedPaths: {
          planPath: '/repo/.orc/runs/r1/leads/main.md',
          winnerWorktreePath: '/repo/.orc/worktrees/main-v1',
        },
        plan: { status: 'ready', content: '# Lead Plan\n' },
        diff: { status: 'ready', content: 'diff --git a/README.md b/README.md', winnerWorkerId: 'main-v1', branch: 'feat/main-v1', baseBranch: 'main' },
      },
      isLoading: false,
    })
    useEntityLogsMock.mockReturnValue({
      entries: [{ id: 'main-lead:event:41', ts: 41, kind: 'lead_event', title: 'ReviewComplete', body: '{"winnerId":"main-v1"}', raw: '{"winnerId":"main-v1"}' }],
      status: 'ready',
      error: null,
    })

    renderPanel('main-lead')

    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diff' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByText('/repo/.orc/runs/r1/leads/main.md')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
    expect(screen.getByText('ReviewComplete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
    expect(screen.getByText(/diff --git a\/README.md b\/README.md/)).toBeInTheDocument()
  })

  it('shows a recoverable API error when winner selection cannot reach the backend', async () => {
    useEntityDetailMock.mockReturnValue({
      data: {
        entityId: 'main-lead',
        entityType: 'lead',
        title: 'main-lead',
        resolvedPaths: {
          planPath: '/repo/.orc/runs/r1/leads/main.md',
          winnerWorktreePath: null,
        },
        plan: { status: 'ready', content: '# Lead Plan\n' },
        diff: { status: 'empty', content: null, winnerWorkerId: null },
      },
      isLoading: false,
    })
    useEntityLogsMock.mockReturnValue({
      entries: [],
      status: 'ready',
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <DetailPanel
          selectedId="main-lead"
          sections={[
            {
              id: 'main',
              state: 'awaiting_user_approval',
              proposedWinnerWorkerId: 'main-v1',
              selectedWinnerWorkerId: null,
              selectionStatus: 'waiting_for_user',
              awaitingUserApproval: true,
              workers: [
                {
                  id: 'main-v1',
                  state: 'done',
                  branch: 'feat/main-v1',
                  isProposed: true,
                  isSelected: false,
                  canBeSelected: false,
                  isStopping: false,
                  contextAvailable: false,
                  previewArtifacts: [],
                },
                {
                  id: 'main-v2',
                  state: 'done',
                  branch: 'feat/main-v2',
                  isProposed: false,
                  isSelected: false,
                  canBeSelected: true,
                  isStopping: false,
                  contextAvailable: false,
                  previewArtifacts: [],
                },
              ],
            },
          ]}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /choose this winner/i }))

    expect(
      await screen.findByText('Unable to reach the ORC API. Start or resume ORC and try again.'),
    ).toBeInTheDocument()
  })
})
