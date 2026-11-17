import { useState, useRef, useCallback, useId } from 'react'
import { X, Plus, Check, Loader2, AlertCircle, ShoppingBag, StickyNote } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn, formatCurrency, formatDate, startOfDay, clampSaleDateToTodayMs } from '@/lib/utils'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { checkAmount } from '@/lib/amount'
import { useSubmitEntry } from '@/hooks/useSubmitEntry'
import { useCategories, type Category } from '@/hooks/useCategories'
import { useFormatMoney } from '@/context/amountVisibility'
import { queuedToast } from './submitToasts'
import { useEntryHistory } from '@/hooks/useEntryHistory'
import { useToast } from '@/components/shared/Toast'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import DateField from '@/components/shared/DateField'
import CategorySelect from '@/components/shared/CategorySelect'
import SuggestionChips from '@/components/shared/SuggestionChips'
import { MAX_SALE_ITEMS, NOTE_MAX, PRODUCT_NAME_MAX } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import {
  forgetSaleProduct,
  recordSaleProducts,
  restoreSaleProduct,
  suggestSaleProducts,
  type SaleProductEntry,
} from '@/lib/entryHistory'
import type { Id } from '../../../convex/_generated/dataModel'
import { KHATA_TURNED_OFF_MESSAGE, useOnKhataTurnedOff, useShopSettings } from '@/hooks/useShopSettings'
import SalePaymentBlock from '@/components/khata/SalePaymentBlock'
import {
  customerArg,
  customerProblem,
  FULL_PAYMENT,
  isUdhaarSale,
  pickedName,
  receivedValue,
  type SalePayment,
  type SalePaymentErrors,
} from '@/components/khata/customer'
import { toPaisa } from '@/lib/khata'

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

interface SaleItemInput {
  productName: string
  amount:      number
  categoryId?: Id<'categories'>
  note?:       string
}

/** categoryId → name for the items' categories (pending rows show it offline). */
function labelsFor(items: SaleItemInput[], categories: Category[] | undefined): Record<string, string> | undefined {
  const labels: Record<string, string> = {}
  for (const item of items) {
    if (!item.categoryId) continue
    const cat = categories?.find((c) => c._id === item.categoryId)
    if (cat) labels[item.categoryId] = cat.name
  }
  return Object.keys(labels).length > 0 ? labels : undefined
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
  /** Advance & Udhaar on: Full payment received? block (never rendered when off). */
  const [payment, setPayment] = useState<SalePayment>(FULL_PAYMENT)
  const [paymentErrors, setPaymentErrors] = useState<SalePaymentErrors>({})

  const { submitSale, submitKhataSale } = useSubmitEntry()
  const { khataOn, settings } = useShopSettings()
  // Switched off elsewhere while "No" was chosen: back to a normal sale.
  useOnKhataTurnedOff(() => {
    if (!payment.full) showToast(KHATA_TURNED_OFF_MESSAGE, 'info')
    setPayment(FULL_PAYMENT)
    setPaymentErrors({})
  })
  const categories  = useCategories()
  const money       = useFormatMoney()
  const { userId, history } = useEntryHistory()
  const { showToast } = useToast()
  const titleId = useId()
  const firstInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const close = () => { if (!saving) onClose() }

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

  /** Chip tap: fill the whole row (explicit, so it overwrites a typed amount). */
  const fillRow = (id: string, entry: SaleProductEntry) => {
    const categoryStillExists =
      entry.categoryId !== undefined && (categories ?? []).some((c) => c._id === entry.categoryId)
    setRows((prev) => prev.map((r) => r.id === id
      ? {
          ...r,
          productName: entry.name.slice(0, PRODUCT_NAME_MAX),
          amount:      String(entry.lastAmount),
          categoryId:  categoryStillExists ? (entry.categoryId ?? '') : '',
        }
      : r))
    setErrors((prev) => ({ ...prev, [id]: {} }))
  }

  const forgetSuggestion = (name: string) => {
    const removed = forgetSaleProduct(userId, name)
    if (!removed) return
    showToast(`Removed "${removed.name}"`, 'info', {
      action: { label: 'Undo', onAction: () => restoreSaleProduct(userId, removed) },
    })
  }

  const addRow = () => {
    if (rows.length >= MAX_SALE_ITEMS) return
    const row = emptyRow()
    setRows((prev) => [...prev, row])
    // Focus the new item's amount (first field) once it renders.
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLInputElement>(`[data-row-amount="${row.id}"] input`)?.focus()
    })
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
        rowErr.productName = 'Write what you sold.'
        valid = false
      }
      const amt = checkAmount(row.amount)
      if (!amt.ok) {
        rowErr.amount = amt.message
        valid = false
      }
      if (Object.keys(rowErr).length > 0) newErrors[row.id] = rowErr
    }

    setErrors(newErrors)
    if (khataOn && !payment.full) {
      const payErr: SalePaymentErrors = {}
      if (valid && toPaisa(receivedValue(payment)) > toPaisa(total)) payErr.received = 'More than the total.'
      if (isUdhaarSale(payment, total)) {
        const problem = customerProblem(payment.customer)
        if (problem) payErr.customer = problem
      }
      setPaymentErrors(payErr)
      if (payErr.received || payErr.customer) valid = false
    }
    if (!valid) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
    }
    return valid
  }

  /** The one place this sheet writes: server, or this phone's outbox when offline. */
  const submitSales = (items: SaleItemInput[], sessionDate: number) => {
    const categoryLabels = labelsFor(items, categories)
    return submitSale({
      items: items.map((i) => ({
        productName: i.productName,
        amount:      i.amount,
        ...(i.categoryId ? { categoryId: i.categoryId } : {}),
        ...(i.note ? { note: i.note } : {}),
      })),
      sessionDate,
      ...(categoryLabels ? { categoryLabels } : {}),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || !validate()) return

    setSaving(true)
    setTopError(null)

    try {
      const items: SaleItemInput[] = rows.map((r) => ({
        productName: r.productName.trim(),
        amount:      parseFloat(r.amount),
        categoryId:  r.categoryId ? (r.categoryId as Id<'categories'>) : undefined,
        note:        r.note.trim() || undefined,
      }))

      const sessionDate = clampSaleDateToTodayMs(saleDateMs)
      const remember = () => recordSaleProducts(userId, items.map((i) => ({
        name: i.productName, amount: i.amount, categoryId: i.categoryId,
      })))
      if (khataOn && payment.customer && isUdhaarSale(payment, total)) {
        const name = pickedName(payment.customer)
        const categoryLabels = labelsFor(items, categories)
        const udhaar = await submitKhataSale({
          customer: customerArg(payment.customer),
          customerName: name,
          items: items.map((i) => ({
            productName: i.productName,
            amount:      i.amount,
            ...(i.categoryId ? { categoryId: i.categoryId } : {}),
            ...(i.note ? { note: i.note } : {}),
          })),
          sessionDate,
          receivedNow: receivedValue(payment),
          recognition: settings.udhaarRecognition,
          ...(categoryLabels ? { categoryLabels } : {}),
        })
        remember()
        if (udhaar.status === 'saved') {
          showToast(`Saved · Baqi ${money(udhaar.result.remaining)} (${name})`, 'success')
        } else {
          const t = queuedToast(udhaar.problem)
          showToast(t.message, t.type)
        }
        onClose()
        return
      }

      const outcome = await submitSales(items, sessionDate)
      // Saved on the server or on this phone: either way the entry is kept.
      remember()
      if (outcome.status === 'saved') {
        const { itemCount, totalAmount } = outcome.result
        showToast(`Saved · ${itemCount} sale${itemCount !== 1 ? 's' : ''}, ${money(totalAmount)}`, 'success')
      } else {
        const t = queuedToast(outcome.problem)
        showToast(t.message, t.type)
      }
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not save sales. Please check your connection and try again.')
      setTopError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      onClose={close}
      dismissible={!saving}
      labelledBy={titleId}
      size="lg"
      initialFocusRef={firstInputRef}
    >
      <SheetHeader
        titleId={titleId}
        title="Record sale"
        subtitle={<>{rows.length} item{rows.length !== 1 ? 's' : ''} · <span className="font-semibold text-foreground">{formatDate(saleDateMs)}</span></>}
        icon={<ShoppingBag size={18} />}
        onClose={close}
        closeDisabled={saving}
      />

      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
        <SheetBody className="flex flex-col gap-4">
          {topError && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 text-[15px] font-medium text-negative bg-negative/8 border border-negative/25 rounded-2xl px-4 py-3"
              role="alert"
            >
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              {topError}
            </motion.div>
          )}

          {rows.map((row, idx) => (
            <SaleRowInput
              key={row.id}
              row={row}
              index={idx}
              showIndex={rows.length > 1}
              errors={errors[row.id]}
              categories={categories ?? []}
              suggestions={suggestSaleProducts(history.products, row.productName)}
              canRemove={rows.length > 1}
              disabled={saving}
              firstInputRef={idx === 0 ? firstInputRef : undefined}
              onChange={updateRow}
              onFill={fillRow}
              onForget={forgetSuggestion}
              onRemove={() => removeRow(row.id)}
            />
          ))}

          {rows.length < MAX_SALE_ITEMS ? (
            <button
              type="button"
              onClick={addRow}
              disabled={saving}
              className={cn(
                'flex items-center justify-center gap-2 min-h-12 rounded-2xl border-2 border-dashed border-primary/35',
                'text-base font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all',
                'disabled:opacity-50',
              )}
            >
              <Plus size={18} strokeWidth={2.5} />
              Add another item
            </button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              You can add up to {MAX_SALE_ITEMS} items at once.
            </p>
          )}

          <DateField
            label="Sale date"
            value={saleDateMs}
            onChange={(ms) => setSaleDateMs(clampSaleDateToTodayMs(ms))}
            disabled={saving}
          />

          {khataOn && (
            <SalePaymentBlock
              value={payment}
              onChange={(p) => { setPayment(p); setPaymentErrors({}) }}
              total={total}
              errors={paymentErrors}
              disabled={saving}
            />
          )}
        </SheetBody>

        <SheetFooter>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <span className="text-sm font-semibold text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-foreground tabular tracking-tight" aria-live="polite">
              {formatCurrency(total)}
            </span>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={cn(btnPrimary, 'flex-2')}>
              {saving
                ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
                : <><Check size={18} /> {rows.length > 1 ? 'Save sales' : 'Save sale'}</>}
            </button>
          </div>
        </SheetFooter>
      </form>
    </Sheet>
  )
}

// ── Row component ──────────────────────────────────────────────────────────

interface SaleRowInputProps {
  row:            SaleRow
  index:          number
  showIndex:      boolean
  errors?:        RowErrors
  categories:     { _id: string; name: string; color: string }[]
  suggestions:    SaleProductEntry[]
  canRemove:      boolean
  disabled:       boolean
  firstInputRef?: React.RefObject<HTMLInputElement | null>
  onChange:       (id: string, field: keyof SaleRow, value: string) => void
  onFill:         (id: string, entry: SaleProductEntry) => void
  onForget:       (name: string) => void
  onRemove:       () => void
}

function SaleRowInput({
  row, index, showIndex, errors, categories, suggestions, canRemove, disabled, firstInputRef,
  onChange, onFill, onForget, onRemove,
}: SaleRowInputProps) {
  const uid = useId()
  const [noteOpen, setNoteOpen] = useState(row.note !== '')
  const amountRef = useRef<HTMLInputElement | null>(null)
  const nameErrId = `${uid}-name-err`
  const amountErrId = `${uid}-amount-err`

  const setAmountRef = useCallback((el: HTMLInputElement | null) => {
    amountRef.current = el
    if (firstInputRef) firstInputRef.current = el
  }, [firstInputRef])

  const pick = (label: string) => {
    const entry = suggestions.find((s) => s.name === label)
    if (!entry) return
    onFill(row.id, entry)
    // Land on the amount with its text selected: confirm, or type over it.
    requestAnimationFrame(() => {
      const el = amountRef.current
      if (!el) return
      el.focus()
      el.select()
    })
  }

  return (
    <motion.div
      role="group"
      aria-label={showIndex ? `Item ${index + 1}` : 'Sale item'}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex flex-col gap-3 min-w-0',
        showIndex && 'p-3.5 rounded-3xl border border-border/70 bg-muted/25',
      )}
    >
      {showIndex && (
        <div className="flex items-center justify-between -mt-1 -mr-1">
          <p className="text-sm font-bold text-foreground" aria-hidden>Item {index + 1}</p>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove item ${index + 1}`}
              className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-negative/10 active:scale-[0.97] transition-all"
            >
              <X size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5" data-row-amount={row.id}>
        <label htmlFor={`${uid}-amount`} className={fieldLabel}>How much?</label>
        <AmountInput
          id={`${uid}-amount`}
          inputRef={setAmountRef}
          value={row.amount}
          onChange={(v) => onChange(row.id, 'amount', v)}
          invalid={Boolean(errors?.amount)}
          disabled={disabled}
          aria-describedby={errors?.amount ? amountErrId : undefined}
        />
        {errors?.amount && (
          <p id={amountErrId} className={fieldError} role="alert">
            <AlertCircle size={16} /> {errors.amount}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-name`} className={fieldLabel}>What did you sell?</label>
        <input
          id={`${uid}-name`}
          data-row-name={row.id}
          type="text"
          value={row.productName}
          onChange={(e) => onChange(row.id, 'productName', e.target.value)}
          placeholder="e.g. Sugar 1kg, Chai"
          maxLength={PRODUCT_NAME_MAX}
          autoComplete="off"
          enterKeyHint="next"
          disabled={disabled}
          aria-invalid={errors?.productName ? true : undefined}
          aria-describedby={errors?.productName ? nameErrId : undefined}
          className={cn(inputBase, errors?.productName && inputInvalid)}
        />
        <SuggestionChips
          items={suggestions.map((s) => s.name)}
          query={row.productName}
          onPick={pick}
          onRemove={onForget}
          disabled={disabled}
          aria-label={row.productName.trim() ? 'Matching items' : 'Recent items'}
        />
        {errors?.productName && (
          <p id={nameErrId} className={fieldError} role="alert">
            <AlertCircle size={16} /> {errors.productName}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span id={`${uid}-cat`} className={fieldLabel}>
            Category <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <CategorySelect
            categories={categories}
            value={row.categoryId}
            onChange={(v) => onChange(row.id, 'categoryId', v)}
            aria-labelledby={`${uid}-cat`}
            disabled={disabled}
          />
        </div>

        {noteOpen ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-note`} className={fieldLabel}>
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id={`${uid}-note`}
              type="text"
              value={row.note}
              onChange={(e) => onChange(row.id, 'note', e.target.value)}
              placeholder="e.g. paid later, customer name"
              maxLength={NOTE_MAX}
              autoComplete="off"
              disabled={disabled}
              autoFocus={row.note === ''}
              className={inputBase}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            disabled={disabled}
            className="self-end flex items-center gap-2 min-h-12 px-3 rounded-2xl text-base font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all w-fit"
          >
            <StickyNote size={18} /> Add a note
          </button>
        )}
      </div>
    </motion.div>
  )
}
