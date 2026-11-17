import { Fragment, useRef } from 'react'
import { Sun, CalendarDays, CalendarRange, Calendar, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { VIEWS, VIEW_LABELS, VIEW_PANEL_ID, viewTabId, type View } from '@/lib/views'

const ICONS: Record<View, LucideIcon> = {
  daily:   Sun,
  weekly:  CalendarDays,
  monthly: CalendarRange,
  yearly:  Calendar,
}

interface ViewTabsProps {
  active: View
  onChange: (view: View) => void
}

/** Arrow / Home / End keys move between tabs (WAI-ARIA tabs pattern, automatic activation). */
function useTabKeys(active: View, onChange: (v: View) => void, variant: 'top' | 'bottom') {
  const listRef = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = VIEWS.indexOf(active)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (idx + 1) % VIEWS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + VIEWS.length) % VIEWS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = VIEWS.length - 1
    if (next === null) return
    e.preventDefault()
    const view = VIEWS[next]!
    onChange(view)
    listRef.current?.querySelector<HTMLButtonElement>(`#${viewTabId(view, variant)}`)?.focus()
  }
  return { listRef, onKeyDown }
}

/** Segmented control above the content (tablet / desktop). */
export function SegmentedTabs({ active, onChange }: ViewTabsProps) {
  const { listRef, onKeyDown } = useTabKeys(active, onChange, 'top')
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Choose period"
      onKeyDown={onKeyDown}
      className="hidden sm:grid grid-cols-4 gap-1 p-1 rounded-2xl bg-muted border border-border/60"
    >
      {VIEWS.map((v) => {
        const Icon = ICONS[v]
        const selected = v === active
        return (
          <button
            key={v}
            id={viewTabId(v, 'top')}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={VIEW_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(v)}
            className={cn(
              'relative min-h-11 flex items-center justify-center gap-2 rounded-xl text-[15px] font-semibold',
              'transition-colors duration-150 active:scale-[0.97]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId="segmented-pill"
                transition={{ type: 'spring', damping: 30, stiffness: 420 }}
                className="absolute inset-0 rounded-xl bg-card shadow-card"
                aria-hidden
              />
            )}
            <Icon size={16} className="relative" aria-hidden />
            <span className="relative">{VIEW_LABELS[v]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Thumb-reachable tab bar fixed to the bottom of phones (Instagram / WhatsApp style). */
export function BottomNav({ active, onChange, reserveFabSpace }: ViewTabsProps & { reserveFabSpace: boolean }) {
  const { listRef, onKeyDown } = useTabKeys(active, onChange, 'bottom')
  return (
    <nav
      aria-label="Periods"
      className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/95 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Choose period"
        onKeyDown={onKeyDown}
        className={cn('grid h-16 px-1', reserveFabSpace ? 'grid-cols-5' : 'grid-cols-4')}
      >
        {VIEWS.map((v, i) => {
          const Icon = ICONS[v]
          const selected = v === active
          return (
            <Fragment key={v}>
            {/* Centre gap where the raised + button sits */}
            {reserveFabSpace && i === 2 && <span role="presentation" aria-hidden />}
            <button
              id={viewTabId(v, 'bottom')}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={VIEW_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(v)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 min-w-0 rounded-2xl',
                'text-xs font-semibold transition-colors duration-150 active:scale-[0.97]',
                selected ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex items-center justify-center w-14 h-8 rounded-full transition-colors duration-150',
                  selected && 'bg-primary/12',
                )}
                aria-hidden
              >
                <Icon size={18} strokeWidth={selected ? 2.4 : 2} />
              </span>
              <span className="truncate max-w-full">{VIEW_LABELS[v]}</span>
            </button>
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
}
