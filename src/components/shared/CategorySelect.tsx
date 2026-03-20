import { useState, useRef, useEffect, useId } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
interface CategorySelectProps {
  categories: { _id: string; name: string; color: string }[]
  value:      string
  onChange:   (categoryId: string) => void
  disabled?:  boolean
  id?:        string
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  /** Classes for the trigger button (e.g. h-10 to match other inputs) */
  triggerClassName?: string
}

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
  const listId = `${autoId}-list`
  const btnId = idProp ?? `${autoId}-btn`

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = value ? categories.find((c) => c._id === value) : undefined
  const label = selected?.name ?? 'No category'

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current) return
      const t = e.target
      if (t instanceof Node && !rootRef.current.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close, { passive: true })
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={btnId}
        disabled={disabled}
        aria-label={ariaLabelledBy ? undefined : (ariaLabel ?? 'Category')}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-background px-2.5 text-left text-sm text-foreground',
          triggerClassName,
          'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow',
          'disabled:opacity-50 disabled:pointer-events-none',
          !selected && 'text-muted-foreground',
          'active:scale-[0.99]',
        )}
      >
        <span className="truncate flex items-center gap-2 min-w-0">
          {selected && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            'absolute z-[560] mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg',
          )}
        >
          <li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              onClick={() => { onChange(''); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm',
                'hover:bg-muted/80 active:bg-muted transition-colors',
                value === '' && 'bg-muted/50',
              )}
            >
              {value === '' ? <Check size={14} className="shrink-0 text-primary" /> : <span className="w-3.5 shrink-0" />}
              <span className="text-muted-foreground">No category</span>
            </button>
          </li>
          {categories.map((c) => {
            const isSel = value === c._id
            return (
              <li key={c._id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => { onChange(c._id); setOpen(false) }}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-foreground',
                    'hover:bg-muted/80 active:bg-muted transition-colors',
                    isSel && 'bg-muted/50',
                  )}
                >
                  {isSel ? <Check size={14} className="shrink-0 text-primary" /> : <span className="w-3.5 shrink-0" />}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
