'use client'
import { ReactNode } from 'react'

type StatusType =
  | 'idle'
  | 'planning'
  | 'running'
  | 'reviewing'
  | 'awaiting_user_approval'
  | 'merging'
  | 'merging_lane'
  | 'merging_lanes'
  | 'done'
  | 'review_ready'
  | 'failed'
  | 'queued'
  | 'spawning'
  | 'stalled'
  | 'zombie'

interface StatusConfig {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon: ReactNode
  animated?: boolean
}

const statusConfig: Record<StatusType, StatusConfig> = {
  idle: {
    label: 'Idle',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/20',
    icon: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3" />
      </svg>
    ),
  },
  planning: {
    label: 'Planning',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    animated: true,
  },
  running: {
    label: 'Running',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    icon: (
      <svg
        className="w-3 h-3 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    ),
    animated: true,
  },
  reviewing: {
    label: 'Reviewing',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    ),
    animated: true,
  },
  awaiting_user_approval: {
    label: 'Awaiting Approval',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    animated: true,
  },
  merging: {
    label: 'Merging',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    ),
    animated: true,
  },
  merging_lane: {
    label: 'Merging Lane',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    ),
    animated: true,
  },
  merging_lanes: {
    label: 'Merging Lanes',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    ),
    animated: true,
  },
  done: {
    label: 'Complete',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 13l4 4L19 7"
        />
      </svg>
    ),
  },
  review_ready: {
    label: 'Ready for Review',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    ),
  },
  queued: {
    label: 'Queued',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  spawning: {
    label: 'Starting',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
    animated: true,
  },
  stalled: {
    label: 'Stalled',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
  },
  zombie: {
    label: 'Zombie',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    icon: (
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
}

interface StatusBadgeProps {
  status: StatusType
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export function StatusBadge({
  status,
  size = 'md',
  showLabel = true,
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.idle

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-sm gap-1.5',
    lg: 'px-3 py-1.5 text-base gap-2',
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${config.color} ${config.bgColor} ${config.borderColor} ${sizeClasses[size]} ${config.animated ? 'animate-pulse-subtle' : ''}`}
    >
      <span className="flex-shrink-0">{config.icon}</span>
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}
