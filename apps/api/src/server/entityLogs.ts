import * as fs from 'node:fs/promises'
import type { Response } from 'express'
import type { LogEntry, LogsResponse } from '@orc/types'
import type { Db } from '../db/client'
import { getEventsSince } from '../db/journal'
import { getSQLite } from '../db/client'

function trimBody(value: string): string {
  return value.replace(/\n$/, '')
}

function normalizeWorkerLine(entityId: string, rawLine: string, lineNumber: number): LogEntry | null {
  if (!rawLine.trim()) return null

  const parsed = JSON.parse(rawLine) as { ts?: number; output?: string; error?: string }

  if (typeof parsed.error === 'string') {
    return {
      id: `${entityId}:line:${lineNumber}`,
      ts: parsed.ts ?? 0,
      kind: 'stderr',
      title: 'stderr',
      body: trimBody(parsed.error),
      raw: rawLine,
    }
  }

  const output = typeof parsed.output === 'string' ? parsed.output : ''
  if (output.trim().startsWith('{')) {
    return {
      id: `${entityId}:line:${lineNumber}`,
      ts: parsed.ts ?? 0,
      kind: 'codex_event',
      title: 'codex_event',
      body: output.trim(),
      raw: rawLine,
    }
  }

  return {
    id: `${entityId}:line:${lineNumber}`,
    ts: parsed.ts ?? 0,
    kind: 'stdout',
    title: 'stdout',
    body: trimBody(output),
    raw: rawLine,
  }
}

export async function readWorkerLogWindow(entityId: string, logPath: string, limit: number): Promise<LogsResponse> {
  let content = ''

  try {
    content = await fs.readFile(logPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { entries: [], tailCursor: null }
    }
    throw error
  }

  const lines = content.split('\n').filter(Boolean)
  const startIndex = Math.max(0, lines.length - limit)
  const entries = lines
    .slice(startIndex)
    .map((line, offset) => normalizeWorkerLine(entityId, line, startIndex + offset + 1))
    .filter((entry): entry is LogEntry => Boolean(entry))

  return {
    entries,
    tailCursor: lines.length > 0 ? `line:${lines.length}` : null,
  }
}

export function readLeadLogWindow(db: Db, entityId: string, limit: number): LogsResponse {
  const rows = getSQLite(db)
    .prepare(`
      SELECT id, event_type AS eventType, payload, ts
      FROM event_log
      WHERE entity_id=? AND entity_type='lead'
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(entityId, limit) as Array<{ id: number; eventType: string; payload: string; ts: number }>

  const entries = rows
    .reverse()
    .map(row => ({
      id: `${entityId}:event:${row.id}`,
      ts: row.ts,
      kind: 'lead_event' as const,
      title: row.eventType,
      body: row.payload,
      raw: row.payload,
    }))

  return {
    entries,
    tailCursor: rows[0]?.id ? `event:${rows[0].id}` : null,
  }
}

export function streamWorkerLogs(res: Response, entityId: string, logPath: string, afterLine: number): () => void {
  let lastLine = afterLine

  const timer = setInterval(async () => {
    let content = ''
    try {
      content = await fs.readFile(logPath, 'utf8')
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      return
    }

    const lines = content.split('\n').filter(Boolean)
    if (lines.length <= lastLine) return

    const additions = lines.slice(lastLine)
    additions.forEach((line, index) => {
      const entry = normalizeWorkerLine(entityId, line, lastLine + index + 1)
      if (entry) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`)
      }
    })
    lastLine = lines.length
  }, 500)

  return () => clearInterval(timer)
}

export function streamLeadLogs(db: Db, res: Response, entityId: string, afterEventId: number): () => void {
  let lastEventId = afterEventId

  const timer = setInterval(() => {
    const rows = getEventsSince(db, lastEventId)
    if (rows.length === 0) return

    lastEventId = rows.at(-1)?.id ?? lastEventId
    rows
      .filter(row => row.entityId === entityId && row.entityType === 'lead')
      .forEach(row => {
        const payload = row.payload
        res.write(`data: ${JSON.stringify({
          id: `${entityId}:event:${row.id}`,
          ts: row.ts,
          kind: 'lead_event',
          title: row.eventType,
          body: payload,
          raw: payload,
        })}\n\n`)
      })
  }, 500)

  return () => clearInterval(timer)
}
