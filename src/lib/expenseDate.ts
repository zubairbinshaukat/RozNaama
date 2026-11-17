import { isSameLocalDay, startOfDay } from '@/lib/utils'

/** One-tap amounts for everyday shop costs. */
export const EXPENSE_QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000] as const

/**
 * Timestamp sent to `expenses.record`: now for today (keeps time-of-day like
 * before), local midnight for an earlier day (same convention as sales).
 */
export function expenseDateFor(dayStartMs: number, nowMs: number = Date.now()): number {
  return isSameLocalDay(dayStartMs, nowMs) ? nowMs : startOfDay(new Date(dayStartMs))
}
