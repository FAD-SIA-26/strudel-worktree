'use client'

interface ProgressBarProps {
  value: number
  max: number
  label?: string
  showPercentage?: boolean
}

export function ProgressBar({ value, max, label, showPercentage = true }: ProgressBarProps) {
  const percentage = Math.round((value / max) * 100)

  return (
    <div className="w-full space-y-2">
      {(label || showPercentage) && (
        <div className="flex items-center justify-between text-sm">
          {label && <span className="text-[#e5e7eb] font-medium">{label}</span>}
          {showPercentage && (
            <span className="text-[#9ca3af] font-mono text-xs">{percentage}%</span>
          )}
        </div>
      )}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#1a1f26]">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        >
          <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
      </div>
    </div>
  )
}
