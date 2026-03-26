import { useState, useEffect, useRef } from 'react'
import { X, Check, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { useUpdateExpenseItem, type ExpenseEntry } from '@/hooks/useExpenses'
import { useToast } from '@/components/shared/Toast'
import { useVisualViewportBottomInset } from '@/hooks/useVisualViewportInset'

interface EditExpenseModalProps {
  expense:  ExpenseEntry
  onClose:  () => void
}

export default function EditExpenseModal({ expense, onClose }: EditExpenseModalProps) {
  const [amount, setAmount] = useState(String(expense.amount))
  const [note, setNote] = useState(expense.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateExpense = useUpdateExpenseItem()
  const { showToast } = useToast()
  const keyboardInset = useVisualViewportBottomInset()
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => { amountRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, saving])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return

    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0) {
      setError('Enter a valid expense amount greater than 0.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await updateExpense({
        expenseId: expense._id,
        amount: parsed,
        note: note.trim() || undefined,
      })
      showToast('Expense updated!', 'success')
      onClose()
    } catch {
      setError('Could not update expense. Try again.')
      showToast('Could not update expense.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const parsed = parseFloat(amount)

  return (
    <div className="fixed inset-0 z-500 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-expense-title">
      <div className="absolute inset-0 bg-black/50 animate-modal-backdrop" onClick={() => { if (!saving) onClose() }} aria-hidden />
      <div className="relative w-full max-w-md max-h-[min(92dvh,calc(100vh-2rem))] flex flex-col bg-card border border-border rounded-2xl shadow-2xl animate-modal-content overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 id="edit-expense-title" className="text-base font-semibold text-foreground">Edit Expense</h2>
          <button
            onClick={() => { if (!saving) onClose() }}
            disabled={saving}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pt-5 flex flex-col gap-4 min-h-0 overflow-y-auto flex-1" style={{ paddingBottom: `calc(1.25rem + env(safe-area-inset-bottom) + ${keyboardInset}px)` }}>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive font-medium" role="alert">
              <AlertCircle size={12} /> {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-expense-amount" className="text-sm font-medium text-foreground">
              Amount (PKR) <span aria-hidden className="text-destructive">*</span>
            </label>
            <input
              id="edit-expense-amount"
              ref={amountRef}
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null) }}
              placeholder="0"
              min="0"
              step="1"
              inputMode="numeric"
              className={cn(
                'w-full h-11 px-3 rounded-lg border bg-background text-foreground text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                error && 'border-destructive focus:ring-destructive/40',
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-expense-note" className="text-sm font-medium text-foreground">Note</label>
            <input
              id="edit-expense-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              maxLength={100}
              className="h-11 px-3 rounded-lg border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow"
            />
          </div>

          {!isNaN(parsed) && parsed > 0 && (
            <p className="text-xs text-muted-foreground">
              Expense: <span className="font-semibold text-destructive">{formatCurrency(parsed)}</span>
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => { if (!saving) onClose() }} disabled={saving} className="flex-1 active:scale-[0.97]">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="flex-1 bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97]">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Check size={16} /> Save Changes</>}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

