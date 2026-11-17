import { useId } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { cn } from '@/lib/utils'
import { btnDanger, btnPrimary, btnSecondary } from '@/lib/ui'

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
  const titleId = useId()
  const messageId = useId()

  return (
    <Sheet
      onClose={onClose}
      dismissible={!loading}
      labelledBy={titleId}
      describedBy={messageId}
      role="alertdialog"
      layer={600}
      size="sm"
    >
      <SheetHeader
        titleId={titleId}
        title={title}
        icon={<AlertTriangle size={18} />}
        iconClassName={destructive ? 'bg-negative/10 text-negative' : undefined}
        onClose={onClose}
        closeDisabled={loading}
      />
      <SheetBody>
        <p id={messageId} className="text-base text-muted-foreground leading-relaxed">{message}</p>
        {destructive && (
          <p className="text-sm text-muted-foreground mt-2">This can&apos;t be undone.</p>
        )}
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={loading} className={cn(btnSecondary, 'flex-1')}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(destructive ? btnDanger : btnPrimary, 'flex-1')}
          >
            {loading
              ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Deleting…</>
              : confirmLabel}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
