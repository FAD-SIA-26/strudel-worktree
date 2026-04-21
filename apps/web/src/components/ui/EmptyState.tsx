'use client'
import { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  secondaryActions?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryActions,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      {icon && (
        <div className="mb-6 text-6xl opacity-50 animate-fade-in">{icon}</div>
      )}
      <h2 className="text-2xl font-semibold text-[#e5e7eb] mb-3">{title}</h2>
      {description && (
        <p className="text-[#9ca3af] max-w-md mb-8 leading-relaxed">{description}</p>
      )}
      {action && <div className="mb-4">{action}</div>}
      {secondaryActions && (
        <div className="flex items-center gap-4 text-sm">{secondaryActions}</div>
      )}
    </div>
  )
}
