import * as net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { findAvailablePort } from './ports'

const servers: net.Server[] = []

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  servers.length = 0
})

async function listenEphemeralServer(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('failed to get ephemeral port')
  }
  return { server, port: address.port }
}

describe('findAvailablePort', () => {
  it('returns the preferred port when it is free', async () => {
    const { port } = await listenEphemeralServer()
    const candidate = await findAvailablePort(port + 1)
    expect(candidate).toBe(port + 1)
  })

  it('falls forward when the preferred port is already in use', async () => {
    const { port } = await listenEphemeralServer()
    const candidate = await findAvailablePort(port)
    expect(candidate).not.toBe(port)
    expect(candidate).toBeGreaterThan(port)
  })
})
