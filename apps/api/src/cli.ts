#!/usr/bin/env node
import { Command } from 'commander'
import * as http from 'node:http'
import * as path from 'node:path'
import * as url from 'node:url'
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

// Resolve repo root from cli.ts location (apps/api/src/cli.ts → ../../..)
const __filename = url.fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const REPO_ROOT  = path.resolve(__dirname, '../../..')

const DB_PATH = process.env.ORC_DB_PATH ?? path.join(REPO_ROOT, 'orc.db')
const PORT    = parseInt(process.env.ORC_PORT ?? '4000')

const program = new Command().name('orc').version('0.1.0')

program
  .command('run <goal>')
  .option('-m, --max-workers <n>', 'max concurrent workers', '4')
  .option('--mock', 'use MockAgent (deterministic, no real Codex)')
  .option('--run-id <id>', 'custom run ID', `run-${Date.now()}`)
  .action(async (goal: string, opts) => {
    const db     = initDb(DB_PATH)
    const gov    = new ConcurrencyGovernor(parseInt(opts.maxWorkers))
    const leadQs = new Map<string, CommandQueue<any>>()
    const app    = createApp({ db, leadQueues: leadQs })
    const server = http.createServer(app)
    attachWebSocket(server)
    server.listen(PORT, () => console.log(`[orc] dashboard → http://localhost:${PORT}  |  open apps/web`))

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
    server.close(() => process.exit(result.status === 'done' ? 0 : 1))
  })

program
  .command('status')
  .action(() => {
    const db = initDb(DB_PATH)
    console.table(getAllTasks(db))
  })

program
  .command('resume')
  .description('[DEGRADED] Restart and show persisted state. Worktree reconciliation is [POST-DEMO].')
  .action(async () => {
    const db     = initDb(DB_PATH)
    const leadQs = new Map<string, CommandQueue<any>>()
    const app    = createApp({ db, leadQueues: leadQs })
    const server = http.createServer(app)
    attachWebSocket(server)
    server.listen(PORT, () => {
      console.log(`[orc] resumed dashboard at http://localhost:${PORT}`)
    })
    const inFlight = getAllTasks(db).filter(t => ['running','queued','stalled','zombie'].includes(t.state))
    if (inFlight.length) { console.log('[orc] in-flight tasks:'); console.table(inFlight) }
    else console.log('[orc] no in-flight tasks found')
  })

program.parse()
