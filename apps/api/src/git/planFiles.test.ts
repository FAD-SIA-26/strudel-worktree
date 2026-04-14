import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { initTestRepo, cleanupTestRepo } from '../test-helpers/initTestRepo'
import { createRunPlan, createLeadPlan, createWorkerPlan } from './planFiles'

let repoDir: string
afterAll(() => cleanupTestRepo(repoDir))

describe('planFiles', () => {
  it('creates run plan with goal', async () => {
    repoDir = initTestRepo('plan-test')
    await fs.mkdir(path.join(repoDir, '.orc', 'runs', 'r1', 'leads'), { recursive: true })
    const p = await createRunPlan(repoDir, 'r1', { userGoal: 'Build lo-fi track', sections: ['rhythm'] })
    const content = await fs.readFile(p, 'utf-8')
    expect(content).toContain('Build lo-fi track')
  })

  it('creates worker plan inside worktree .orc/', async () => {
    repoDir = repoDir ?? initTestRepo('plan-test2')
    const wtPath = path.join(repoDir, '..', 'rhythm-v1')
    await fs.mkdir(path.join(wtPath, '.orc'), { recursive: true })
    const p = await createWorkerPlan(wtPath, { workerId: 'rhythm-v1', objective: 'Write bass', strategy: 'minimal' })
    const content = await fs.readFile(p, 'utf-8')
    expect(content).toContain('Write bass')
    expect(p).toContain('.orc/worker-plan.md')
  })
})
