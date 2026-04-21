'use client'
import { ButtonHTMLAttributes, ReactNode } from 'react'

const variantStyles = {
  primary: 'bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500',
  secondary:
    'bg-[#1a1f26] text-[#e5e7eb] hover:bg-[#232930] border border-[#2d3339]',
  ghost: 'text-[#9ca3af] hover:bg-[#1a1f26] hover:text-[#e5e7eb]',
  danger: 'bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500',
}

const sizeStyles = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles
  size?: keyof typeof sizeStyles
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  className = '',
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
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
      )}
      {!loading && icon}
      {children}
    </button>
  )
}
