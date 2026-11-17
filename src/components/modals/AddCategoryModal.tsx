import { useState, useRef, useId } from 'react'
import { Check, Loader2, AlertCircle, Palette } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { useCreateCategory } from '@/hooks/useCategories'
import { useToast } from '@/components/shared/Toast'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { CATEGORY_COLORS, CATEGORY_NAME_MAX } from '@/lib/constants'
import { getErrorMessage } from '@/lib/errors'
import ColorSwatches from './ColorSwatches'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import OfflineEditNote from '@/components/shared/OfflineEditNote'

interface AddCategoryModalProps {
  onClose: () => void
}

export default function AddCategoryModal({ onClose }: AddCategoryModalProps) {
  const [name,   setName]   = useState('')
  const [color,  setColor]  = useState<string>(CATEGORY_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const createCategory = useCreateCategory()
  const canEdit        = useCanEditOnline()
  const { showToast }  = useToast()
  const titleId        = useId()
  const nameRef        = useRef<HTMLInputElement>(null)

  const close = () => { if (!saving) onClose() }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    if (!name.trim()) {
      setError('Give the category a name, e.g. Drinks.')
      nameRef.current?.focus()
      return
    }

    setSaving(true)
    setError(null)

    try {
      await createCategory({ name: name.trim(), color })
      showToast('Category added!', 'success')
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not save category. Please try again.')
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} initialFocusRef={nameRef}>
      <SheetHeader
        titleId={titleId}
        title="Add category"
        subtitle="Group similar items, e.g. Drinks or Snacks."
        icon={<Palette size={18} style={{ color }} />}
        onClose={close}
        closeDisabled={saving}
      />
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
        <SheetBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cat-name" className={fieldLabel}>Category name</label>
            <input
              id="cat-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              placeholder="e.g. Drinks, Snacks, Mobile accessories"
              autoComplete="off"
              maxLength={CATEGORY_NAME_MAX}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'cat-name-err' : undefined}
              className={cn(inputBase, error && inputInvalid)}
            />
            {error && (
              <motion.p
                id="cat-name-err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={fieldError}
                role="alert"
              >
                <AlertCircle size={16} /> {error}
              </motion.p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span id="cat-color-label" className={fieldLabel}>Colour</span>
            <ColorSwatches value={color} onChange={setColor} labelledBy="cat-color-label" disabled={saving} />
          </div>

          {/* Live preview */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 px-4 min-h-12">
            <span className="text-sm text-muted-foreground">Preview</span>
            <span
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold max-w-[70%] truncate"
              style={{ backgroundColor: `${color}22`, color }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
              <span className="truncate">{name.trim() || 'Category'}</span>
            </span>
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
                : <><Check size={18} /> Save category</>}
            </button>
          </div>
        </SheetFooter>
      </form>
    </Sheet>
  )
}
