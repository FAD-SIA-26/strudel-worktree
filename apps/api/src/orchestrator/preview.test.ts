import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { generateRunPreviewUrl, generateStrudelPreviewUrl, launchPreview, launchRunPreview } from './preview'
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

  it('composes a contextual preview from all other sections approved winners without task_edges', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)

    // bass-lead: winner approved, worktree has real source
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    const bassWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-bass-'))
    await fs.mkdir(path.join(bassWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(bassWt, 'src/bass.js'), 'export const bass = note("c2 e2").s("sawtooth")\n')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', bassWt, 'feat/r1-bass-v1', 'main')
    sqlite.prepare(`
      INSERT INTO merge_candidates(id, lead_id, proposed_winner_worker_id, selected_winner_worker_id, target_branch, reviewer_reasoning, selection_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('bass-lead', 'bass-lead', 'r1-bass-v1', 'r1-bass-v1', 'lane/r1/bass', 'auto', 'proposal_accept')

    // chords-lead: worker we're previewing — NO task_edges dependency on bass
    upsertTask(db, 'chords-lead', 'lead', 'mastermind', 'awaiting_user_approval')
    upsertTask(db, 'r1-chords-v1', 'worker', 'chords-lead', 'done')
    const chordsWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-chords-'))
    await fs.mkdir(path.join(chordsWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(chordsWt, 'src/chords.js'), 'export const chords = chord("Am").s("piano")\n')
    upsertWorktree(db, 'r1-chords-v1', 'r1-chords-v1', chordsWt, 'feat/r1-chords-v1', 'main')
    // No task_edges row — zero depends_on

    const result = await launchPreview(db, 'r1-chords-v1', chordsWt, 'contextual')

    expect(result.previewUrl).toContain('https://strudel.cc/#')
    const decoded = Buffer.from(result.previewUrl.split('#')[1] ?? '', 'base64').toString('utf8')
    expect(decoded).toContain('const bass =')
    expect(decoded).toContain('const chords =')
    expect(decoded).toContain('stack(')
    expect(result.contextWinnerIds).toContain('r1-bass-v1')
  })
})

describe('launchRunPreview', () => {
  it('composes full track from all approved winners into a single self-contained Strudel snippet', async () => {
    const db = createTestDb()
    const sqlite = getSQLite(db)
    const runId = 'r1'

    // drums winner
    const drumsWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-drums-'))
    await fs.mkdir(path.join(drumsWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(drumsWt, 'src/drums.js'), 'export const drums = s("bd hh sd hh")\n')
    upsertTask(db, 'drums-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-drums-v1', 'worker', 'drums-lead', 'done')
    upsertWorktree(db, 'r1-drums-v1', 'r1-drums-v1', drumsWt, 'feat/r1-drums-v1', 'main')
    sqlite.prepare(`INSERT INTO merge_candidates(id,lead_id,proposed_winner_worker_id,selected_winner_worker_id,target_branch,reviewer_reasoning,selection_source) VALUES(?,?,?,?,?,?,?)`
    ).run('drums-lead','drums-lead','r1-drums-v1','r1-drums-v1','lane/r1/drums','auto','proposal_accept')

    // bass winner
    const bassWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-bass-'))
    await fs.mkdir(path.join(bassWt, 'src'), { recursive: true })
    await fs.writeFile(path.join(bassWt, 'src/bass.js'), 'export const bass = note("c2 d2").s("sawtooth")\n')
    upsertTask(db, 'bass-lead', 'lead', 'mastermind', 'done')
    upsertTask(db, 'r1-bass-v1', 'worker', 'bass-lead', 'done')
    upsertWorktree(db, 'r1-bass-v1', 'r1-bass-v1', bassWt, 'feat/r1-bass-v1', 'main')
    sqlite.prepare(`INSERT INTO merge_candidates(id,lead_id,proposed_winner_worker_id,selected_winner_worker_id,target_branch,reviewer_reasoning,selection_source) VALUES(?,?,?,?,?,?,?)`
    ).run('bass-lead','bass-lead','r1-bass-v1','r1-bass-v1','lane/r1/bass','auto','proposal_accept')

    // run worktree (needed by routes but not by launchRunPreview itself)
    const runWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-run-'))

    const result = await launchRunPreview(db, runId, runWt)

    expect(result.previewUrl).toContain('https://strudel.cc/#')
    const decoded = Buffer.from(result.previewUrl.split('#')[1] ?? '', 'base64').toString('utf8')
    expect(decoded).toContain('const drums =')
    expect(decoded).toContain('const bass =')
    expect(decoded).toContain('stack(')
    expect(decoded).not.toContain('import ')
    expect(decoded).not.toContain('export const')
  })

  it('throws when no approved winners exist', async () => {
    const db = createTestDb()
    const runWt = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-run-'))
    await expect(launchRunPreview(db, 'r1', runWt)).rejects.toThrow(
      'final preview unavailable: no approved winners with source files'
    )
  })
})
