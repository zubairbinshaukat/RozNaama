import { useEffect } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ConfirmModalProps {
  title:        string
  message:      string
  confirmLabel?: string
  destructive?:  boolean
  loading?:      boolean
  onConfirm:    () => void
  onClose:      () => void
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive  = false,
  loading      = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    if (loading) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, loading])

  return (
    <div
      className="fixed inset-0 z-600 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="absolute inset-0 bg-black/60 animate-modal-backdrop"
        onClick={() => { if (!loading) onClose() }}
        aria-hidden
      />

      <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl animate-modal-content">
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${destructive ? 'bg-destructive/10' : 'bg-primary/10'}`}>
            <AlertTriangle size={18} className={destructive ? 'text-destructive' : 'text-primary'} />
          </div>
          <div className="flex-1 pt-0.5">
            <h2 id="confirm-title" className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">{message}</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-all active:scale-95"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="flex-1 active:scale-[0.97]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 gap-2 active:scale-[0.97] text-white border-0 ${
              destructive
                ? 'bg-destructive hover:bg-destructive/90'
                : 'bg-gradient-brand hover:opacity-90'
            }`}
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /> Deleting…</>
              : confirmLabel
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
