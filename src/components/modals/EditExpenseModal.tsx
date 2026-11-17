import { useState, useRef, useId } from 'react'
import { Check, Loader2, AlertCircle, Pencil } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase } from '@/lib/ui'
import { checkAmount } from '@/lib/amount'
import { useUpdateExpenseItem, type ExpenseEntry } from '@/hooks/useExpenses'
import { useToast } from '@/components/shared/Toast'
import { NOTE_MAX } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import { EXPENSE_QUICK_AMOUNTS } from '@/lib/expenseDate'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import OfflineEditNote from '@/components/shared/OfflineEditNote'

interface EditExpenseModalProps {
  expense:  ExpenseEntry
  onClose:  () => void
}

/** Amount + note only — the backend does not support moving an expense to another day. */
export default function EditExpenseModal({ expense, onClose }: EditExpenseModalProps) {
  const [amount, setAmount] = useState(String(expense.amount))
  const [note, setNote] = useState(expense.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateExpense = useUpdateExpenseItem()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const titleId = useId()
  const amountRef = useRef<HTMLInputElement>(null)

  const close = () => { if (!saving) onClose() }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }

    const check = checkAmount(amount, 'expense amount')
    if (!check.ok) {
      setError(check.message)
      amountRef.current?.focus()
      return
    }

    setSaving(true)
    setError(null)
    try {
      await updateExpense({
        expenseId: expense._id,
        amount: check.value,
        note: note.trim() || undefined,
      })
      showToast('Expense updated!', 'success')
      onClose()
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update expense. Try again.'))
      showToast(getErrorMessage(e, 'Could not update expense.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} initialFocusRef={amountRef}>
      <SheetHeader
        titleId={titleId}
        title="Edit expense"
        subtitle={<>Expense from <span className="font-semibold text-foreground">{formatDate(expense.expenseDate)}</span></>}
        icon={<Pencil size={18} />}
        iconClassName="bg-negative/10 text-negative"
        onClose={close}
        closeDisabled={saving}
      />

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
        <SheetBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-expense-amount" className={fieldLabel}>How much did you spend?</label>
            <AmountInput
              id="edit-expense-amount"
              inputRef={amountRef}
              size="lg"
              tone="negative"
              value={amount}
              onChange={(v) => { setAmount(v); setError(null) }}
              invalid={Boolean(error)}
              disabled={saving}
              aria-describedby={error ? 'edit-expense-err' : undefined}
              quickAmounts={EXPENSE_QUICK_AMOUNTS}
            />
            {error && (
              <p id="edit-expense-err" className={fieldError} role="alert">
                <AlertCircle size={16} className="shrink-0" /> {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-expense-note" className={fieldLabel}>
              What was it for? <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="edit-expense-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. electricity, rent, stock purchase"
              maxLength={NOTE_MAX}
              disabled={saving}
              className={inputBase}
            />
          </div>
        </SheetBody>

        <SheetFooter>
          {!canEdit && <OfflineEditNote className="mb-3" />}
          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !canEdit} className={cn(btnPrimary, 'flex-2')}>
              {saving
                ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
                : <><Check size={18} /> Save changes</>}
            </button>
          </div>
        </SheetFooter>
      </form>
    </Sheet>
  )
}
