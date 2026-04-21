'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, duration = 5000) => {
      const id = Math.random().toString(36).substring(7)
      const toast: Toast = { id, type, message, duration }

      setToasts((prev) => [...prev, toast])

      if (duration > 0) {
        setTimeout(() => removeToast(id), duration)
      }
    },
    [removeToast]
  )

  const success = useCallback(
    (message: string, duration?: number) => addToast('success', message, duration),
    [addToast]
  )

  const error = useCallback(
    (message: string, duration?: number) => addToast('error', message, duration),
    [addToast]
  )

  const info = useCallback(
    (message: string, duration?: number) => addToast('info', message, duration),
    [addToast]
  )

  const warning = useCallback(
    (message: string, duration?: number) => addToast('warning', message, duration),
    [addToast]
  )

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, info, warning }}
    >
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

function ToastContainer() {
  const { toasts, removeToast } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-[1700] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

const toastConfig = {
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    text: 'text-emerald-300',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/25',
    text: 'text-red-300',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/25',
    text: 'text-blue-300',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    text: 'text-amber-300',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
  },
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const config = toastConfig[toast.type]

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in min-w-[320px] max-w-[480px] ${config.bg} ${config.border}`}
    >
      <span className={`flex-shrink-0 mt-0.5 ${config.text}`}>{config.icon}</span>
      <p className={`flex-1 text-sm font-medium ${config.text}`}>{toast.message}</p>
      <button
        onClick={onClose}
        className={`flex-shrink-0 rounded hover:bg-white/10 p-1 transition-colors ${config.text}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  )
}
