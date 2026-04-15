import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { generateRunPreviewUrl, generateStrudelPreviewUrl, launchPreview } from './preview'
import { createTestDb, getSQLite } from '../db/client'
import { upsertTask, upsertWorktree } from '../db/queries'

describe('generateStrudelPreviewUrl', () => {
  it('uses the section id from namespaced worker ids', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-preview-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src', 'drums.js'), 'export const drums = sound("bd")\n')

    const previewUrl = await generateStrudelPreviewUrl(worktreePath, 'run-123-drums-v2')
    const decoded = Buffer.from(previewUrl.split('#')[1] ?? '', 'base64').toString('utf8')

    expect(previewUrl).toContain('https://strudel.cc/#')
    expect(decoded).toContain('const drums = sound("bd")')
    expect(decoded).toContain('stack(drums)')
    expect(decoded).not.toContain('export const')
    expect(decoded).not.toContain('import ')
  })

  it('falls back to src/index.js when it exists', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-preview-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src', 'index.js'), 'stack(sound("bd"))\n')

    const previewUrl = await generateStrudelPreviewUrl(worktreePath, 'run-123-arrangement-v1')

    expect(Buffer.from(previewUrl.split('#')[1] ?? '', 'base64').toString('utf8')).toContain('stack(sound("bd"))')
  })

  it('builds a final-song preview from the run worktree', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-final-preview-'))
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src/index.js'), 'stack(sound("bd"), sound("hh"))')

    const previewUrl = await generateRunPreviewUrl(worktreePath, 'run/r1')

    expect(previewUrl).toContain('https://strudel.cc/#')
    expect(Buffer.from(previewUrl.split('#')[1] ?? '', 'base64').toString('utf8')).toContain('stack(sound("bd"), sound("hh"))')
  })
})

describe('launchPreview contextual mode', () => {
  it('throws a descriptive error when upstream winner worktree is missing', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    // bass-lead done, winner selected, but NO worktree row for the winner
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')

    // chords worker whose worktree does exist
    const chordsWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-chords-'))
    await fs.mkdir(path.join(chordsWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(chordsWt, 'src/chords.js'), 'export const chords = chord("Am")\n')

    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', chordsWt, 'feat/r1-chords-v1', 'main')

    sqlite.prepare(`
      INSERT INTO task_edges(parent_id, child_id, edge_type) VALUES (?, ?, ?)
    `).run('bass-lead', 'chords-lead', 'depends_on')

    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, proposed_winner_worker_id, selected_winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bass-lead', 'bass-lead', 'r1-bass-v1', 'r1-bass-v1', 'lane/r1/bass', 'auto', 'proposal_accept')

    await expect(
      launchPreview(db, 'r1-chords-v1', chordsWt, 'contextual')
    ).rejects.toThrow('worktree not found for context worker r1-bass-v1')
  })
})
