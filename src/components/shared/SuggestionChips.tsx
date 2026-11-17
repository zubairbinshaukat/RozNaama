import { History, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeKey } from '@/lib/entryHistory'

interface SuggestionChipsProps {
  /** Chip labels, already ranked. Nothing renders when empty. */
  items:      readonly string[]
  /** What the field currently holds; picks the search icon and marks an exact match. */
  query:      string
  onPick:     (label: string) => void
  /** Removes one suggestion (× button, or Delete/Backspace on a focused chip). */
  onRemove?:  (label: string) => void
  disabled?:  boolean
  /** Accessible name of the row, e.g. "Recent items". */
  'aria-label': string
}

/**
 * One horizontally scrolling row of past entries under a text field.
 * Names only (no amounts) to keep the sheet calm; 44px tap targets.
 */
export default function SuggestionChips({
  items,
  query,
  onPick,
  onRemove,
  disabled = false,
  'aria-label': ariaLabel,
}: SuggestionChipsProps) {
  if (items.length === 0) return null
  const searching = query.trim() !== ''
  const current = normalizeKey(query)
  const Icon = searching ? Search : History

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      <div
        role="group"
        aria-label={ariaLabel}
        className="flex flex-1 min-w-0 gap-2 overflow-x-auto no-scrollbar -mr-1 pr-1"
      >
        {items.map((label) => {
          const active = normalizeKey(label) === current
          return (
            <span
              key={label}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border transition-colors',
                active ? 'border-primary/50 bg-primary/10' : 'border-border bg-card',
                disabled && 'opacity-40',
              )}
            >
              <button
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`Use ${label}`}
                onClick={() => onPick(label)}
                onKeyDown={(e) => {
                  if (onRemove && (e.key === 'Delete' || e.key === 'Backspace')) {
                    e.preventDefault()
                    onRemove(label)
                  }
                }}
                className={cn(
                  'min-h-11 max-w-[14rem] truncate rounded-full text-sm font-semibold text-foreground',
                  'active:scale-[0.97] transition-all duration-150 disabled:pointer-events-none',
                  onRemove ? 'pl-4 pr-1' : 'px-4',
                )}
              >
                {label}
              </button>
              {onRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${label} from suggestions`}
                  onClick={() => onRemove(label)}
                  className="w-10 h-11 -ml-0.5 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all disabled:pointer-events-none"
                >
                  <X size={14} />
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
