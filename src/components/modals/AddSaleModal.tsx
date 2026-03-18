import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Plus, Check, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { useRecordSales } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import { MAX_SALE_ITEMS } from '@/lib/constants'
import type { Id } from '../../../convex/_generated/dataModel'

// ── Types ──────────────────────────────────────────────────────────────────

interface SaleRow {
  id:         string
  productName: string
  amount:     string   // string during editing
  categoryId: string
  note:       string
}

interface RowErrors {
  productName?: string
  amount?:      string
}

const emptyRow = (): SaleRow => ({
  id:          crypto.randomUUID(),
  productName: '',
  amount:      '',
  categoryId:  '',
  note:        '',
})

// ── Modal ──────────────────────────────────────────────────────────────────

interface AddSaleModalProps {
  onClose: () => void
}

export default function AddSaleModal({ onClose }: AddSaleModalProps) {
  const [rows,    setRows]    = useState<SaleRow[]>([emptyRow()])
  const [errors,  setErrors]  = useState<Record<string, RowErrors>>({})
  const [saving,  setSaving]  = useState(false)
  const [topError, setTopError] = useState<string | null>(null)

  const recordSales = useRecordSales()
  const categories  = useCategories()
  const { showToast } = useToast()
  const firstInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Focus first input on open
  useEffect(() => { firstInputRef.current?.focus() }, [])

  // On iOS, focusing an input inside a fixed modal doesn't always auto-scroll.
  // Force-scroll the focused element into view within the modal's scroll area.
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      const scroller = scrollContainerRef.current
      if (!target || !scroller) return
      if (scroller.contains(target)) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    document.addEventListener('focusin', handler)
    return () => document.removeEventListener('focusin', handler)
  }, [])

  // Escape to close (only when not saving)
  useEffect(() => {
    if (saving) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, saving])

  // Running total
  const total = rows.reduce((sum, r) => {
    const v = parseFloat(r.amount)
    return sum + (isNaN(v) ? 0 : v)
  }, 0)

  const updateRow = useCallback((id: string, field: keyof SaleRow, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
    // Clear error for the field as user types
    setErrors((prev) => {
      const rowErr = { ...prev[id] }
      if (field === 'productName') delete rowErr.productName
      if (field === 'amount')      delete rowErr.amount
      return { ...prev, [id]: rowErr }
    })
  }, [])

  const addRow = () => {
    if (rows.length >= MAX_SALE_ITEMS) return
    setRows((prev) => [...prev, emptyRow()])
  }

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    setErrors((prev) => { const e = { ...prev }; delete e[id]; return e })
  }

  const validate = (): boolean => {
    const newErrors: Record<string, RowErrors> = {}
    let valid = true

    for (const row of rows) {
      const rowErr: RowErrors = {}
      if (!row.productName.trim()) {
        rowErr.productName = 'Product name is required.'
        valid = false
      }
      const amt = parseFloat(row.amount)
      if (isNaN(amt) || amt <= 0) {
        rowErr.amount = 'Enter a valid amount greater than 0.'
        valid = false
      }
      if (Object.keys(rowErr).length > 0) newErrors[row.id] = rowErr
    }

    setErrors(newErrors)
    return valid
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setSaving(true)
    setTopError(null)

    try {
      const items = rows.map((r) => ({
        productName: r.productName.trim(),
        amount:      parseFloat(r.amount),
        categoryId:  r.categoryId ? (r.categoryId as Id<'categories'>) : undefined,
        note:        r.note.trim() || undefined,
      }))

      const result = await recordSales({ items, sessionDate: Date.now() }) as { itemCount: number; totalAmount: number }
      const msg = `${result.itemCount} sale${result.itemCount !== 1 ? 's' : ''} recorded! Total: ${formatCurrency(result.totalAmount)}`
      showToast(msg, 'success')
      onClose()
    } catch {
      setTopError('Could not save sales. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-500 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-sale-title"
      style={{
        // Keep bottom sheet above the home indicator on iOS.
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
        paddingTop: 'calc(1rem + env(safe-area-inset-top))',
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-modal-backdrop"
        onClick={() => { if (!saving) onClose() }}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg p-px rounded-t-3xl sm:rounded-2xl bg-gradient-brand/25">
        <div className="relative h-full bg-card/85 backdrop-blur-xl border border-border/70 rounded-[1.25rem] shadow-2xl animate-modal-content max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 id="add-sale-title" className="text-base font-semibold text-foreground">
            Record Sales
          </h2>
          <button
            onClick={() => { if (!saving) onClose() }}
            aria-label="Close"
            disabled={saving}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Scrollable rows */}
          <div ref={scrollContainerRef} className="overflow-y-auto px-5 py-4 flex flex-col gap-3 flex-1 overscroll-contain">
            {/* Top-level error */}
            {topError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5" role="alert">
                <AlertCircle size={16} className="shrink-0" />
                {topError}
              </div>
            )}

            {/* Sale rows */}
            {rows.map((row, idx) => (
              <SaleRowInput
                key={row.id}
                row={row}
                errors={errors[row.id]}
                categories={categories ?? []}
                isFirst={idx === 0}
                canRemove={rows.length > 1}
                firstInputRef={idx === 0 ? firstInputRef : undefined}
                onChange={updateRow}
                onRemove={() => removeRow(row.id)}
              />
            ))}

            {/* Add another item */}
            {rows.length < MAX_SALE_ITEMS && (
              <button
                type="button"
                onClick={addRow}
                className={cn(
                  'flex items-center gap-2 text-sm font-medium text-primary',
                  'hover:text-primary/80 active:scale-95 transition-all py-1',
                  'w-fit',
                )}
              >
                <Plus size={16} />
                Add Another Item
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 border-t border-border/80 shrink-0 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-foreground">
              Total:{' '}
              <span className="text-primary text-base">
                {formatCurrency(total)}
              </span>
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { if (!saving) onClose() }}
                disabled={saving}
                className="active:scale-[0.97]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97]"
              >
                {saving
                  ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                  : <><Check size={16} /> Add Sales</>
                }
              </Button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

// ── Row component ──────────────────────────────────────────────────────────

interface SaleRowInputProps {
  row:           SaleRow
  errors?:       RowErrors
  categories:    { _id: string; name: string; color: string }[]
  isFirst:       boolean
  canRemove:     boolean
  firstInputRef?: React.RefObject<HTMLInputElement | null>
  onChange:      (id: string, field: keyof SaleRow, value: string) => void
  onRemove:      () => void
}

function SaleRowInput({
  row, errors, categories, isFirst, canRemove, firstInputRef, onChange, onRemove,
}: SaleRowInputProps) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-border/60 bg-background/50 backdrop-blur-xl">
      {/* Row header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Item {isFirst ? '1' : ''}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove item"
            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Product name + Amount */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <div className="flex flex-col gap-1">
          <input
            ref={firstInputRef as React.RefObject<HTMLInputElement> | undefined}
            type="text"
            value={row.productName}
            onChange={(e) => onChange(row.id, 'productName', e.target.value)}
            placeholder="Product name *"
            autoComplete="off"
            aria-label="Product name"
            className={cn(
              'h-10 px-3 rounded-lg border bg-background text-sm text-foreground',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
              errors?.productName && 'border-destructive focus:ring-destructive/40',
            )}
          />
          {errors?.productName && (
            <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
              <AlertCircle size={11} /> {errors.productName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1 w-full sm:w-28">
          <input
            type="number"
            value={row.amount}
            onChange={(e) => onChange(row.id, 'amount', e.target.value)}
            placeholder="PKR *"
            min="0"
            step="1"
            inputMode="numeric"
            aria-label="Amount in PKR"
            className={cn(
              'h-10 px-3 rounded-lg border bg-background text-sm text-foreground',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              errors?.amount && 'border-destructive focus:ring-destructive/40',
            )}
          />
          {errors?.amount && (
            <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
              <AlertCircle size={11} /> {errors.amount}
            </p>
          )}
        </div>
      </div>

      {/* Category + Note */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={row.categoryId}
          onChange={(e) => onChange(row.id, 'categoryId', e.target.value)}
          aria-label="Category (optional)"
          className={cn(
            'h-9 px-2.5 rounded-lg border bg-background text-sm text-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
            !row.categoryId && 'text-muted-foreground',
          )}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>

        <input
          type="text"
          value={row.note}
          onChange={(e) => onChange(row.id, 'note', e.target.value)}
          placeholder="Note (optional)"
          maxLength={100}
          aria-label="Note (optional)"
          className={cn(
            'h-10 px-3 rounded-lg border bg-background text-sm text-foreground',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
          )}
        />
      </div>
    </div>
  )
}
