import { useState, useId } from 'react'
import { Check, ChevronDown, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import Sheet, { SheetBody, SheetHeader } from './Sheet'

interface CategorySelectProps {
  categories: { _id: string; name: string; color: string }[]
  value:      string
  onChange:   (categoryId: string) => void
  disabled?:  boolean
  id?:        string
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  /** Extra classes for the trigger button */
  triggerClassName?: string
}

/**
 * Category picker: a field-like trigger that opens a bottom sheet with big,
 * thumb-friendly rows (a dropdown inside a scrolling sheet gets clipped).
 */
export default function CategorySelect({
  categories,
  value,
  onChange,
  disabled = false,
  id: idProp,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  triggerClassName,
}: CategorySelectProps) {
  const autoId = useId()
  const btnId = idProp ?? `${autoId}-btn`
  const titleId = `${autoId}-title`
  const [open, setOpen] = useState(false)

  const selected = value ? categories.find((c) => c._id === value) : undefined
  const label = selected?.name ?? 'No category'

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        id={btnId}
        disabled={disabled}
        aria-label={ariaLabelledBy ? undefined : `${ariaLabel ?? 'Category'}: ${label}`}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${btnId}-value` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen(true) }}
        className={cn(
          'flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border border-input bg-background px-4 text-left text-base font-medium text-foreground',
          'hover:bg-muted/40 active:scale-[0.97] transition-all duration-150',
          'disabled:opacity-50 disabled:pointer-events-none',
          !selected && 'text-muted-foreground',
          triggerClassName,
        )}
      >
        <span className="truncate flex items-center gap-2.5 min-w-0">
          {selected ? (
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selected.color }} aria-hidden />
          ) : (
            <Tag size={16} className="shrink-0" aria-hidden />
          )}
          <span id={`${btnId}-value`} className="truncate">{label}</span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} labelledBy={titleId} layer={700} size="sm">
          <SheetHeader
            titleId={titleId}
            title="Choose category"
            icon={<Tag size={18} />}
            onClose={() => setOpen(false)}
          />
          <SheetBody className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <ul role="listbox" aria-labelledby={titleId} className="flex flex-col gap-1">
              <Option selected={value === ''} onSelect={() => choose('')}>
                <span className="w-3 h-3 rounded-full shrink-0 border-2 border-muted-foreground/40" aria-hidden />
                <span className="text-muted-foreground">No category</span>
              </Option>
              {categories.map((c) => (
                <Option key={c._id} selected={value === c._id} onSelect={() => choose(c._id)}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden />
                  <span className="truncate text-foreground">{c.name}</span>
                </Option>
              ))}
            </ul>
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center pt-3">
                No categories yet. Add one from the + menu.
              </p>
            )}
          </SheetBody>
        </Sheet>
      )}
    </div>
  )
}

function Option({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'flex w-full min-h-12 items-center gap-3 px-3 rounded-2xl text-base font-medium cursor-pointer',
        'hover:bg-muted/70 active:scale-[0.97] transition-all duration-150',
        selected && 'bg-primary/10',
      )}
    >
      {children}
      <span className="flex-1" />
      {selected && <Check size={18} className="text-primary shrink-0" aria-hidden />}
    </li>
  )
}
