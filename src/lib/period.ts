/**
 * Period math for the dashboard's day / week / month / year navigation.
 *
 * Every range is whole local days (00:00:00.000 → 23:59:59.999) — the
 * backend's fast `dailyTotals` path only kicks in for aligned ranges.
 * Weeks run Monday → Sunday, like `startOfWeek`. Functions take `now` so
 * tests can pin "today".
 */
import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  MIN_ENTRY_DATE_MS,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './utils'
import { dateKeyToLocalMs } from './dayGroups'

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const
/** Sunday-first, matching `Date#getDay()`. */
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type Range = { start: number; end: number }
export type PeriodKind = 'day' | 'week' | 'month'

/** Earliest day the navigation can reach (same floor as the entry pickers). */
export const MIN_PERIOD_DAY_MS = MIN_ENTRY_DATE_MS
export const MIN_YEAR = new Date(MIN_ENTRY_DATE_MS).getFullYear()

// ── Ranges ──────────────────────────────────────────────────────────────────

export function dayRange(ms: number): Range {
  return { start: startOfDay(new Date(ms)), end: endOfDay(new Date(ms)) }
}

export function weekRange(ms: number): Range {
  return { start: startOfWeek(new Date(ms)), end: endOfWeek(new Date(ms)) }
}

export function monthRange(ms: number): Range {
  return { start: startOfMonth(new Date(ms)), end: endOfMonth(new Date(ms)) }
}

/** Start (local midnight) of the day / week / month containing `ms`. */
export function periodStart(kind: PeriodKind, ms: number): number {
  if (kind === 'day') return startOfDay(new Date(ms))
  if (kind === 'week') return startOfWeek(new Date(ms))
  return startOfMonth(new Date(ms))
}

/** Start of the period `n` steps away (negative = older). DST-safe. */
export function shiftPeriod(kind: PeriodKind, ms: number, n: number): number {
  const start = periodStart(kind, ms)
  if (kind === 'day') return addDays(start, n)
  if (kind === 'week') return startOfWeek(new Date(addDays(start, 7 * n)))
  const d = new Date(start)
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime()
}

export function isCurrentPeriod(kind: PeriodKind, ms: number, now: number = Date.now()): boolean {
  return periodStart(kind, ms) === periodStart(kind, now)
}

/** Next is allowed only while the period is before the current one (no future). */
export function canGoNext(kind: PeriodKind, ms: number, now: number = Date.now()): boolean {
  return periodStart(kind, ms) < periodStart(kind, now)
}

/** Previous is allowed while the older period still contains a selectable day. */
export function canGoPrev(kind: PeriodKind, ms: number): boolean {
  return periodStart(kind, ms) > periodStart(kind, MIN_PERIOD_DAY_MS)
}

export function daysInMonth(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Newest-first week starts: the current week, then `count - 1` older ones (never before the floor). */
export function recentWeeks(count: number, now: number = Date.now()): number[] {
  const weeks: number[] = []
  let w = periodStart('week', now)
  const floor = periodStart('week', MIN_PERIOD_DAY_MS)
  while (weeks.length < count && w >= floor) {
    weeks.push(w)
    w = shiftPeriod('week', w, -1)
  }
  return weeks
}

/** Total number of weeks between the floor and now (for "Show more"). */
export function weekCountSinceFloor(now: number = Date.now()): number {
  const floor = periodStart('week', MIN_PERIOD_DAY_MS)
  const current = periodStart('week', now)
  return Math.round((current - floor) / (7 * 86_400_000)) + 1
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "Mon, 16 Nov" (+ " 2025" when `withYear`). */
export function shortDayText(ms: number, withYear = false): string {
  const d = new Date(ms)
  const base = `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  return withYear ? `${base} ${d.getFullYear()}` : base
}

/** "Today" / "Yesterday" / "Mon, 16 Nov" (year added outside the current year). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const day = startOfDay(new Date(ms))
  const today = startOfDay(new Date(now))
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  return shortDayText(day, new Date(day).getFullYear() !== new Date(now).getFullYear())
}

/** "16–22 Nov", "27 Oct – 2 Nov", "29 Dec 2025 – 4 Jan 2026" (year shown outside the current year). */
export function weekRangeText(ms: number, now: number = Date.now()): string {
  const start = periodStart('week', ms)
  const s = new Date(start)
  const e = new Date(addDays(start, 6))
  const nowYear = new Date(now).getFullYear()
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`
  }
  const year = e.getFullYear() !== nowYear ? ` ${e.getFullYear()}` : ''
  if (s.getMonth() === e.getMonth()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}${year}`
  }
  return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}${year}`
}

/** "This week" / "Last week" / "2–8 Nov". */
export function weekLabel(ms: number, now: number = Date.now()): string {
  const w = periodStart('week', ms)
  const current = periodStart('week', now)
  if (w === current) return 'This week'
  if (w === shiftPeriod('week', current, -1)) return 'Last week'
  return weekRangeText(w, now)
}

/** "November 2026". */
export function monthNameText(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
}

/** "This month" / "October" (same year) / "October 2025". */
export function monthLabel(ms: number, now: number = Date.now()): string {
  if (isCurrentPeriod('month', ms, now)) return 'This month'
  const d = new Date(ms)
  return d.getFullYear() === new Date(now).getFullYear() ? MONTHS_LONG[d.getMonth()]! : monthNameText(ms)
}

/** "This year" / "2025". */
export function yearLabel(year: number, now: number = Date.now()): string {
  return year === new Date(now).getFullYear() ? 'This year' : String(year)
}

// ── Per-view selection ──────────────────────────────────────────────────────

export type PeriodView = 'daily' | 'weekly' | 'monthly' | 'yearly'

/**
 * What each dashboard view shows. `null` = the current period, so a view left
 * on "today" follows the clock past midnight. Days / weeks / months are the
 * period's start (local midnight); years are the calendar year.
 */
export type PeriodSelection = Record<PeriodView, number | null>

export const CURRENT_SELECTION: PeriodSelection = { daily: null, weekly: null, monthly: null, yearly: null }

const VIEW_KIND: Record<Exclude<PeriodView, 'yearly'>, PeriodKind> = { daily: 'day', weekly: 'week', monthly: 'month' }

export function resolveSelection(sel: PeriodSelection, now: number = Date.now()): Record<PeriodView, number> {
  return {
    daily:   sel.daily ?? periodStart('day', now),
    weekly:  sel.weekly ?? periodStart('week', now),
    monthly: sel.monthly ?? periodStart('month', now),
    yearly:  sel.yearly ?? new Date(now).getFullYear(),
  }
}

/** Store a picked value: normalised to its period start, `null` when it is the current period. */
export function selectPeriod(
  sel: PeriodSelection,
  view: PeriodView,
  value: number,
  now: number = Date.now(),
): PeriodSelection {
  if (view === 'yearly') {
    return { ...sel, yearly: value === new Date(now).getFullYear() ? null : value }
  }
  const kind = VIEW_KIND[view]
  const start = periodStart(kind, value)
  return { ...sel, [view]: start >= periodStart(kind, now) ? null : start }
}

// ── Stats args ──────────────────────────────────────────────────────────────

export type StatsRanges = {
  todayStart: number
  todayEnd:   number
  weekStart:  number
  weekEnd:    number
  monthStart: number
  monthEnd:   number
}

/**
 * `getStats` ranges around one "focus" day: that day, its week and its month.
 * The union spans at most ~37 days, well inside the backend's 93-day fast path.
 */
export function statsRangesForDay(focusDay: number): StatsRanges {
  const d = dayRange(focusDay)
  const w = weekRange(focusDay)
  const m = monthRange(focusDay)
  return {
    todayStart: d.start, todayEnd: d.end,
    weekStart:  w.start, weekEnd:  w.end,
    monthStart: m.start, monthEnd: m.end,
  }
}

/** Today when it lies inside `range`, otherwise the range's last day. */
export function focusDayIn(range: Range, now: number = Date.now()): number {
  const today = startOfDay(new Date(now))
  if (today >= range.start && today <= range.end) return today
  return startOfDay(new Date(Math.min(range.end, today)))
}

// ── Chart helpers ───────────────────────────────────────────────────────────

/** Day with the highest positive total, labelled for the summary; null when none. */
export function bestDayOf(
  totals: readonly { date: string; total: number }[],
  format: 'weekday' | 'date',
): { label: string; total: number } | null {
  let best: { date: string; total: number } | null = null
  for (const t of totals) {
    if (t.total > 0 && (best === null || t.total > best.total)) best = t
  }
  if (!best) return null
  const ms = dateKeyToLocalMs(best.date)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const label = format === 'weekday'
    ? WEEKDAYS_SHORT[d.getDay()]!
    : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  return { label, total: best.total }
}
