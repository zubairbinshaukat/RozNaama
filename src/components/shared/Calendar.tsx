import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  addDays,
  cn,
  formatFullDate,
  formatMonthYear,
  isSameLocalDay,
  startOfDay,
} from '@/lib/utils'
import { useHorizontalTabSwipe } from '@/hooks/useHorizontalTabSwipe'

/** Monday-first, like the app's weeks (see `startOfWeek`). */
const WEEKDAYS = [
  { short: 'Mo', long: 'Monday' },
  { short: 'Tu', long: 'Tuesday' },
  { short: 'We', long: 'Wednesday' },
  { short: 'Th', long: 'Thursday' },
  { short: 'Fr', long: 'Friday' },
  { short: 'Sa', long: 'Saturday' },
  { short: 'Su', long: 'Sunday' },
] as const

type MonthRef = { year: number; month: number }

function monthOf(ms: number): MonthRef {
  const d = new Date(ms)
  return { year: d.getFullYear(), month: d.getMonth() }
}

function monthIndex(m: MonthRef): number {
  return m.year * 12 + m.month
}

function shiftMonth(m: MonthRef, delta: number): MonthRef {
  const d = new Date(m.year, m.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** Same day-of-month `delta` months away, clamped to that month's length. */
function shiftMonthKeepDay(ms: number, delta: number): number {
  const d = new Date(ms)
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return startOfDay(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)))
}

/** Monday = 0 … Sunday = 6 */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7
}

function clamp(ms: number, min: number, max: number): number {
  return ms < min ? min : ms > max ? max : ms
}

export interface CalendarProps {
  /** Selected day (local midnight ms). */
  value: number
  onSelect: (startOfDayMs: number) => void
  /** Latest selectable day (local midnight ms) — later days are disabled. */
  maxDate: number
  /** Earliest selectable day (local midnight ms). */
  minDate: number
  /** "Today" for highlighting; defaults to the real today. */
  todayMs?: number
}

/**
 * Month grid following the WAI-ARIA date-picker grid pattern: one tab stop,
 * arrows move by day/week, Home/End to week edges, PageUp/PageDown by month
 * (Shift = year), Enter/Space picks. Swipe left/right changes month.
 */
export default function Calendar({ value, onSelect, maxDate, minDate, todayMs }: CalendarProps) {
  const today = todayMs ?? startOfDay()
  const titleId = useId()
  const [focused, setFocused] = useState(() => clamp(startOfDay(new Date(value)), minDate, maxDate))
  const [view, setView] = useState<MonthRef>(() => monthOf(focused))
  const [direction, setDirection] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<HTMLDivElement>(null)
  /** Move DOM focus to the focused day after keyboard navigation. */
  const moveFocusRef = useRef(false)

  const canPrev = monthIndex(view) > monthIndex(monthOf(minDate))
  const canNext = monthIndex(view) < monthIndex(monthOf(maxDate))

  const goToMonth = (delta: number) => {
    const next = shiftMonth(view, delta)
    if (monthIndex(next) < monthIndex(monthOf(minDate)) || monthIndex(next) > monthIndex(monthOf(maxDate))) return
    setDirection(delta)
    setView(next)
    // Keep the roving tab stop inside the visible month.
    setFocused((f) => clamp(shiftMonthKeepDay(f, monthIndex(next) - monthIndex(monthOf(f))), minDate, maxDate))
  }

  useHorizontalTabSwipe(swipeRef, {
    enabled: true,
    onSwipeNext: () => goToMonth(1),
    onSwipePrev: () => goToMonth(-1),
  })

  useEffect(() => {
    if (!moveFocusRef.current) return
    moveFocusRef.current = false
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  }, [focused, view])

  const moveTo = (ms: number) => {
    const next = clamp(ms, minDate, maxDate)
    moveFocusRef.current = true
    setFocused(next)
    const nm = monthOf(next)
    if (monthIndex(nm) !== monthIndex(view)) {
      setDirection(monthIndex(nm) - monthIndex(view))
      setView(nm)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    switch (e.key) {
      case 'ArrowLeft':  next = addDays(focused, -1); break
      case 'ArrowRight': next = addDays(focused, 1); break
      case 'ArrowUp':    next = addDays(focused, -7); break
      case 'ArrowDown':  next = addDays(focused, 7); break
      case 'Home':       next = addDays(focused, -weekdayIndex(focused)); break
      case 'End':        next = addDays(focused, 6 - weekdayIndex(focused)); break
      case 'PageUp':     next = shiftMonthKeepDay(focused, e.shiftKey ? -12 : -1); break
      case 'PageDown':   next = shiftMonthKeepDay(focused, e.shiftKey ? 12 : 1); break
      default: return
    }
    e.preventDefault()
    moveTo(next)
  }

  // 6 rows × 7 columns, blanks outside the month (stable height, no jump).
  const weeks = useMemo(() => {
    const first = startOfDay(new Date(view.year, view.month, 1))
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
    const lead = weekdayIndex(first)
    const cells: (number | null)[] = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(startOfDay(new Date(view.year, view.month, d)))
    while (cells.length < 42) cells.push(null)
    const rows: (number | null)[][] = []
    for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [view])

  return (
    <div className="flex flex-col gap-3">
      {/* Month header */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goToMonth(-1)}
          disabled={!canPrev}
          aria-label="Previous month"
          className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft size={18} />
        </button>
        <h3 id={titleId} aria-live="polite" className="text-base font-bold text-foreground tracking-tight">
          {formatMonthYear(view.year, view.month)}
        </h3>
        <button
          type="button"
          onClick={() => goToMonth(1)}
          disabled={!canNext}
          aria-label="Next month"
          className="w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div ref={swipeRef} style={{ touchAction: 'pan-y' }}>
        <div role="grid" aria-labelledby={titleId} ref={gridRef} onKeyDown={onKeyDown} className="flex flex-col gap-1">
          <div role="row" className="grid grid-cols-7">
            {WEEKDAYS.map((w) => (
              <div
                key={w.short}
                role="columnheader"
                aria-label={w.long}
                className="h-8 flex items-center justify-center text-xs font-semibold text-muted-foreground"
              >
                {w.short}
              </div>
            ))}
          </div>

          <motion.div
            key={`${view.year}-${view.month}`}
            initial={{ opacity: 0, x: direction === 0 ? 0 : direction > 0 ? 24 : -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-1"
          >
            {weeks.map((row, r) => (
              <div role="row" key={r} className="grid grid-cols-7 gap-1">
                {row.map((day, c) => {
                  if (day === null) return <div role="gridcell" key={c} className="h-11" />
                  const selected = isSameLocalDay(day, value)
                  const isToday = isSameLocalDay(day, today)
                  const disabled = day > maxDate || day < minDate
                  const isFocusStop = day === focused
                  return (
                    <div role="gridcell" key={c} aria-selected={selected} className="flex justify-center">
                      <button
                        type="button"
                        tabIndex={isFocusStop ? 0 : -1}
                        disabled={disabled}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={`${formatFullDate(day)}${isToday ? ', today' : ''}${disabled ? ', not available' : ''}`}
                        onClick={() => onSelect(day)}
                        onFocus={() => { if (day !== focused) setFocused(day) }}
                        className={cn(
                          'w-11 h-11 rounded-full flex items-center justify-center text-base font-semibold tabular',
                          'transition-all duration-150 active:scale-[0.97]',
                          selected
                            ? 'bg-primary text-primary-foreground shadow-glow-sm'
                            : isToday
                              ? 'text-primary ring-2 ring-inset ring-primary/60 hover:bg-primary/10'
                              : 'text-foreground hover:bg-muted',
                          disabled && 'text-muted-foreground/35 line-through decoration-1 hover:bg-transparent cursor-not-allowed',
                        )}
                      >
                        {new Date(day).getDate()}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
