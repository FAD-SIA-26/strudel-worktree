'use client'
import { useEffect, useState } from 'react'
import type { LogEntry, LogsResponse } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function useEntityLogs(entityId: string | null) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entityId) {
      setEntries([])
      setStatus('idle')
      setError(null)
      return
    }

    let closed = false
    let eventSource: EventSource | null = null

    setStatus('loading')
    setError(null)

    ;(async () => {
      const res = await fetch(`${API}/api/entities/${entityId}/logs`)
      if (!res.ok) {
        throw new Error(`failed to load logs for ${entityId}`)
      }

      const payload = await res.json() as LogsResponse
      if (closed) return

      setEntries(payload.entries)
      setStatus('ready')

      const suffix = payload.tailCursor ? `?after=${encodeURIComponent(payload.tailCursor)}` : ''
      eventSource = new EventSource(`${API}/api/entities/${entityId}/logs/stream${suffix}`)
      eventSource.onmessage = event => {
        const entry = JSON.parse(event.data) as LogEntry
        setEntries(prev => prev.some(existing => existing.id === entry.id) ? prev : [...prev, entry])
      }
    })().catch((err: any) => {
      if (closed) return
      setStatus('error')
      setError(err?.message ?? 'failed to load logs')
    })

    return () => {
      closed = true
      eventSource?.close()
    }
  }, [entityId])

  return { entries, status, error }
}
