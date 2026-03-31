import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely, resolving conflicts. Used by shadcn/ui components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a PKR currency amount: 1234 → "PKR 1,234" */
export function formatCurrency(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK')}`
}

/** Numeric amount only (no PKR prefix), for compact displays e.g. summary cards */
export function formatAmount(amount: number): string {
  return amount.toLocaleString('en-PK')
}

/**
 * Format a date timestamp relative to today.
 * - today's date    → "Today"
 * - yesterday       → "Yesterday"
 * - other dates     → "Mon, 12 Mar"
 */
export function formatDate(timestamp: number): string {
  const date  = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()

  if (isSameDay(date, today))     return 'Today'
  if (isSameDay(date, yesterday)) return 'Yesterday'

  return date.toLocaleDateString('en-PK', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
  })
}

/** Format a time from a Unix ms timestamp: → "2:45 PM" */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-PK', {
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Return a time-of-day greeting */
export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** YYYY-MM-DD in the user's local calendar (for chart keys and grouping). */
export function toLocalDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** IANA timezone for Convex day bucketing; falls back to UTC. */
export function getClientTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && tz.length > 0 ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `input type="date"` value from start-of-day ms in local time. */
export function toDateInputValue(startOfDayMs: number): string {
  return toLocalDateKey(startOfDayMs)
}

/** Local midnight ms from `YYYY-MM-DD` (from date input). */
export function parseDateInputToStartOfDay(isoDate: string): number {
  const [y, mo, d] = isoDate.split('-').map(Number)
  if (!y || !mo || !d) return startOfDay()
  return startOfDay(new Date(y, mo - 1, d))
}

/** Local start of today — latest calendar day allowed for recording sales. */
export function maxSaleDateMs(): number {
  return startOfDay()
}

/** Clamp a start-of-day timestamp so it is not after local today. */
export function clampSaleDateToTodayMs(ms: number): number {
  const cap = maxSaleDateMs()
  return ms > cap ? cap : ms
}

/** Parse date input and clamp to today if the user picked a future day. */
export function parseSaleDateInputClamped(isoDate: string): number {
  return clampSaleDateToTodayMs(parseDateInputToStartOfDay(isoDate))
}

/** Get start of day (midnight) in Unix ms */
export function startOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Get end of day (23:59:59.999) in Unix ms */
export function endOfDay(date: Date = new Date()): number {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Get the Monday of the current week at midnight in Unix ms */
export function startOfWeek(date: Date = new Date()): number {
  const d = new Date(date)
  const day = d.getDay()           // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Get the Sunday of the current week at end-of-day in Unix ms */
export function endOfWeek(date: Date = new Date()): number {
  const d = new Date(startOfWeek(date))
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Get start of the current month at midnight */
export function startOfMonth(date: Date = new Date()): number {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  return d.getTime()
}

/** Get end of the current month at end-of-day */
export function endOfMonth(date: Date = new Date()): number {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Get start of the provided/current year at midnight. */
export function startOfYear(date: Date = new Date()): number {
  const d = new Date(date.getFullYear(), 0, 1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Get end of the provided/current year at end-of-day. */
export function endOfYear(date: Date = new Date()): number {
  const d = new Date(date.getFullYear(), 11, 31)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
