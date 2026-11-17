import { useId } from 'react'
import { Receipt, CalendarDays, Clock, StickyNote, Pencil, Trash2 } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { cn, formatDate, formatTime } from '@/lib/utils'
import Amount from '@/components/shared/Amount'
import { btnDangerGhost, btnOutline, btnSecondary } from '@/lib/ui'
import { DetailRow } from './SaleDetailModal'
import type { ExpenseEntry } from '@/hooks/useExpenses'
import OfflineEditNote from '@/components/shared/OfflineEditNote'

interface ExpenseDetailSheetProps {
  expense:   ExpenseEntry
  onClose:   () => void
  onEdit?:   () => void
  onDelete?: () => void
  /** Edits need internet: show a short note above Edit / Delete. */
  editOffline?: boolean
}

/** Tap an expense row → details plus Edit / Delete. */
export default function ExpenseDetailSheet({ expense, onClose, onEdit, onDelete, editOffline = false }: ExpenseDetailSheetProps) {
  const titleId = useId()
  const title = expense.note?.trim() || 'Expense'
  const canEdit = onEdit !== undefined || onDelete !== undefined

  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={520}>
      <SheetHeader
        titleId={titleId}
        title={<span className="wrap-break-word">{title}</span>}
        subtitle="Expense"
        icon={<Receipt size={18} />}
        iconClassName="bg-negative/10 text-negative"
        onClose={onClose}
      />
      <SheetBody className="flex flex-col gap-4">
        <div className="rounded-3xl bg-negative/8 px-5 py-4">
          <p className="text-sm font-semibold text-muted-foreground">Amount spent</p>
          <p className="text-[2rem] font-bold text-negative tabular tracking-tight leading-tight">
            <Amount value={expense.amount} />
          </p>
        </div>
        <dl className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70">
          <DetailRow icon={<CalendarDays size={18} />} label="Date">{formatDate(expense.expenseDate)}</DetailRow>
          <DetailRow icon={<Clock size={18} />} label="Recorded at">{formatTime(expense.createdAt)}</DetailRow>
          {expense.note?.trim() && (
            <DetailRow icon={<StickyNote size={18} />} label="Note">
              <span className="wrap-break-word">{expense.note}</span>
            </DetailRow>
          )}
        </dl>
      </SheetBody>
      <SheetFooter>
        {canEdit && editOffline && <OfflineEditNote className="mb-3" />}
        {canEdit ? (
          <div className="flex gap-3">
            {onDelete && (
              <button type="button" onClick={onDelete} className={cn(btnDangerGhost, 'flex-1')}>
                <Trash2 size={18} /> Delete
              </button>
            )}
            {onEdit && (
              <button type="button" onClick={onEdit} className={cn(btnOutline, 'flex-1')}>
                <Pencil size={18} /> Edit
              </button>
            )}
          </div>
        ) : (
          <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>
            Close
          </button>
        )}
      </SheetFooter>
    </Sheet>
  )
}
