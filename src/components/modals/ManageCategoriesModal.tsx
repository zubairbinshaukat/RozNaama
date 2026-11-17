import { useState, useId } from 'react'
import { Pencil, Trash2, Check, Loader2, AlertCircle, Layers, Eye, Plus } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { btnOutline, btnPrimary, btnSecondary, fieldError, inputBase, inputInvalid } from '@/lib/ui'
import { useCategories, useUpdateCategory, useRemoveCategory } from '@/hooks/useCategories'
import { useSalesCountsByCategory } from '@/hooks/useSales'
import { useToast } from '@/components/shared/Toast'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import EmptyState from '@/components/shared/EmptyState'
import { CATEGORY_NAME_MAX } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import ConfirmModal from './ConfirmModal'
import CategorySalesModal from './CategorySalesModal'
import ColorSwatches from './ColorSwatches'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import type { Category } from '@/hooks/useCategories'
import type { Id } from '../../../convex/_generated/dataModel'

interface ManageCategoriesModalProps {
  onClose: () => void
  /** Opens the Add Category sheet (offered in the footer and the empty state). */
  onAddCategory?: () => void
}

export default function ManageCategoriesModal({ onClose, onAddCategory }: ManageCategoriesModalProps) {
  const categories    = useCategories()
  const updateCat     = useUpdateCategory()
  const removeCat     = useRemoveCategory()
  const salesCounts   = useSalesCountsByCategory()
  const canEdit       = useCanEditOnline()
  const { showToast } = useToast()
  const titleId       = useId()

  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
  const [viewingCat,  setViewingCat]  = useState<Category | null>(null)
  const [deleting,    setDeleting]    = useState(false)

  /** Category changes need the server: offline, explain instead of opening the form. */
  const whenOnline = (action: () => void) => () => {
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    action()
  }

  const handleDelete = async () => {
    if (!deletingCat) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    setDeleting(true)
    try {
      await removeCat({ categoryId: deletingCat._id })
      showToast('Category deleted', 'success')
      setDeletingCat(null)
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not delete category. Try again.'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const sorted = categories ? [...categories].sort((a, b) => a.createdAt - b.createdAt) : []

  const salesCountByCategoryId = new Map<Id<'categories'>, number>()
  if (salesCounts) {
    for (const row of salesCounts) salesCountByCategoryId.set(row.categoryId, row.count)
  }

  return (
    <>
      <Sheet onClose={onClose} labelledBy={titleId}>
        <SheetHeader
          titleId={titleId}
          title="Categories"
          subtitle={sorted.length > 0
            ? `${sorted.length} categor${sorted.length === 1 ? 'y' : 'ies'}`
            : 'Organize your sales'}
          icon={<Layers size={18} />}
          onClose={onClose}
        />

        <SheetBody>
          {!canEdit && <OfflineEditNote className="mb-3" />}
          {categories === undefined ? (
            <div className="flex flex-col gap-2.5" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-2xl" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Layers size={48} strokeWidth={1.5} />}
              title="No categories yet"
              message="Tap “Add category” below to create your first one, e.g. Drinks."
              showActions={false}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {sorted.map((cat) =>
                editingId === cat._id ? (
                  <EditCategoryRow
                    key={cat._id}
                    category={cat}
                    onSave={async (name, color) => {
                      if (!canEdit) throw new Error(OFFLINE_EDIT_MESSAGE)
                      await updateCat({ categoryId: cat._id as Id<'categories'>, name, color })
                      showToast('Category updated!', 'success')
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <CategoryRow
                    key={cat._id}
                    category={cat}
                    salesCount={salesCounts ? (salesCountByCategoryId.get(cat._id) ?? 0) : undefined}
                    onView={() => setViewingCat(cat)}
                    onEdit={whenOnline(() => setEditingId(cat._id))}
                    onDelete={whenOnline(() => setDeletingCat(cat))}
                  />
                ),
              )}
            </ul>
          )}
        </SheetBody>

        <SheetFooter>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={cn(btnSecondary, 'flex-1')}>
              Done
            </button>
            {onAddCategory && (
              <button type="button" onClick={whenOnline(onAddCategory)} className={cn(btnPrimary, 'flex-1')}>
                <Plus size={18} /> Add category
              </button>
            )}
          </div>
        </SheetFooter>
      </Sheet>

      {viewingCat && (
        <CategorySalesModal category={viewingCat} onClose={() => setViewingCat(null)} />
      )}

      {deletingCat && (
        <ConfirmModal
          title="Delete Category"
          message={`Delete "${deletingCat.name}"? This won't delete any sales linked to it.`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeletingCat(null)}
        />
      )}
    </>
  )
}

/* ─── category row ─── */

function CategoryRow({
  category,
  salesCount,
  onView,
  onEdit,
  onDelete,
}: {
  category: Category
  salesCount: number | undefined
  onView:   () => void
  onEdit:   () => void
  onDelete: () => void
}) {
  const iconBtn = 'w-11 h-11 rounded-full flex items-center justify-center active:scale-[0.97] transition-all'
  return (
    <li className="flex items-center gap-1 pl-2 pr-1 py-1.5 rounded-2xl border border-border/70 bg-card">
      <button
        type="button"
        onClick={onView}
        aria-label={`View sales for ${category.name}`}
        className="flex-1 min-w-0 flex items-center gap-3 min-h-12 px-1.5 rounded-xl text-left hover:bg-muted/50 active:scale-[0.97] transition-all"
      >
        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: category.color }} aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-foreground truncate">{category.name}</span>
          {salesCount === undefined ? (
            <span className="block skeleton h-3 w-16 rounded-full mt-1" aria-hidden />
          ) : (
            <span className="block text-[13px] text-muted-foreground tabular">
              {salesCount} sale{salesCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <Eye size={16} className="text-muted-foreground shrink-0" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${category.name}`}
        className={cn(iconBtn, 'text-muted-foreground hover:text-foreground hover:bg-muted')}
      >
        <Pencil size={18} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${category.name}`}
        className={cn(iconBtn, 'text-muted-foreground hover:text-negative hover:bg-negative/10')}
      >
        <Trash2 size={18} />
      </button>
    </li>
  )
}

/* ─── inline edit row ─── */

function EditCategoryRow({
  category,
  onSave,
  onCancel,
}: {
  category: Category
  onSave:   (name: string, color: string) => Promise<void>
  onCancel: () => void
}) {
  const [name,   setName]   = useState(category.name)
  const [color,  setColor]  = useState<string>(category.color)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const { showToast } = useToast()
  const uid = useId()

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (name.trim() === category.name && color === category.color) {
      showToast('No fields were updated.', 'info')
      return
    }
    setSaving(true)
    try { await onSave(name.trim(), color) }
    catch (e) {
      const message = getErrorMessage(e, 'Could not save. Try again.')
      setError(message)
      showToast(message, 'error')
    }
    finally { setSaving(false) }
  }

  return (
    <motion.li
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.16 }}
      className="rounded-3xl p-4 flex flex-col gap-3.5 border-2"
      style={{ borderColor: color }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-name`} className="sr-only">Category name</label>
        <input
          id={`${uid}-name`}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          maxLength={CATEGORY_NAME_MAX}
          placeholder="Category name"
          autoFocus
          disabled={saving}
          aria-invalid={error ? true : undefined}
          className={cn(inputBase, error && inputInvalid)}
        />
        {error && (
          <p className={fieldError} role="alert">
            <AlertCircle size={16} /> {error}
          </p>
        )}
      </div>

      <span id={`${uid}-color`} className="sr-only">Colour</span>
      <ColorSwatches value={color} onChange={setColor} labelledBy={`${uid}-color`} disabled={saving} />

      <div className="flex gap-2.5">
        <button type="button" onClick={onCancel} disabled={saving} className={cn(btnOutline, 'flex-1')}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving} className={cn(btnPrimary, 'flex-1')}>
          {saving
            ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
            : <><Check size={18} /> Save</>}
        </button>
      </div>
    </motion.li>
  )
}
