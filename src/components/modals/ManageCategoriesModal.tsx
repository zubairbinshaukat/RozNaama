import { useState, useEffect } from 'react'
import { X, Pencil, Trash2, Check, Loader2, AlertCircle, Layers, Eye } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCategories, useUpdateCategory, useRemoveCategory } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import { CATEGORY_COLORS } from '@/lib/constants'
import ConfirmModal from './ConfirmModal'
import CategorySalesModal from './CategorySalesModal'
import type { Category } from '@/hooks/useCategories'
import type { Id } from '../../../convex/_generated/dataModel'

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

interface ManageCategoriesModalProps {
  onClose: () => void
}

export default function ManageCategoriesModal({ onClose }: ManageCategoriesModalProps) {
  const categories    = useCategories()
  const updateCat     = useUpdateCategory()
  const removeCat     = useRemoveCategory()
  const { showToast } = useToast()

  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
  const [viewingCat,  setViewingCat]  = useState<Category | null>(null)
  const [deleting,    setDeleting]    = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleDelete = async () => {
    if (!deletingCat) return
    setDeleting(true)
    try {
      await removeCat({ categoryId: deletingCat._id })
      showToast('Category deleted', 'success')
      setDeletingCat(null)
    } catch {
      showToast('Could not delete category. Try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const sorted = categories ? [...categories].sort((a, b) => a.createdAt - b.createdAt) : []

  return (
    <>
      <div
        className="fixed inset-0 z-500 flex items-end sm:items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-cat-title"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />

        {/* Panel */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="relative w-full max-w-md bg-card border border-border/60 rounded-3xl max-h-[85dvh] flex flex-col overflow-hidden"
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
              <Layers size={18} className="text-primary" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="manage-cat-title" className="text-base font-bold text-foreground tracking-tight">
                Categories
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sorted.length > 0
                  ? `${sorted.length} categor${sorted.length === 1 ? 'y' : 'ies'}`
                  : 'Organize your sales'}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Divider */}
          <div className="h-px bg-border/50 mx-5" />

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-4 py-4">
            {categories === undefined ? (
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl bg-muted/40 animate-pulse"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="flex flex-col items-center justify-center py-14 gap-4 text-center"
              >
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary/12 via-primary/4 to-transparent flex items-center justify-center border border-primary/8"
                >
                  <Layers size={26} className="text-primary/40" strokeWidth={1.5} />
                </motion.div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">No categories yet</p>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-[220px]">
                    Add one using the <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold align-middle">+</span> button
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-2">
                {sorted.map((cat, i) =>
                  editingId === cat._id ? (
                    <EditCategoryRow
                      key={cat._id}
                      category={cat}
                      onSave={async (name, color) => {
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
                      index={i}
                      onView={() => setViewingCat(cat)}
                      onEdit={() => setEditingId(cat._id)}
                      onDelete={() => setDeletingCat(cat)}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="w-full h-11 rounded-xl text-sm font-semibold active:scale-[0.97] transition-transform"
            >
              Done
            </Button>
          </div>
        </motion.div>
      </div>

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
  index,
  onView,
  onEdit,
  onDelete,
}: {
  category: Category
  index:    number
  onView:   () => void
  onEdit:   () => void
  onDelete: () => void
}) {
  const { r, g, b } = hexToRgb(category.color)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.03,
        duration: 0.3,
        ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
      }}
      className="group flex items-center gap-3 px-3.5 py-3 rounded-2xl transition-all duration-200 hover:bg-muted/25"
      style={{
        boxShadow: `0 1px 3px rgba(0,0,0,0.02), 0 0 0 1px rgba(${r},${g},${b},0.06)`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px rgba(${r},${g},${b},0.12)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `0 1px 3px rgba(0,0,0,0.02), 0 0 0 1px rgba(${r},${g},${b},0.06)`
      }}
    >
      {/* Color indicator */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: `linear-gradient(135deg, rgba(${r},${g},${b},0.16), rgba(${r},${g},${b},0.06))`,
          boxShadow: `0 2px 6px rgba(${r},${g},${b},0.10)`,
        }}
      >
        <span
          className="w-3.5 h-3.5 rounded-full"
          style={{ backgroundColor: category.color }}
        />
      </div>

      {/* Name */}
      <span className="flex-1 text-sm font-semibold text-foreground truncate tracking-tight">
        {category.name}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onView}
          aria-label={`View sales for ${category.name}`}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
        >
          <Eye size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${category.name}`}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
        >
          <Pencil size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${category.name}`}
          className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/8 active:scale-95 transition-all"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </motion.div>
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

  const { r, g, b } = hexToRgb(color)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (name.trim() === category.name && color === category.color) {
      showToast('No fields were updated.', 'info')
      return
    }
    setSaving(true)
    try { await onSave(name.trim(), color) }
    catch { setError('Could not save. Try again.') }
    finally { setSaving(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl p-4 flex flex-col gap-3.5"
      style={{
        background: `linear-gradient(135deg, rgba(${r},${g},${b},0.06) 0%, rgba(${r},${g},${b},0.02) 100%)`,
        boxShadow: `0 0 0 1.5px rgba(${r},${g},${b},0.20), 0 4px 12px rgba(${r},${g},${b},0.08)`,
      }}
    >
      {/* Name input */}
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          maxLength={40}
          placeholder="Category name"
          autoFocus
          className={cn(
            'w-full h-11 px-3.5 rounded-xl border bg-card text-sm font-medium text-foreground',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent transition-all',
            error && 'border-destructive focus:ring-destructive/30',
          )}
        />
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-destructive font-medium" role="alert">
            <AlertCircle size={12} /> {error}
          </p>
        )}
      </div>

      {/* Color swatches */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pick color">
        {CATEGORY_COLORS.map((c) => {
          const isActive = color === c
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setColor(c)}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90',
                isActive
                  ? 'ring-2 ring-offset-2 ring-offset-card scale-110'
                  : 'hover:scale-110 opacity-70 hover:opacity-100',
              )}
              style={{
                backgroundColor: c,
                ...(isActive ? { ringColor: c } : {}),
              }}
            >
              {isActive && <Check size={14} className="text-white drop-shadow-sm" strokeWidth={3} />}
            </button>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 h-10 rounded-xl active:scale-[0.97] transition-transform"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1 h-10 rounded-xl bg-gradient-brand hover:opacity-90 text-white border-0 gap-1.5 active:scale-[0.97] transition-all"
        >
          {saving
            ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
            : <><Check size={14} /> Save</>
          }
        </Button>
      </div>
    </motion.div>
  )
}