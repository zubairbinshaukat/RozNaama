import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TOAST_DURATION } from '@/lib/constants'

export type ToastType = 'success' | 'error' | 'info'

export type ToastItem = {
  id:      string
  type:    ToastType
  message: string
}

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setExiting(true)
    timerRef.current = setTimeout(() => onDismiss(item.id), 220)
  }, [item.id, onDismiss])

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, TOAST_DURATION)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [dismiss])

  const variant = item.type

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] rounded-xl px-4 py-3 shadow-xl border backdrop-blur-sm',
        'text-sm font-medium text-card-foreground',
        exiting ? 'animate-toast-out' : 'animate-toast-in',
        variant === 'success' && 'bg-card border-primary/35',
        variant === 'error' && 'bg-card border-destructive/40',
        variant === 'info' && 'bg-card border-border',
      )}
    >
      {variant === 'success' && (
        <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-primary" />
      )}
      {variant === 'error' && (
        <AlertCircle size={18} className="shrink-0 mt-0.5 text-destructive" />
      )}
      {variant === 'info' && (
        <Info size={18} className="shrink-0 mt-0.5 text-muted-foreground" />
      )}
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="shrink-0 text-muted-foreground opacity-80 hover:opacity-100 transition-opacity active:scale-95"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, type, message }])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Top-right toast portal */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed top-4 right-4 z-[9998] flex flex-col gap-2 items-end"
      >
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
