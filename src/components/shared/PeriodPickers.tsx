import { useId, useState } from 'react'
import { CalendarDays, CalendarRange, Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import Sheet, { SheetBody, SheetHeader } from './Sheet'
import { cn, startOfDay } from '@/lib/utils'
import { btnSecondary } from '@/lib/ui'
import {
  MIN_YEAR,
  MONTHS_LONG,
  MONTHS_SHORT,
  periodStart,
  recentWeeks,
  weekCountSinceFloor,
  weekLabel,
  weekRangeText,
  yearLabel,
} from '@/lib/period'

const WEEKS_PER_PAGE = 12

const rowBase =
  'w-full flex items-center justify-between gap-3 min-h-12 px-4 rounded-2xl border text-left text-base font-semibold active:scale-[0.97] transition-all duration-150'
const rowIdle = 'border-border/70 bg-card text-foreground hover:bg-muted/60'
const rowActive = 'border-primary/40 bg-primary/10 text-foreground'

function SelectedMark({ selected }: { selected: boolean }) {
  return selected ? <Check size={18} className="text-primary shrink-0" aria-hidden /> : null
}

// ── Weeks ───────────────────────────────────────────────────────────────────

interface WeekPickerSheetProps {
  /** Any day inside the selected week. */
  value: number
  onSelect: (weekStartMs: number) => void
  onClose: () => void
  now?: number
}

/** Newest-first list of Monday–Sunday weeks, 12 at a time. */
export function WeekPickerSheet({ value, onSelect, onClose, now = startOfDay() }: WeekPickerSheetProps) {
  const titleId = useId()
  const selected = periodStart('week', value)
  // Open far enough down that the selected week is in the list.
  const [count, setCount] = useState(() => {
    const back = Math.round((periodStart('week', now) - selected) / (7 * 86_400_000)) + 1
    return Math.max(WEEKS_PER_PAGE, Math.ceil(back / WEEKS_PER_PAGE) * WEEKS_PER_PAGE)
  })
  const weeks = recentWeeks(count, now)
  const hasMore = count < weekCountSinceFloor(now)

  const pick = (w: number) => {
    onSelect(w)
    onClose()
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="sm">
      <SheetHeader titleId={titleId} title="Pick a week" subtitle="Monday to Sunday" icon={<CalendarDays size={18} />} onClose={onClose} />
      <SheetBody className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <ul className="flex flex-col gap-2">
          {weeks.map((w) => {
            const label = weekLabel(w, now)
            const range = weekRangeText(w, now)
            const text = label === range ? range : `${label} · ${range}`
            const isSel = w === selected
            return (
              <li key={w}>
                <button
                  type="button"
                  aria-pressed={isSel}
                  onClick={() => pick(w)}
                  className={cn(rowBase, isSel ? rowActive : rowIdle)}
                >
                  <span className="truncate">{text}</span>
                  <SelectedMark selected={isSel} />
                </button>
              </li>
            )
          })}
        </ul>
        {hasMore && (
          <button
            type="button"
            onClick={() => setCount((c) => c + WEEKS_PER_PAGE)}
            className={cn(btnSecondary, 'w-full mt-3')}
          >
            Show more
          </button>
        )}
      </SheetBody>
    </Sheet>
  )
}

// ── Months ──────────────────────────────────────────────────────────────────

interface MonthPickerSheetProps {
  /** Any day inside the selected month. */
  value: number
  onSelect: (monthStartMs: number) => void
  onClose: () => void
  now?: number
}

const yearBtn =
  'w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-30 disabled:pointer-events-none'

/** Jan…Dec grid for one year with a year switch; future months are disabled. */
export function MonthPickerSheet({ value, onSelect, onClose, now = startOfDay() }: MonthPickerSheetProps) {
  const titleId = useId()
  const yearId = useId()
  const selected = periodStart('month', value)
  const currentMonth = periodStart('month', now)
  const currentYear = new Date(now).getFullYear()
  const [year, setYear] = useState(() => new Date(value).getFullYear())

  const pick = (ms: number) => {
    onSelect(ms)
    onClose()
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="sm">
      <SheetHeader titleId={titleId} title="Pick a month" icon={<CalendarRange size={18} />} onClose={onClose} />
      <SheetBody className="flex flex-col gap-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            disabled={year <= MIN_YEAR}
            aria-label="Previous year"
            className={yearBtn}
          >
            <ChevronLeft size={18} />
          </button>
          <h3 id={yearId} aria-live="polite" className="text-base font-bold text-foreground tabular">{year}</h3>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= currentYear}
            aria-label="Next year"
            className={yearBtn}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div role="group" aria-labelledby={yearId} className="grid grid-cols-3 gap-2">
          {MONTHS_SHORT.map((short, i) => {
            const ms = new Date(year, i, 1).getTime()
            const future = ms > currentMonth
            const isSel = ms === selected
            const isCurrent = ms === currentMonth
            return (
              <button
                key={short}
                type="button"
                disabled={future}
                aria-pressed={isSel}
                aria-label={`${MONTHS_LONG[i]} ${year}${isCurrent ? ', this month' : ''}${future ? ', not available' : ''}`}
                onClick={() => pick(ms)}
                className={cn(
                  'min-h-12 rounded-2xl text-base font-semibold active:scale-[0.97] transition-all duration-150',
                  isSel
                    ? 'bg-primary text-primary-foreground shadow-glow-sm'
                    : isCurrent
                      ? 'text-primary ring-2 ring-inset ring-primary/60 hover:bg-primary/10'
                      : 'bg-muted/60 text-foreground hover:bg-muted',
                  future && 'bg-transparent text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                {short}
              </button>
            )
          })}
        </div>
      </SheetBody>
    </Sheet>
  )
}

// ── Years ───────────────────────────────────────────────────────────────────

interface YearPickerSheetProps {
  value: number
  /** Years to offer (any order; shown newest first). */
  years: readonly number[]
  onSelect: (year: number) => void
  onClose: () => void
  now?: number
}

/** Years with data, newest first. */
export function YearPickerSheet({ value, years, onSelect, onClose, now = startOfDay() }: YearPickerSheetProps) {
  const titleId = useId()
  const sorted = [...years].sort((a, b) => b - a)

  const pick = (y: number) => {
    onSelect(y)
    onClose()
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="sm">
      <SheetHeader titleId={titleId} title="Pick a year" icon={<CalendarIcon size={18} />} onClose={onClose} />
      <SheetBody className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <ul className="flex flex-col gap-2">
          {sorted.map((y) => {
            const label = yearLabel(y, now)
            const isSel = y === value
            return (
              <li key={y}>
                <button
                  type="button"
                  aria-pressed={isSel}
                  onClick={() => pick(y)}
                  className={cn(rowBase, isSel ? rowActive : rowIdle)}
                >
                  <span className="tabular">{label === String(y) ? y : `${label} · ${y}`}</span>
                  <SelectedMark selected={isSel} />
                </button>
              </li>
            )
          })}
        </ul>
      </SheetBody>
    </Sheet>
  )
}
