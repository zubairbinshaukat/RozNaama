import { useState, useRef, useEffect } from 'react'
import { X, Check, Loader2, AlertCircle, Palette } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateCategory } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import { CATEGORY_COLORS } from '@/lib/constants'

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

interface AddCategoryModalProps {
  onClose: () => void
}

export default function AddCategoryModal({ onClose }: AddCategoryModalProps) {
  const [name,   setName]   = useState('')
  const [color,  setColor]  = useState<string>(CATEGORY_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const createCategory = useCreateCategory()
  const { showToast }  = useToast()
  const nameRef        = useRef<HTMLInputElement>(null)

  const { r, g, b } = hexToRgb(color)

  useEffect(() => { nameRef.current?.focus() }, [])

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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-md bg-card border border-border/60 rounded-3xl overflow-hidden"
        style={{
          boxShadow: `
            0 2px 4px rgba(0,0,0,0.02),
            0 8px 20px rgba(0,0,0,0.06),
            0 24px 60px rgba(${r},${g},${b},0.10)
          `,
        }}
      >
        {/* Colored header band */}
        <div
          className="w-full pt-5 pb-6 px-5 relative"
          style={{
            background: `linear-gradient(135deg, rgba(${r},${g},${b},0.12) 0%, rgba(${r},${g},${b},0.03) 100%)`,
            transition: 'background 0.3s ease',
          }}
        >
          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-black/5 active:scale-95 transition-all"
          >
            <X size={18} strokeWidth={2} />
          </button>

          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300"
              style={{
                background: `linear-gradient(135deg, rgba(${r},${g},${b},0.20), rgba(${r},${g},${b},0.08))`,
                boxShadow: `0 4px 12px rgba(${r},${g},${b},0.12)`,
              }}
            >
              <Palette size={20} style={{ color }} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="add-category-title" className="text-base font-bold text-foreground tracking-tight">
                Add Category
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Organize your sales
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5 pt-4 flex flex-col gap-5">
          {/* Name field */}
          <div className="flex flex-col gap-2">
            <label htmlFor="cat-name" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Category Name <span aria-hidden className="text-destructive">*</span>
            </label>
            <input
              id="cat-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              placeholder="e.g. Electronics, Food, Clothing…"
              autoComplete="off"
              maxLength={40}
              className={cn(
                'w-full h-11 px-3.5 rounded-xl border bg-muted/15 text-foreground text-sm font-medium',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent',
                'transition-all',
                error && 'border-destructive focus:ring-destructive/30',
              )}
            />
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-1.5 text-xs text-destructive font-medium"
                role="alert"
              >
                <AlertCircle size={12} /> {error}
              </motion.p>
            )}
          </div>

          {/* Color swatches */}
          <div className="flex flex-col gap-2.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Color
            </label>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Select color">
              {CATEGORY_COLORS.map((c) => {
                const isActive = color === c
                return (
                  <motion.button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={`Color ${c}`}
                    onClick={() => setColor(c)}
                    whileTap={{ scale: 0.9 }}
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center',
                      'transition-all duration-200',
                      isActive
                        ? 'ring-2 ring-offset-2 ring-offset-card scale-110'
                        : 'opacity-65 hover:opacity-100 hover:scale-110',
                    )}
                    style={{
                      backgroundColor: c,
                      ...(isActive ? { ringColor: c } : {}),
                    }}
                  >
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                      >
                        <Check size={16} className="text-white drop-shadow-sm" strokeWidth={3} />
                      </motion.div>
                    )}
                  </motion.button>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl active:scale-[0.97] transition-transform"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 h-11 rounded-xl bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97] transition-all"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><Check size={16} /> Save Category</>
              }
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}