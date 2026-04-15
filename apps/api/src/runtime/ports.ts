import * as net from 'node:net'

function canListenOnPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

export async function findAvailablePort(preferredPort: number, maxAttempts = 20): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset
    if (await canListenOnPort(candidate)) {
      return candidate
    }
  }
  throw new Error(`no available port found starting from ${preferredPort}`)
}
