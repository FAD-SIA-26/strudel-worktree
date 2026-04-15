import { getSQLite, type Db } from './client'

export function getAllTasks(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      id,
      type,
      parent_id AS parentId,
      state
    FROM tasks
    ORDER BY type, id
  `).all() as Array<{ id: string; type: string; parentId: string | null; state: string }>
}
export function getWorktrees(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      id,
      worker_id AS workerId,
      path,
      branch,
      base_branch AS baseBranch
    FROM worktrees
    ORDER BY rowid DESC
  `).all() as Array<{ id: string; workerId: string; path: string; branch: string; baseBranch: string }>
}
export function getPreviews(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      worker_id AS workerId,
      mode,
      preview_url AS previewUrl,
      generated_code AS generatedCode,
      source_files AS sourceFiles,
      context_winner_ids AS contextWinnerIds,
      generated_at AS generatedAt
    FROM previews
  `).all() as Array<{
    workerId: string
    mode: 'solo' | 'contextual'
    previewUrl: string
    generatedCode: string
    sourceFiles: string
    contextWinnerIds: string
    generatedAt: number
  }>
}

export function getMergeCandidates(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      lead_id AS leadId,
      proposed_winner_worker_id AS proposedWinnerWorkerId,
      selected_winner_worker_id AS selectedWinnerWorkerId,
      selection_source AS selectionSource
    FROM merge_candidates
  `).all() as Array<{
    leadId: string
    proposedWinnerWorkerId: string | null
    selectedWinnerWorkerId: string | null
    selectionSource: 'proposal_accept' | 'user_override'
  }>
}

export function getTaskEdges(db: Db) {
  return getSQLite(db).prepare(`
    SELECT
      parent_id AS parentId,
      child_id AS childId,
      edge_type AS edgeType
    FROM task_edges
  `).all() as Array<{
    parentId: string
    childId: string
    edgeType: string
  }>
}
export function upsertTask(db: Db, id: string, type: string, parentId: string|null, state: string): void {
  const now = Date.now()
  getSQLite(db).prepare(`INSERT INTO tasks (id,type,parent_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`).run(id, type, parentId, state, now, now)
}
export function upsertWorktree(db: Db, id: string, workerId: string, wtPath: string, branch: string, baseBranch: string): void {
  getSQLite(db).prepare(`INSERT INTO worktrees(id,worker_id,path,branch,base_branch) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET branch=excluded.branch`).run(id, workerId, wtPath, branch, baseBranch)
}
export function upsertArtifact(db: Db, entityId: string, artifactType: string, filePath: string): void {
  getSQLite(db).prepare(`INSERT INTO artifacts(entity_id,artifact_type,path,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(entity_id,artifact_type) DO UPDATE SET path=excluded.path, updated_at=excluded.updated_at`).run(entityId, artifactType, filePath, Date.now())
}
