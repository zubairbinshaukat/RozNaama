import { useState, useEffect, useRef } from 'react'
import { X, Check, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { useUpdateSaleItem } from '@/hooks/useSales'
import { useToast } from '@/components/shared/Toast'
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
  const [saving,      setSaving]      = useState(false)
  const [errors,      setErrors]      = useState<{ productName?: string; amount?: string }>({})

  const updateItem  = useUpdateSaleItem()
  const { showToast } = useToast()
  const nameRef     = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, saving])

  const validate = () => {
    const errs: typeof errors = {}
    if (!productName.trim()) errs.productName = 'Product name is required.'
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) errs.amount = 'Enter a valid amount greater than 0.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setSaving(true)
    try {
      await updateItem({
        saleId:      item._id,
        productName: productName.trim(),
        amount:      parseFloat(amount),
        categoryId:  categoryId ? (categoryId as Id<'categories'>) : undefined,
        note:        note.trim() || undefined,
      })
      showToast('Sale updated!', 'success')
      onClose()
    } catch {
      showToast('Could not update sale. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-500 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-sale-title"
    >
      <div
        className="absolute inset-0 bg-black/50 animate-modal-backdrop"
        onClick={() => { if (!saving) onClose() }}
        aria-hidden
      />

      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-modal-content">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <h2 id="edit-sale-title" className="text-base font-semibold text-foreground">Edit Sale</h2>
          <button
            onClick={() => { if (!saving) onClose() }}
            disabled={saving}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          {/* Product name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-product" className="text-sm font-medium text-foreground">
              Product Name <span aria-hidden className="text-destructive">*</span>
            </label>
            <input
              id="edit-product"
              ref={nameRef}
              type="text"
              value={productName}
              onChange={(e) => { setProductName(e.target.value); setErrors((p) => ({ ...p, productName: undefined })) }}
              placeholder="Product name"
              autoComplete="off"
              maxLength={80}
              className={cn(
                'w-full h-11 px-3 rounded-lg border bg-background text-foreground text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
                errors.productName && 'border-destructive focus:ring-destructive/40',
              )}
            />
            {errors.productName && (
              <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
                <AlertCircle size={12} /> {errors.productName}
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-amount" className="text-sm font-medium text-foreground">
              Amount (PKR) <span aria-hidden className="text-destructive">*</span>
            </label>
            <input
              id="edit-amount"
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors((p) => ({ ...p, amount: undefined })) }}
              placeholder="0"
              min="0"
              step="1"
              inputMode="numeric"
              className={cn(
                'w-full h-11 px-3 rounded-lg border bg-background text-foreground text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
                '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                errors.amount && 'border-destructive focus:ring-destructive/40',
              )}
            />
            {errors.amount && (
              <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
                <AlertCircle size={12} /> {errors.amount}
              </p>
            )}
          </div>

          {/* Category + Note */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-category" className="text-sm font-medium text-foreground">Category</label>
              <select
                id="edit-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={cn(
                  'h-10 px-2.5 rounded-lg border bg-background text-sm text-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
                  !categoryId && 'text-muted-foreground',
                )}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-note" className="text-sm font-medium text-foreground">Note</label>
              <input
                id="edit-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                maxLength={100}
                className="h-10 px-3 rounded-lg border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow"
              />
            </div>
          </div>

          {/* Total preview */}
          {!isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
            <p className="text-xs text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{formatCurrency(parseFloat(amount))}</span>
            </p>
          )}

          {/* Footer buttons */}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { if (!saving) onClose() }}
              disabled={saving}
              className="flex-1 active:scale-[0.97]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97]"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><Check size={16} /> Save Changes</>
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
