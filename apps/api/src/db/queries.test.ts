import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, getSQLite } from './client'
import { getMergeCandidates } from './queries'

describe('getMergeCandidates', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('returns proposed and selected winner ids with selection source', () => {
    const sqlite = getSQLite(db)
    sqlite.prepare(`
      INSERT INTO merge_candidates(
        id,
        lead_id,
        proposed_winner_worker_id,
        selected_winner_worker_id,
        target_branch,
        reviewer_reasoning,
        selection_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'mc-1',
      'melody-lead',
      'melody-v1',
      'melody-v2',
      'lane/r1/melody',
      'best hook',
      'user_override',
    )

    expect(getMergeCandidates(db)).toEqual([
      {
        leadId: 'melody-lead',
        proposedWinnerWorkerId: 'melody-v1',
        selectedWinnerWorkerId: 'melody-v2',
        selectionSource: 'user_override',
      },
    ])
  })
})
