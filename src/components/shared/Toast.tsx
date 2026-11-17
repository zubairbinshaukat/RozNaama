import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TOAST_DURATION } from '@/lib/constants'

export type ToastType = 'success' | 'error' | 'info'

export type ToastAction = {
  label:    string
  onAction: () => void
}

export type ToastOptions = {
  /** One inline button, e.g. "Undo". Tapping it runs the action and dismisses. */
  action?: ToastAction
}

export type ToastItem = {
  id:      string
  type:    ToastType
  message: string
  action?: ToastAction
}

type ToastContextValue = {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void
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
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-center gap-3 w-full sm:w-96 rounded-2xl pl-3 pr-1.5 py-1.5 min-h-14',
        'bg-popover text-popover-foreground border border-border/70 shadow-sheet',
        'text-[15px] font-semibold',
        exiting ? 'animate-toast-out' : 'animate-toast-in',
      )}
    >
      <span
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
          variant === 'success' && 'bg-success/15 text-success',
          variant === 'error' && 'bg-negative/15 text-negative',
          variant === 'info' && 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        {variant === 'success' && <CheckCircle2 size={18} />}
        {variant === 'error' && <AlertCircle size={18} />}
        {variant === 'info' && <Info size={18} />}
      </span>
      <span className="flex-1 leading-snug py-1.5">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => { item.action?.onAction(); dismiss() }}
          className="shrink-0 min-h-11 px-3 rounded-full text-primary font-bold hover:bg-primary/10 transition-all active:scale-[0.97]"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all active:scale-[0.97]"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'success', options?: ToastOptions) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, type, message, ...(options?.action ? { action: options.action } : {}) }])
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Top-centre on phones (clear of thumbs and sheets), top-right on desktop */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-0 z-9998 flex flex-col items-center sm:items-end gap-2 px-3 sm:px-4"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
