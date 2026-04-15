import { describe, expect, it } from 'vitest'
import { waitForShutdownSignal } from './reviewReady'

describe('waitForShutdownSignal', () => {
  it('resolves only after SIGINT', async () => {
    const wait = waitForShutdownSignal(['SIGINT'])
    process.emit('SIGINT')
    await expect(wait).resolves.toBe('SIGINT')
  })
})
