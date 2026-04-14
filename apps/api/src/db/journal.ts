import { getSQLite, type Db } from './client'
import { eventBus } from '../events/eventBus'
import type { OrcEvent } from '@orc/types'

export function writeEvent(db: Db, event: OrcEvent, updateProjection: () => void): void {
  const sqlite = getSQLite(db)
  sqlite.transaction(() => {
    sqlite.prepare(
      'INSERT INTO event_log (entity_id, entity_type, event_type, sequence, payload, ts) VALUES (?,?,?,?,?,?)'
    ).run(event.entityId, event.entityType, event.eventType, event.sequence, JSON.stringify(event.payload), event.ts)
    updateProjection()
  })()
  eventBus.publish(event)   // outside transaction — publish-only, never for commands
}

export function getEventsSince(db: Db, afterId: number) {
  return getSQLite(db).prepare('SELECT * FROM event_log WHERE id > ? ORDER BY id ASC').all(afterId) as Array<{
    id: number; entityId: string; entityType: string; eventType: string; sequence: number; payload: string; ts: number
  }>
}

/** Monotonic sequence counter per entity — use this instead of Date.now() for sequence */
const _seqs = new Map<string, number>()
export function nextSeq(entityId: string): number {
  const n = (_seqs.get(entityId) ?? 0) + 1
  _seqs.set(entityId, n)
  return n
}
