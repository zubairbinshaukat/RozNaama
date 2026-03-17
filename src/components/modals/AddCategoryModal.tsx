import { useState, useRef, useEffect } from 'react'
import { X, Check, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateCategory } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import { CATEGORY_COLORS } from '@/lib/constants'

interface AddCategoryModalProps {
  onClose: () => void
}

export default function AddCategoryModal({ onClose }: AddCategoryModalProps) {
  const [name,    setName]    = useState('')
  const [color,   setColor]   = useState<string>(CATEGORY_COLORS[0])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const createCategory = useCreateCategory()
  const { showToast }  = useToast()
  const nameRef        = useRef<HTMLInputElement>(null)

  // Autofocus name input on open
  useEffect(() => { nameRef.current?.focus() }, [])

  // Trap Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Category name is required.'); return }

    setSaving(true)
    setError(null)

    try {
      await createCategory({ name: name.trim(), color })
      showToast('Category added!', 'success')
      onClose()
    } catch {
      setError('Could not save category. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-category-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-modal-backdrop"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-modal-content">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <h2 id="add-category-title" className="text-base font-semibold text-foreground">
            Add Category
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-5">
          {/* Name field */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cat-name" className="text-sm font-medium text-foreground">
              Category Name <span aria-hidden className="text-destructive">*</span>
            </label>
            <input
              id="cat-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Electronics, Food, Clothing…"
              autoComplete="off"
              maxLength={40}
              className={cn(
                'w-full h-11 px-3 rounded-lg border bg-background text-foreground text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                'transition-shadow',
                error && 'border-destructive focus:ring-destructive/40',
              )}
            />
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
                <AlertCircle size={12} /> {error}
              </p>
            )}
          </div>

          {/* Color swatches */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Color</label>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Select color">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center',
                    'transition-all duration-150 active:scale-90',
                    color === c
                      ? 'ring-2 ring-offset-2 ring-offset-card scale-110'
                      : 'hover:scale-105',
                  )}
                  style={{ backgroundColor: c, outlineColor: c }}
                >
                  {color === c && <Check size={16} className="text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1 active:scale-[0.97]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97]"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><Check size={16} /> Save Category</>
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
