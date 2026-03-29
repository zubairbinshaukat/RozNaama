import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Plus, Check, Loader2, AlertCircle, ShoppingBag, Calendar } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  cn,
  formatCurrency,
  startOfDay,
  toDateInputValue,
  parseDateInputToStartOfDay,
} from '@/lib/utils'
import { useRecordSales } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import CategorySelect from '@/components/shared/CategorySelect'
import { useVisualViewportBottomInset } from '@/hooks/useVisualViewportInset'
import { MAX_SALE_ITEMS } from '@/lib/constants'
import type { Id } from '../../../convex/_generated/dataModel'

// ── Types ──────────────────────────────────────────────────────────────────

interface SaleRow {
  id:          string
  productName: string
  amount:      string
  categoryId:  string
  note:        string
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
  const [rows,     setRows]     = useState<SaleRow[]>([emptyRow()])
  const [errors,   setErrors]   = useState<Record<string, RowErrors>>({})
  const [saving,   setSaving]   = useState(false)
  const [topError, setTopError] = useState<string | null>(null)
  const [saleDateMs, setSaleDateMs] = useState(() => startOfDay())

  const recordSales = useRecordSales()
  const categories  = useCategories()
  const { showToast } = useToast()
  const keyboardInset = useVisualViewportBottomInset()
  const firstInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const saleDateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { firstInputRef.current?.focus() }, [])

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

  useEffect(() => {
    if (saving) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, saving])

  const total = rows.reduce((sum, r) => {
    const v = parseFloat(r.amount)
    return sum + (isNaN(v) ? 0 : v)
  }, 0)

  const updateRow = useCallback((id: string, field: keyof SaleRow, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
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

      const result = await recordSales({ items, sessionDate: saleDateMs }) as { itemCount: number; totalAmount: number }
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
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-sale-title"
      style={{
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
        paddingTop: 'calc(1rem + env(safe-area-inset-top))',
      }}
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => { if (!saving) onClose() }}
        aria-hidden
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-lg"
      >
        <div
          className="relative h-full bg-card border border-border/60 rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden"
          style={{
            boxShadow: `
              0 2px 4px rgba(0,0,0,0.02),
              0 8px 20px rgba(0,0,0,0.06),
              0 24px 60px rgba(0,0,0,0.08)
            `,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShoppingBag size={18} className="text-primary" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="add-sale-title" className="text-base font-bold text-foreground tracking-tight">
                Record Sales
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rows.length} item{rows.length !== 1 ? 's' : ''}
                {total > 0 && <> · <span className="text-primary font-semibold">{formatCurrency(total)}</span></>}
              </p>
            </div>
            <button
              onClick={() => { if (!saving) onClose() }}
              aria-label="Close"
              disabled={saving}
              className="p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all disabled:opacity-40"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Divider */}
          <div className="h-px bg-border/50 mx-5" />

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            {/* Scrollable rows */}
            <div ref={scrollContainerRef} className="overflow-y-auto px-4 py-4 flex flex-col gap-3 flex-1 overscroll-contain">
              {/* Sale date (applies to all line items) */}
              <div className="flex items-center gap-2 px-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                  Sale date
                </span>
                <div className="relative flex-1 min-w-0 flex items-center">
                  <input
                    ref={saleDateInputRef}
                    type="date"
                    value={toDateInputValue(saleDateMs)}
                    onChange={(e) => setSaleDateMs(parseDateInputToStartOfDay(e.target.value))}
                    disabled={saving}
                    aria-label="Sale date"
                    className={cn(
                      'w-full h-10 pl-3 pr-11 rounded-xl border bg-card text-sm font-medium text-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all',
                      'disabled:opacity-50 appearance-none',
                      '[&::-webkit-calendar-picker-indicator]:hidden',
                    )}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    aria-label="Open calendar"
                    onClick={() => {
                      const el = saleDateInputRef.current
                      if (!el) return
                      if (typeof el.showPicker === 'function') void el.showPicker()
                      else el.focus()
                    }}
                    className={cn(
                      'absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg',
                      'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                      'active:scale-[0.97] transition-all disabled:opacity-40',
                    )}
                  >
                    <Calendar size={18} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Top-level error */}
              {topError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-2xl px-4 py-3"
                  role="alert"
                >
                  <AlertCircle size={16} className="shrink-0" />
                  {topError}
                </motion.div>
              )}

              {/* Sale rows */}
              {rows.map((row, idx) => (
                <SaleRowInput
                  key={row.id}
                  row={row}
                  index={idx}
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
                    'flex items-center gap-2 text-sm font-semibold text-primary',
                    'hover:text-primary/80 active:scale-95 transition-all py-2 px-1',
                    'w-fit rounded-xl',
                  )}
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Plus size={14} className="text-primary" strokeWidth={2.5} />
                  </div>
                  Add Another Item
                </button>
              )}
            </div>

            {/* Footer */}
            <div
              className="px-5 pt-4 shrink-0 flex items-center justify-between gap-4"
              style={{
                paddingBottom: `calc(1.25rem + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
                borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
              }}
            >
              <div className="text-sm font-semibold text-foreground">
                Total:{' '}
                <span className="text-primary text-base font-bold tabular-nums">
                  {formatCurrency(total)}
                </span>
              </div>
              <div className="flex gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { if (!saving) onClose() }}
                  disabled={saving}
                  className="h-10 rounded-xl active:scale-[0.97] transition-transform"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="h-10 rounded-xl bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97] transition-all"
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
      </motion.div>
    </div>
  )
}

// ── Row component ──────────────────────────────────────────────────────────

interface SaleRowInputProps {
  row:            SaleRow
  index:          number
  errors?:        RowErrors
  categories:     { _id: string; name: string; color: string }[]
  isFirst:        boolean
  canRemove:      boolean
  firstInputRef?: React.RefObject<HTMLInputElement | null>
  onChange:       (id: string, field: keyof SaleRow, value: string) => void
  onRemove:       () => void
}

function SaleRowInput({
  row, index, errors, categories, canRemove, firstInputRef, onChange, onRemove,
}: SaleRowInputProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.04,
        duration: 0.25,
        ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
      }}
      className="flex flex-col gap-2.5 p-3.5 rounded-2xl border border-border/50 bg-muted/15 transition-all hover:bg-muted/25"
      style={{
        boxShadow: '0 1px 3px rgba(0,0,0,0.02), 0 0 0 1px rgba(0,0,0,0.03)',
      }}
    >
      {/* Row header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Item {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove item"
            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 active:scale-95 transition-all"
          >
            <X size={14} strokeWidth={2} />
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
              'h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all',
              errors?.productName && 'border-destructive focus:ring-destructive/30',
            )}
          />
          {errors?.productName && (
            <p className="flex items-center gap-1.5 text-xs text-destructive font-medium" role="alert">
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
              'h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all',
              '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              errors?.amount && 'border-destructive focus:ring-destructive/30',
            )}
          />
          {errors?.amount && (
            <p className="flex items-center gap-1.5 text-xs text-destructive font-medium" role="alert">
              <AlertCircle size={11} /> {errors.amount}
            </p>
          )}
        </div>
      </div>

      {/* Category + Note */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <CategorySelect
          categories={categories}
          value={row.categoryId}
          onChange={(v) => onChange(row.id, 'categoryId', v)}
          aria-label="Category (optional)"
        />

        <input
          type="text"
          value={row.note}
          onChange={(e) => onChange(row.id, 'note', e.target.value)}
          placeholder="Note (optional)"
          maxLength={100}
          aria-label="Note (optional)"
          className={cn(
            'h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all',
          )}
        />
      </div>
    </motion.div>
  )
}