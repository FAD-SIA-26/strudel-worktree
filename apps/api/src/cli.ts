#!/usr/bin/env node
import { Command } from 'commander'
import * as http from 'node:http'
import * as path from 'node:path'
import * as url from 'node:url'
import * as fs from 'node:fs/promises'
import { initDb } from './db/client'
import { createApp } from './server/app'
import { attachWebSocket } from './server/wsHandler'
import { MastermindStateMachine } from './orchestrator/mastermind'
import { ConcurrencyGovernor } from './orchestrator/concurrency'
import { CodexCLIAdapter } from './agents/codex-cli'
import { MockAgent } from './agents/mock'
import { Watchdog } from './orchestrator/watchdog'
import { createLLMClientFromEnv } from './orchestrator/llm'
import { CommandQueue } from './events/commandQueues'
import { getAllTasks } from './db/queries'
import { seedSeqsFromDb } from './db/journal'
import { findRepoRootSync, hasCommittedHeadSync } from './git/worktree'
import { ensureDashboardServer } from './runtime/dashboard'
import { getOrcAppRoots, getOrcPaths } from './runtime/paths'

function resolveRepoRoot(): string {
  if (process.env.ORC_REPO_ROOT) return process.env.ORC_REPO_ROOT
  try {
    return findRepoRootSync(process.cwd())
  } catch {
    const __filename = url.fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    return path.resolve(__dirname, '../../..')
  }
}

const REPO_ROOT = resolveRepoRoot()
const { webRoot: WEB_ROOT } = getOrcAppRoots(import.meta.url)
const ORC_PATHS = getOrcPaths(REPO_ROOT)
const DB_PATH = process.env.ORC_DB_PATH ?? ORC_PATHS.dbPath
const PORT    = parseInt(process.env.ORC_PORT ?? '4000')
const DASHBOARD_PORT = parseInt(process.env.ORC_DASHBOARD_PORT ?? '3000')

function registerCleanup(cleanup: () => void): () => void {
  const handler = () => {
    cleanup()
    process.exit(0)
  }
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
  return () => {
    process.off('SIGINT', handler)
    process.off('SIGTERM', handler)
  }
}

const program = new Command().name('orc').version('0.1.0')

program
  .command('run <goal>')
  .option('-m, --max-workers <n>', 'max concurrent workers', '4')
  .option('--mock', 'use MockAgent (deterministic, no real Codex)')
  .option('--run-id <id>', 'custom run ID', `run-${Date.now()}`)
  .action(async (goal: string, opts) => {
    // orc requires a git repo — branches and worktrees are how it isolates parallel work
    try {
      const { execSync } = await import('node:child_process')
      execSync('git rev-parse --git-dir', { cwd: REPO_ROOT, stdio: 'pipe' })
    } catch {
      console.error('[orc] error: not a git repository.')
      console.error('[orc] orc must be run from inside a git repo.')
      console.error('[orc] Run `git init && git commit -m "init"` first, or cd into an existing repo.')
      process.exit(1)
    }

    if (!hasCommittedHeadSync(REPO_ROOT)) {
      console.error('[orc] error: repository has no commits yet.')
      console.error('[orc] orc needs an initial commit before it can create run branches and worktrees.')
      console.error('[orc] Run `git add . && git commit -m "init"` in the target repo, then try again.')
      process.exit(1)
    }

    await fs.mkdir(ORC_PATHS.stateDir, { recursive: true })

    const db     = initDb(DB_PATH)
    seedSeqsFromDb(db)   // prevent UNIQUE violations if DB already has sequences from a prior run
    const gov    = new ConcurrencyGovernor(parseInt(opts.maxWorkers))
    const leadQs = new Map<string, CommandQueue<any>>()
    const dashboard = await ensureDashboardServer({
      apiPort: PORT,
      dashboardPort: DASHBOARD_PORT,
      stateDir: ORC_PATHS.stateDir,
      webRoot: WEB_ROOT,
    })
    const app    = createApp({ db, leadQueues: leadQs, dashboardUrl: dashboard.url })
    const server = http.createServer(app)
    attachWebSocket(server)
    await new Promise<void>(resolve => server.listen(PORT, resolve))
    const unregisterCleanup = registerCleanup(() => {
      dashboard.stop()
      server.close()
    })

    console.log(`[orc] dashboard → ${dashboard.url}  |  api → http://localhost:${PORT}`)

    const watchdog = new Watchdog({ db, intervalMs: 5000, stalledThresholdMs: 60_000 })
    watchdog.start()

    const m = new MastermindStateMachine({
      repoRoot:            REPO_ROOT,
      db, governor:        gov,
      runId:               opts.runId,
      agentFactory:        opts.mock ? () => new MockAgent({ delayMs: 200, outcome: 'done' }) : () => new CodexCLIAdapter(),
      // In --mock mode, use a stub LLM that returns a sensible Strudel decomposition
      // so the demo works without an API key
      llmCall:             opts.mock
        ? async (p: string) => {
            if (p.includes('Decompose') || p.includes('decompose')) {
              return JSON.stringify([
                { id: 'drums',       goal: 'Write drum pattern in Strudel.js',      numWorkers: 2, dependsOn: [] },
                { id: 'bass',        goal: 'Write bass line in Strudel.js',          numWorkers: 2, dependsOn: [] },
                { id: 'chords',      goal: 'Write chord pattern in Strudel.js',      numWorkers: 2, dependsOn: ['bass'] },
                { id: 'melody',      goal: 'Write lead melody in Strudel.js',        numWorkers: 3, dependsOn: ['chords'] },
                { id: 'arrangement', goal: 'Write final Strudel.js arrangement',     numWorkers: 1, dependsOn: ['drums','bass','chords','melody'] },
              ])
            }
            if (p.includes('Generate') || p.includes('prompts')) {
              return JSON.stringify(['Write a minimal lo-fi pattern', 'Write a rhythmic groove pattern'])
            }
            // reviewer — pick v1
            const match = p.match(/([\w-]+-v1)/)
            return JSON.stringify({ winnerId: match?.[1] ?? 'drums-v1', reasoning: 'mock reviewer selected v1' })
          }
        : createLLMClientFromEnv(),
      leadQueues:          leadQs,
      maxConcurrentWorkers: parseInt(opts.maxWorkers),
    })

    console.log(`[orc] run "${goal}" (run-id: ${opts.runId})`)
    const result = await m.run({ userGoal: goal })
    watchdog.stop()
    console.log(`[orc] orchestration ${result.status}`)
    unregisterCleanup()
    dashboard.stop()
    server.close(() => process.exit(result.status === 'done' ? 0 : 1))
  })

program
  .command('status')
  .action(() => {
    const db = initDb(DB_PATH)
    seedSeqsFromDb(db)
    console.table(getAllTasks(db))
  })

program
  .command('resume')
  .description('[DEGRADED] Restart and show persisted state. Worktree reconciliation is [POST-DEMO].')
  .action(async () => {
    await fs.mkdir(ORC_PATHS.stateDir, { recursive: true })
    const db     = initDb(DB_PATH)
    seedSeqsFromDb(db)
    const leadQs = new Map<string, CommandQueue<any>>()
    const dashboard = await ensureDashboardServer({
      apiPort: PORT,
      dashboardPort: DASHBOARD_PORT,
      stateDir: ORC_PATHS.stateDir,
      webRoot: WEB_ROOT,
    })
    const app    = createApp({ db, leadQueues: leadQs, dashboardUrl: dashboard.url })
    const server = http.createServer(app)
    attachWebSocket(server)
    await new Promise<void>(resolve => server.listen(PORT, resolve))
    registerCleanup(() => {
      dashboard.stop()
      server.close()
    })
    console.log(`[orc] resumed dashboard at ${dashboard.url}`)
    const inFlight = getAllTasks(db).filter(t => ['running','queued','stalled','zombie'].includes(t.state))
    if (inFlight.length) { console.log('[orc] in-flight tasks:'); console.table(inFlight) }
    else console.log('[orc] no in-flight tasks found')
  })

program.parse()
