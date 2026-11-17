import { useState, useRef, useMemo, useId } from 'react'
import { Check, Loader2, AlertCircle, Pencil } from 'lucide-react'
import { cn, startOfDay, clampSaleDateToTodayMs } from '@/lib/utils'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { checkAmount } from '@/lib/amount'
import { useUpdateSaleItem } from '@/hooks/useSales'
import { useToast } from '@/components/shared/Toast'
import { NOTE_MAX, PRODUCT_NAME_MAX } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import DateField from '@/components/shared/DateField'
import CategorySelect from '@/components/shared/CategorySelect'
import SuggestionChips from '@/components/shared/SuggestionChips'
import { useEntryHistory } from '@/hooks/useEntryHistory'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import {
  forgetSaleProduct,
  recordSaleProducts,
  restoreSaleProduct,
  suggestSaleProducts,
} from '@/lib/entryHistory'
import type { SaleItem } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'
import type { Id } from '../../../convex/_generated/dataModel'

interface EditSaleModalProps {
  item:       SaleItem
  categories: Category[]
  onClose:    () => void
}

export default function EditSaleModal({ item, categories, onClose }: EditSaleModalProps) {
  const [productName, setProductName] = useState(item.productName)
  const [amount,      setAmount]      = useState(String(item.amount))
  const [categoryId,  setCategoryId]  = useState<string>(item.categoryId ?? '')
  const [note,        setNote]        = useState(item.note ?? '')
  const [saleDateMs, setSaleDateMs]  = useState(() =>
    clampSaleDateToTodayMs(startOfDay(new Date(item.saleDate))),
  )
  const [saving,      setSaving]      = useState(false)
  const [errors,      setErrors]      = useState<{ productName?: string; amount?: string }>({})

  const updateItem  = useUpdateSaleItem()
  const canEdit     = useCanEditOnline()
  const { userId, history } = useEntryHistory()
  const { showToast } = useToast()
  const titleId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const close = () => { if (!saving) onClose() }

  const initialSnapshot = useMemo(
    () => ({
      productName: item.productName.trim(),
      amount:      item.amount,
      categoryId:  item.categoryId ?? '',
      note:        (item.note ?? '').trim(),
      saleDateMs:  clampSaleDateToTodayMs(startOfDay(new Date(item.saleDate))),
    }),
    [item],
  )

  // Only suggest once the name is being changed (not for the saved name).
  const nameEdited = productName.trim() !== '' && productName !== item.productName
  const suggestions = nameEdited ? suggestSaleProducts(history.products, productName) : []

  /** Chip tap: fill name, category (if it still exists) and last amount. */
  const pickSuggestion = (label: string) => {
    const entry = suggestions.find((s) => s.name === label)
    if (!entry) return
    const categoryStillExists =
      entry.categoryId !== undefined && categories.some((c) => c._id === entry.categoryId)
    setProductName(entry.name.slice(0, PRODUCT_NAME_MAX))
    setAmount(String(entry.lastAmount))
    setCategoryId(categoryStillExists ? (entry.categoryId ?? '') : '')
    setErrors({})
    requestAnimationFrame(() => {
      amountRef.current?.focus()
      amountRef.current?.select()
    })
  }

  const forgetSuggestion = (name: string) => {
    const removed = forgetSaleProduct(userId, name)
    if (!removed) return
    showToast(`Removed "${removed.name}"`, 'info', {
      action: { label: 'Undo', onAction: () => restoreSaleProduct(userId, removed) },
    })
  }

  const validate = () => {
    const errs: typeof errors = {}
    if (!productName.trim()) errs.productName = 'Write what you sold.'
    const amt = checkAmount(amount)
    if (!amt.ok) errs.amount = amt.message
    setErrors(errs)
    if (errs.amount) amountRef.current?.focus()
    else if (errs.productName) nameRef.current?.focus()
    return Object.keys(errs).length === 0
  }

  /** The one place this sheet writes to the backend. */
  const submitUpdate = async (args: Parameters<typeof updateItem>[0]) => {
    await updateItem(args)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    if (!validate()) return

    const amt = parseFloat(amount)
    const nextNote = note.trim()
    if (
      productName.trim() === initialSnapshot.productName &&
      amt === initialSnapshot.amount &&
      categoryId === initialSnapshot.categoryId &&
      nextNote === initialSnapshot.note &&
      saleDateMs === initialSnapshot.saleDateMs
    ) {
      showToast('No fields were updated.', 'info')
      return
    }

    setSaving(true)
    try {
      await submitUpdate({
        saleId:      item._id,
        productName: productName.trim(),
        amount:      amt,
        categoryId:  categoryId ? (categoryId as Id<'categories'>) : undefined,
        note:        nextNote || undefined,
        saleDate:
          saleDateMs !== initialSnapshot.saleDateMs
            ? clampSaleDateToTodayMs(saleDateMs)
            : undefined,
      })
      if (
        productName.trim() !== initialSnapshot.productName ||
        amt !== initialSnapshot.amount ||
        categoryId !== initialSnapshot.categoryId
      ) {
        recordSaleProducts(userId, [{ name: productName.trim(), amount: amt, categoryId: categoryId || undefined }])
      }
      showToast('Sale updated!', 'success')
      onClose()
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not update sale. Please try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} initialFocusRef={amountRef}>
      <SheetHeader
        titleId={titleId}
        title="Edit sale"
        subtitle="Change anything, then tap Save."
        icon={<Pencil size={18} />}
        onClose={close}
        closeDisabled={saving}
      />

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
        <SheetBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-amount" className={fieldLabel}>How much?</label>
            <AmountInput
              id="edit-amount"
              inputRef={amountRef}
              value={amount}
              onChange={(v) => { setAmount(v); setErrors((p) => ({ ...p, amount: undefined })) }}
              invalid={Boolean(errors.amount)}
              disabled={saving}
              aria-describedby={errors.amount ? 'edit-amount-err' : undefined}
            />
            {errors.amount && (
              <p id="edit-amount-err" className={fieldError} role="alert">
                <AlertCircle size={16} /> {errors.amount}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-product" className={fieldLabel}>What did you sell?</label>
            <input
              id="edit-product"
              ref={nameRef}
              type="text"
              value={productName}
              onChange={(e) => { setProductName(e.target.value); setErrors((p) => ({ ...p, productName: undefined })) }}
              placeholder="Product name"
              autoComplete="off"
              maxLength={PRODUCT_NAME_MAX}
              disabled={saving}
              aria-invalid={errors.productName ? true : undefined}
              aria-describedby={errors.productName ? 'edit-product-err' : undefined}
              className={cn(inputBase, errors.productName && inputInvalid)}
            />
            <SuggestionChips
              items={suggestions.map((s) => s.name)}
              query={productName}
              onPick={pickSuggestion}
              onRemove={forgetSuggestion}
              disabled={saving}
              aria-label="Matching items"
            />
            {errors.productName && (
              <p id="edit-product-err" className={fieldError} role="alert">
                <AlertCircle size={16} /> {errors.productName}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span id="edit-category-label" className={fieldLabel}>
              Category <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <CategorySelect
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              aria-labelledby="edit-category-label"
              disabled={saving}
            />
          </div>

          <DateField
            label="Sale date"
            value={saleDateMs}
            onChange={(ms) => setSaleDateMs(clampSaleDateToTodayMs(ms))}
            disabled={saving}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-note" className={fieldLabel}>
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="edit-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. paid later, customer name"
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
