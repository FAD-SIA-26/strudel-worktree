import { describe, it, expect } from 'vitest'
import { ConcurrencyGovernor } from './concurrency'

describe('ConcurrencyGovernor', () => {
  it('allows up to max concurrent', async () => {
    const g = new ConcurrencyGovernor(2)
    await g.acquire(); await g.acquire()
    expect(g.activeCount).toBe(2)
  })

  it('queues when at cap, unblocks on release', async () => {
    const g = new ConcurrencyGovernor(1)
    await g.acquire()
    let done = false
    const p = g.acquire().then(() => { done = true })
    expect(done).toBe(false)
    g.release()
    await p
    expect(done).toBe(true)
    expect(g.activeCount).toBe(1)   // slot transferred to waiter, count unchanged
  })

  it('decrements active when no waiter', () => {
    const g = new ConcurrencyGovernor(2)
    g.acquire()  // fire and forget — sync path
    g.release()
    expect(g.activeCount).toBe(0)
  })
})
