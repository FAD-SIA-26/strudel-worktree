'use client'
import { useQuery } from '@tanstack/react-query'
import type { EntityDetail } from '@orc/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export function useEntityDetail(entityId: string | null) {
  return useQuery<EntityDetail>({
    queryKey: ['entity-detail', entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const res = await fetch(`${API}/api/entities/${entityId}/detail`)
      if (!res.ok) {
        throw new Error(`failed to load detail for ${entityId}`)
      }
      return res.json()
    },
  })
}
