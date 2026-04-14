import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'

interface DashboardOptions {
  apiPort: number
  dashboardPort: number
  stateDir: string
  webRoot: string
}

export interface DashboardHandle {
  process: ChildProcess | null
  url: string
  stop: () => void
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function waitForDashboard(url: string, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, res => {
        res.resume()
        if ((res.statusCode ?? 500) < 500) {
          resolve()
          return
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`dashboard did not become ready at ${url}`))
          return
        }
        setTimeout(check, 250)
      })

      req.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`dashboard did not become ready at ${url}`))
          return
        }
        setTimeout(check, 250)
      })
    }

    check()
  })
}

function waitForDashboardUrl(proc: ChildProcess, timeoutMs = 20_000): Promise<string> {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    let output = ''

    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/Local:\s+(https?:\/\/[^\s]+)/)
      if (match?.[1]) {
        cleanup()
        resolve(match[1])
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup()
        reject(new Error(`dashboard did not report a local URL\n${output}`))
      }
    }

    const onExit = () => {
      cleanup()
      reject(new Error(`dashboard process exited before it became ready\n${output}`))
    }

    const cleanup = () => {
      proc.stdout?.off('data', onData)
      proc.stderr?.off('data', onData)
      proc.off('exit', onExit)
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.once('exit', onExit)

    setTimeout(() => {
      cleanup()
      reject(new Error(`dashboard did not report a local URL\n${output}`))
    }, timeoutMs)
  })
}

export async function ensureDashboardServer(opts: DashboardOptions): Promise<DashboardHandle> {
  const preferredDashboardUrl = `http://localhost:${opts.dashboardPort}`

  if (await isPortOpen(opts.dashboardPort)) {
    return { process: null, url: preferredDashboardUrl, stop: () => {} }
  }

  fs.mkdirSync(opts.stateDir, { recursive: true })
  const logPath = path.join(opts.stateDir, 'dashboard.log')
  const logStream = fs.createWriteStream(logPath, { flags: 'a' })
  const nextBin = path.join(opts.webRoot, 'node_modules', 'next', 'dist', 'bin', 'next')

  const proc = spawn(
    process.execPath,
    [
      nextBin,
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(opts.dashboardPort),
    ],
    {
      cwd: opts.webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://localhost:${opts.apiPort}`,
        NEXT_PUBLIC_WS_URL: `ws://localhost:${opts.apiPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  proc.stdout?.on('data', chunk => {
    logStream.write(chunk)
  })
  proc.stderr?.on('data', chunk => {
    logStream.write(chunk)
  })

  const stop = () => {
    if (!proc.killed) proc.kill('SIGTERM')
    logStream.end()
  }

  try {
    const dashboardUrl = await waitForDashboardUrl(proc)
    await waitForDashboard(dashboardUrl)
    return {
      process: proc,
      url: dashboardUrl,
      stop,
    }
  } catch (error) {
    stop()
    throw error
  }
}
