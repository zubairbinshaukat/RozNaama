/**
 * Read-only per-user numbers for the admin dashboard (convex/admin.ts).
 *
 * Every helper is bounded: a user whose summary tables are ready in the
 * requested zone is read from `dailyTotals` (≤ 31 rows per window) and
 * `userTotals`; any other user falls back to a capped scan of
 * saleSessions / expenses (newest first). When a cap is hit the result is
 * flagged `partial` (sums then cover the newest rows only).
 */
import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { dateKeyInTimeZone, zonedStartOfDayMs } from '../lib/time'
import {
  allTimeSumsIfReady,
  dailyRowsInKeyRange,
  nextDayKey,
  safe,
  safeDayKey,
  totalsGate,
} from './totals'

/** Calendar day `n` days after `dayKey` (negative = before); zone-independent. */
export function addDaysToKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y ?? NaN, (m ?? NaN) - 1, (d ?? NaN) + n)).toISOString().slice(0, 10)
}

/** Day-key windows (all inclusive, in the admin's zone) for "now". */
export type AdminWindows = {
  timeZone:      string
  todayKey:      string
  /** First day of the 7-day window (today and the 6 days before). */
  week7Key:      string
  /** First day of the 30-day window (today and the 29 days before). */
  days30Key:     string
  monthStartKey: string
  /** Start of today / of the month, and the end of today (exclusive), as UTC ms. */
  todayStartMs:  number
  monthStartMs:  number
  endMs:         number
}

export function adminWindows(nowMs: number, timeZone: string): AdminWindows {
  const todayKey = dateKeyInTimeZone(nowMs, timeZone)
  const monthStartKey = `${todayKey.slice(0, 7)}-01`
  return {
    timeZone,
    todayKey,
    week7Key:     addDaysToKey(todayKey, -6),
    days30Key:    addDaysToKey(todayKey, -29),
    monthStartKey,
    todayStartMs: zonedStartOfDayMs(todayKey, timeZone),
    monthStartMs: zonedStartOfDayMs(monthStartKey, timeZone),
    endMs:        zonedStartOfDayMs(nextDayKey(todayKey), timeZone),
  }
}

export type DayBucket = { sales: number; expenses: number; active: boolean }

export type DayBuckets = {
  days:    Map<string, DayBucket>
  /** Served from dailyTotals (summary tables ready in this zone). */
  fromTotals: boolean
  /** A scan cap was hit: sums cover the newest rows only. */
  partial: boolean
}

/**
 * Per-day sales / expense sums and activity for `[lowKey, highKey]` in
 * `timeZone`: dailyTotals when the user's totals are ready in that zone,
 * else at most `scanCap` sessions and `scanCap` expenses (newest first).
 */
export async function dayBuckets(
  ctx: QueryCtx,
  userId: Id<'users'>,
  timeZone: string,
  lowKey: string,
  highKey: string,
  scanCap: number,
): Promise<DayBuckets> {
  const days = new Map<string, DayBucket>()
  const bucket = (key: string): DayBucket => {
    let b = days.get(key)
    if (!b) {
      b = { sales: 0, expenses: 0, active: false }
      days.set(key, b)
    }
    return b
  }

  if (await totalsGate(ctx, userId, timeZone)) {
    for (const row of await dailyRowsInKeyRange(ctx, userId, lowKey, highKey)) {
      const b = bucket(row.dayKey)
      b.sales += safe(row.salesTotal)
      b.expenses += safe(row.expenseTotal)
      if (row.sessionCount > 0 || row.expenseCount > 0) b.active = true
    }
    return { days, fromTotals: true, partial: false }
  }

  const lowMs = zonedStartOfDayMs(lowKey, timeZone)
  const highMs = zonedStartOfDayMs(nextDayKey(highKey), timeZone)
  const [sessions, expenses] = await Promise.all([
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', userId).gte('sessionDate', lowMs).lt('sessionDate', highMs),
      )
      .order('desc')
      .take(scanCap + 1),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', userId).gte('expenseDate', lowMs).lt('expenseDate', highMs),
      )
      .order('desc')
      .take(scanCap + 1),
  ])
  const partial = sessions.length > scanCap || expenses.length > scanCap
  const inRange = (key: string | null): key is string => key !== null && key >= lowKey && key <= highKey
  for (const s of sessions.slice(0, scanCap)) {
    const key = safeDayKey(s.sessionDate, timeZone)
    if (!inRange(key)) continue
    const b = bucket(key)
    b.sales += safe(s.totalAmount)
    b.active = true
  }
  for (const e of expenses.slice(0, scanCap)) {
    const key = safeDayKey(e.expenseDate, timeZone)
    if (!inRange(key)) continue
    const b = bucket(key)
    b.expenses += safe(e.amount)
    b.active = true
  }
  return { days, fromTotals: false, partial }
}

/** Σ over the buckets whose key is in `[lowKey, highKey]`. */
export function sumBuckets(
  days: Map<string, DayBucket>,
  lowKey: string,
  highKey: string,
): { sales: number; expenses: number; active: boolean } {
  let sales = 0
  let expenses = 0
  let active = false
  for (const [key, b] of days) {
    if (key < lowKey || key > highKey) continue
    sales += b.sales
    expenses += b.expenses
    if (b.active) active = true
  }
  return { sales, expenses, active }
}

/**
 * All-time sales total: userTotals when the user's totals are ready, else the
 * sum of at most `scanCap` sessions (newest first; `partial` when capped).
 */
export async function allTimeSales(
  ctx: QueryCtx,
  userId: Id<'users'>,
  scanCap: number,
): Promise<{ total: number; partial: boolean }> {
  const sums = await allTimeSumsIfReady(ctx, userId)
  if (sums) return { total: safe(sums.salesTotal), partial: false }
  const sessions = await ctx.db
    .query('saleSessions')
    .withIndex('by_userId_sessionDate', (q) => q.eq('userId', userId))
    .order('desc')
    .take(scanCap + 1)
  let total = 0
  for (const s of sessions.slice(0, scanCap)) total += safe(s.totalAmount)
  return { total, partial: sessions.length > scanCap }
}

/**
 * Date (ms) of the user's newest sale session or expense dated up to `nowMs`
 * (entry dates, not edit times), or null when they never recorded anything.
 * Two index lookups.
 */
export async function lastActivityAt(
  ctx: QueryCtx,
  userId: Id<'users'>,
  nowMs: number,
): Promise<number | null> {
  const [s, e] = await Promise.all([
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', userId).lte('sessionDate', nowMs))
      .order('desc')
      .first(),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId).lte('expenseDate', nowMs))
      .order('desc')
      .first(),
  ])
  const candidates = [s?.sessionDate, e?.expenseDate].filter(
    (ms): ms is number => ms !== undefined && Number.isFinite(ms),
  )
  return candidates.length > 0 ? Math.max(...candidates) : null
}

/** First day (Monday) of the Monday→Sunday week containing `dayKey`, like the dashboard's "This week". */
export function weekStartKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y ?? NaN, (m ?? NaN) - 1, d ?? NaN)).getUTCDay() // 0 = Sunday
  return addDaysToKey(dayKey, -((dow + 6) % 7))
}

export type LatestRecord = {
  kind:   'sale' | 'expense'
  /** Sale: product name. Expense: its note, or "Expense". */
  label:  string
  amount: number
  /** Entry date (ms) of the sale / expense. */
  at:     number
}

const EXPENSE_FALLBACK_LABEL = 'Expense'

/**
 * The user's newest sale item or expense dated up to `nowMs` (entry date;
 * a tie goes to the one created last), or null. Two index lookups.
 */
export async function latestRecord(
  ctx: QueryCtx,
  userId: Id<'users'>,
  nowMs: number,
): Promise<LatestRecord | null> {
  const [sale, expense] = await Promise.all([
    ctx.db
      .query('sales')
      .withIndex('by_userId_saleDate', (q) => q.eq('userId', userId).lte('saleDate', nowMs))
      .order('desc')
      .first(),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId).lte('expenseDate', nowMs))
      .order('desc')
      .first(),
  ])
  const saleRec: LatestRecord | null = sale
    ? { kind: 'sale', label: sale.productName.trim() || 'Sale', amount: safe(sale.amount), at: sale.saleDate }
    : null
  const expenseRec: LatestRecord | null = expense
    ? {
        kind: 'expense',
        label: expense.note?.trim() || EXPENSE_FALLBACK_LABEL,
        amount: safe(expense.amount),
        at: expense.expenseDate,
      }
    : null
  if (!saleRec || !sale) return expenseRec
  if (!expenseRec || !expense) return saleRec
  if (saleRec.at !== expenseRec.at) return saleRec.at > expenseRec.at ? saleRec : expenseRec
  return sale.createdAt >= expense.createdAt ? saleRec : expenseRec
}

/** Case-insensitive "contains" match on name or email (blank needle matches all). */
export function matchesSearch(user: Pick<Doc<'users'>, 'name' | 'email'>, needle: string): boolean {
  if (needle.length === 0) return true
  return user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
}
