import { useState, useEffect } from 'react'
import { X, Pencil, Trash2, Check, Loader2, AlertCircle, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCategories, useUpdateCategory, useRemoveCategory } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import { CATEGORY_COLORS } from '@/lib/constants'
import ConfirmModal from './ConfirmModal'
import type { Category } from '@/hooks/useCategories'
import type { Id } from '../../../convex/_generated/dataModel'

interface ManageCategoriesModalProps {
  onClose: () => void
}

export default function ManageCategoriesModal({ onClose }: ManageCategoriesModalProps) {
  const categories   = useCategories()
  const updateCat    = useUpdateCategory()
  const removeCat    = useRemoveCategory()
  const { showToast } = useToast()

  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
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
        <div
          className="absolute inset-0 bg-black/50 animate-modal-backdrop"
          onClick={onClose}
          aria-hidden
        />

        <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-modal-content max-h-[85dvh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
            <h2 id="manage-cat-title" className="text-base font-semibold text-foreground">
              Categories
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-5 py-4">
            {categories === undefined ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-14 rounded-xl" />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center">
                  <Layers size={22} className="text-muted-foreground/50" />
                </div>
                <div>
                  <p className="font-medium text-foreground">No categories yet</p>
                  <p className="text-sm text-muted-foreground mt-0.5">Add one using the + button</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sorted.map((cat) => (
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
                    <div
                      key={cat._id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:bg-muted/30 transition-colors"
                    >
                      <span
                        className="w-5 h-5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="flex-1 text-sm font-medium text-foreground truncate">
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setEditingId(cat._id)}
                          aria-label={`Edit ${cat.name}`}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeletingCat(cat)}
                          aria-label={`Delete ${cat.name}`}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-3 border-t border-border shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="w-full active:scale-[0.97]"
            >
              Done
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
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

// ── Inline edit row ──────────────────────────────────────────────────────────

function EditCategoryRow({
  category,
  onSave,
  onCancel,
}: {
  category: Category
  onSave:   (name: string, color: string) => Promise<void>
  onCancel: () => void
}) {
  const [name,    setName]    = useState(category.name)
  const [color,   setColor]   = useState<string>(category.color)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try { await onSave(name, color) }
    catch { setError('Could not save. Try again.') }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-background p-3 flex flex-col gap-3">
      {/* Name input */}
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          maxLength={40}
          placeholder="Category name"
          autoFocus
          className={cn(
            'w-full h-10 px-3 rounded-lg border bg-background text-sm text-foreground',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
            error && 'border-destructive focus:ring-destructive/40',
          )}
        />
        {error && (
          <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
            <AlertCircle size={11} /> {error}
          </p>
        )}
      </div>

      {/* Color swatches */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pick color">
        {CATEGORY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            onClick={() => setColor(c)}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90',
              color === c ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105',
            )}
            style={{ backgroundColor: c, outlineColor: c }}
          >
            {color === c && <Check size={13} className="text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="flex-1 active:scale-[0.97]">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1 bg-gradient-brand hover:opacity-90 text-white border-0 gap-1.5 active:scale-[0.97]"
        >
          {saving
            ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
            : <><Check size={14} /> Save</>
          }
        </Button>
      </div>
    </div>
  )
}
