import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

function applyMigration(sqlite: Database.Database, filename: string) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

describe('0002_user_gated_winner_selection', () => {
  let sqlite: Database.Database

  afterEach(() => {
    sqlite?.close()
  })

  it('normalizes legacy selection sources while preserving the winner on both columns', () => {
    sqlite = new Database(':memory:')
    applyMigration(sqlite, '0000_tan_quasimodo.sql')
    applyMigration(sqlite, '0001_strudel_preview_compare.sql')

    const insertMergeCandidate = sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    insertMergeCandidate.run(
      'mc-1',
      'melody-lead',
      'melody-v1',
      'lane/r1/melody',
      'best hook',
      'reviewer',
    )
    insertMergeCandidate.run(
      'mc-2',
      'bass-lead',
      'bass-v2',
      'lane/r1/bass',
      'user picked it',
      'user',
    )

    applyMigration(sqlite, '0002_user_gated_winner_selection.sql')

    expect(sqlite.prepare(`
      SELECT
        id,
        proposed_winner_worker_id AS proposedWinnerWorkerId,
        selected_winner_worker_id AS selectedWinnerWorkerId,
        selection_source AS selectionSource
      FROM merge_candidates
      ORDER BY id
    `).all()).toEqual([
      {
        id: 'mc-1',
        proposedWinnerWorkerId: 'melody-v1',
        selectedWinnerWorkerId: 'melody-v1',
        selectionSource: 'proposal_accept',
      },
      {
        id: 'mc-2',
        proposedWinnerWorkerId: 'bass-v2',
        selectedWinnerWorkerId: 'bass-v2',
        selectionSource: 'user_override',
      },
    ])
  })
})
