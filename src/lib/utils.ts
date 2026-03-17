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
