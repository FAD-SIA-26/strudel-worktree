import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import * as os from 'node:os'
import * as path from 'node:path'

const { spawnMock, getWorktreeDiffMock, writeDoneMarkerMock, openMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getWorktreeDiffMock: vi.fn(),
  writeDoneMarkerMock: vi.fn(),
  openMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../git/worktree', () => ({
  getWorktreeDiff: getWorktreeDiffMock,
}))

vi.mock('../git/reconcile', () => ({
  writeDoneMarker: writeDoneMarkerMock,
}))

vi.mock('node:fs/promises', () => ({
  default: {},
  open: openMock,
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
}))

import { CodexCLIAdapter } from './codex-cli'

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  return proc
}

describe('CodexCLIAdapter', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    getWorktreeDiffMock.mockReset()
    writeDoneMarkerMock.mockReset()
    openMock.mockReset()
  })

  it('uses codex exec JSON mode and returns a successful result', async () => {
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)
    getWorktreeDiffMock.mockResolvedValue('+ diff')
    writeDoneMarkerMock.mockResolvedValue(undefined)

    const worktreePath = path.join(os.tmpdir(), `orc-codex-cli-${Date.now()}`)
    openMock.mockResolvedValue({ write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) })

    const runPromise = new CodexCLIAdapter().run(
      { id: 'w1', prompt: 'do the thing', maxRetries: 1, errorHistory: [] },
      {
        worktreePath,
        branch: 'feat/w1',
        baseBranch: 'main',
        entityId: 'w1',
        planPath: 'worker-plan.md',
        leadPlanPath: 'lead-plan.md',
        runPlanPath: 'run-plan.md',
      },
    )

    setImmediate(() => proc.emit('close', 0))

    const result = await runPromise

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', expect.stringContaining('do the thing')]),
      expect.objectContaining({ cwd: worktreePath, stdio: ['ignore', 'pipe', 'pipe'] }),
    )
    expect(result).toEqual({
      status: 'done',
      branch: 'feat/w1',
      diff: '+ diff',
      retryable: false,
    })
  })
})
