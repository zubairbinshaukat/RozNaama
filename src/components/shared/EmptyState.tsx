import type { ReactNode } from 'react'
import { Plus, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { btnOutline, btnPrimary } from '@/lib/ui'
import { useDashboardActions } from '@/context/dashboardActions'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  message: string
  /** Shown instead of `message` when an admin is viewing someone else. */
  readOnlyMessage?: string
  /** Offer "Record a sale" / "Add expense" buttons when the dashboard provides them. */
  showActions?: boolean
  /** Custom call to action (e.g. admin pages), shown instead of the dashboard buttons. */
  action?: ReactNode
  className?: string
}

/** Friendly empty state that says exactly what to tap next. */
export default function EmptyState({
  icon,
  title,
  message,
  readOnlyMessage = 'Nothing has been recorded here yet.',
  showActions = true,
  action,
  className,
}: EmptyStateProps) {
  const actions = useDashboardActions()
  const readOnly = useIsViewingOtherSafe()
  const canAct = showActions && actions !== null && !readOnly

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center gap-4 py-12 px-6 rounded-3xl border border-dashed border-border bg-card/60',
        className,
      )}
    >
      <div className="w-20 h-20 rounded-3xl bg-primary/10 text-primary flex items-center justify-center" aria-hidden>
        {icon}
      </div>
      <div className="space-y-1.5 max-w-xs">
        <p className="text-lg font-bold text-foreground tracking-tight">{title}</p>
        <p className="text-[15px] text-muted-foreground leading-relaxed">{readOnly ? readOnlyMessage : message}</p>
      </div>
      {action}
      {!action && canAct && (
        <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-xs sm:max-w-sm">
          <button type="button" onClick={actions.openAddSale} className={cn(btnPrimary, 'flex-1')}>
            <Plus size={18} /> Record a sale
          </button>
          <button type="button" onClick={actions.openAddExpense} className={cn(btnOutline, 'flex-1')}>
            <Receipt size={18} /> Add expense
          </button>
        </div>
      )}
    </div>
  )
}
