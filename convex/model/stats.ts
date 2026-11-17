/**
 * Read helpers for sale sessions, expenses and dashboard stats.
 * Reads never validate rows (legacy prod data may violate today's limits).
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { yearInTimeZone, zonedStartOfDayMs, zonedYearStartMs } from '../lib/time'
import { allTimeSumsIfReady, nextDayKey, safeDayKey } from './totals'

type ReadCtx = QueryCtx | MutationCtx

export type SessionWithItems = Doc<'saleSessions'> & { items: Doc<'sales'>[] }

/** Sum of session totals and item counts (sales totals come from sessions, not summed sales). */
export function sumSessions(sessions: Doc<'saleSessions'>[]): { total: number; count: number } {
  let total = 0
  let count = 0
  for (const s of sessions) {
    total += s.totalAmount
    count += s.itemCount
  }
  return { total, count }
}

/** Sum of expense amounts and the number of expenses. */
export function sumExpenses(expenses: Doc<'expenses'>[]): { total: number; count: number } {
  let total = 0
  for (const e of expenses) total += e.amount
  return { total, count: expenses.length }
}

/** Sessions with `start ≤ sessionDate ≤ end` (inclusive, as the legacy queries). */
export function sessionsInRange(
  ctx: ReadCtx,
  userId: Id<'users'>,
  start: number,
  end: number,
): Promise<Doc<'saleSessions'>[]> {
  return ctx.db
    .query('saleSessions')
    .withIndex('by_userId_sessionDate', (q) =>
      q.eq('userId', userId).gte('sessionDate', start).lte('sessionDate', end),
    )
    .collect()
}

/** Expenses with `start ≤ expenseDate ≤ end` (inclusive, as the legacy queries). */
export function expensesInRange(
  ctx: ReadCtx,
  userId: Id<'users'>,
  start: number,
  end: number,
): Promise<Doc<'expenses'>[]> {
  return ctx.db
    .query('expenses')
    .withIndex('by_userId_expenseDate', (q) =>
      q.eq('userId', userId).gte('expenseDate', start).lte('expenseDate', end),
    )
    .collect()
}

export type AllTimeTotals = {
  salesTotal:   number
  itemCount:    number
  expenseTotal: number
}

/**
 * All-time sales total, item count and expense total for a user: from
 * `userTotals` when the gate passes and the row exists (all-time sums do not
 * depend on the zone), otherwise the legacy full scan.
 */
export async function getAllTimeTotals(ctx: ReadCtx, userId: Id<'users'>): Promise<AllTimeTotals> {
  const totals = await allTimeSumsIfReady(ctx, userId)
  if (totals) {
    return {
      salesTotal:   totals.salesTotal,
      itemCount:    totals.itemCount,
      expenseTotal: totals.expenseTotal,
    }
  }
  const [sessions, expenses] = await Promise.all([
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', userId))
      .collect(),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId))
      .collect(),
  ])
  const sales = sumSessions(sessions)
  return {
    salesTotal:   sales.total,
    itemCount:    sales.count,
    expenseTotal: sumExpenses(expenses).total,
  }
}

/** Items of one session via `by_sessionId` (the legacy per-session read). */
function itemsForSession(ctx: ReadCtx, sessionId: Id<'saleSessions'>): Promise<Doc<'sales'>[]> {
  return ctx.db
    .query('sales')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
}

/**
 * Attach line items to sessions without an N+1: one `by_userId_saleDate`
 * range read over [min, max] sessionDate, grouped by sessionId. If a group's
 * size does not match the session's `itemCount` (legacy drift, or a sale whose
 * saleDate ≠ sessionDate) that session falls back to a `by_sessionId` read.
 * Preserves session order and per-session item order (creation order).
 */
export async function loadSessionsWithItems(
  ctx: ReadCtx,
  userId: Id<'users'>,
  sessions: Doc<'saleSessions'>[],
): Promise<SessionWithItems[]> {
  if (sessions.length === 0) return []

  let min = Infinity
  let max = -Infinity
  for (const s of sessions) {
    if (s.sessionDate < min) min = s.sessionDate
    if (s.sessionDate > max) max = s.sessionDate
  }

  const grouped = new Map<Id<'saleSessions'>, Doc<'sales'>[]>()
  for (const s of sessions) grouped.set(s._id, [])

  // Non-finite dates (legacy rows) cannot form a range; every session falls back.
  if (Number.isFinite(min) && Number.isFinite(max)) {
    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_saleDate', (q) =>
        q.eq('userId', userId).gte('saleDate', min).lte('saleDate', max),
      )
      .collect()
    for (const row of rows) grouped.get(row.sessionId)?.push(row)
  }

  return Promise.all(
    sessions.map(async (session) => {
      const group = grouped.get(session._id) ?? []
      const items =
        group.length === session.itemCount ? group : await itemsForSession(ctx, session._id)
      return { ...session, items }
    }),
  )
}

/**
 * Sessions whose sessionDate falls in `year` (in `timeZone`), via an index
 * range [start of year, start of next year) plus the legacy per-row year check.
 */
export async function sessionsInYear(
  ctx: ReadCtx,
  userId: Id<'users'>,
  year: number,
  timeZone: string,
): Promise<Doc<'saleSessions'>[]> {
  const start = zonedYearStartMs(year, timeZone)
  const end = zonedYearStartMs(year + 1, timeZone)
  const rows = await ctx.db
    .query('saleSessions')
    .withIndex('by_userId_sessionDate', (q) =>
      q.eq('userId', userId).gte('sessionDate', start).lt('sessionDate', end),
    )
    .collect()
  return rows.filter((s) => yearInTimeZone(s.sessionDate, timeZone) === year)
}

/** Expenses whose expenseDate falls in `year` (in `timeZone`); see sessionsInYear. */
export async function expensesInYear(
  ctx: ReadCtx,
  userId: Id<'users'>,
  year: number,
  timeZone: string,
): Promise<Doc<'expenses'>[]> {
  const start = zonedYearStartMs(year, timeZone)
  const end = zonedYearStartMs(year + 1, timeZone)
  const rows = await ctx.db
    .query('expenses')
    .withIndex('by_userId_expenseDate', (q) =>
      q.eq('userId', userId).gte('expenseDate', start).lt('expenseDate', end),
    )
    .collect()
  return rows.filter((e) => yearInTimeZone(e.expenseDate, timeZone) === year)
}

/** Max distinct years probed per table by the skip-scan in getAvailableYears. */
export const MAX_YEAR_PROBES = 100

/**
 * Distinct years (in `timeZone`) that have at least one session, using a
 * skip-scan: one `.first()` per year, at most MAX_YEAR_PROBES reads.
 */
export async function sessionYears(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
): Promise<number[]> {
  const years: number[] = []
  let from = -Infinity
  for (let i = 0; i < MAX_YEAR_PROBES; i++) {
    const lower = from
    const row = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        lower === -Infinity ? q.eq('userId', userId) : q.eq('userId', userId).gte('sessionDate', lower),
      )
      .first()
    if (!row) break
    const next = nextYearStart(row.sessionDate, timeZone, years)
    if (next === null) break
    from = next
  }
  return years
}

/** Same skip-scan as sessionYears, over expenses. */
export async function expenseYears(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
): Promise<number[]> {
  const years: number[] = []
  let from = -Infinity
  for (let i = 0; i < MAX_YEAR_PROBES; i++) {
    const lower = from
    const row = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        lower === -Infinity ? q.eq('userId', userId) : q.eq('userId', userId).gte('expenseDate', lower),
      )
      .first()
    if (!row) break
    const next = nextYearStart(row.expenseDate, timeZone, years)
    if (next === null) break
    from = next
  }
  return years
}

/**
 * Record the year of `ms` and return the lower bound for the next probe
 * (start of the following year, always > ms), or null to stop
 * (NaN / +Infinity legacy dates, which sort last). A -Infinity row is
 * skipped without recording a year.
 */
function nextYearStart(ms: number, timeZone: string, years: number[]): number | null {
  if (ms === -Infinity) return -Number.MAX_VALUE
  if (!Number.isFinite(ms)) return null
  const year = yearInTimeZone(ms, timeZone)
  if (!Number.isFinite(year)) return null
  years.push(year)
  const next = zonedYearStartMs(year + 1, timeZone)
  return Number.isFinite(next) && next > ms ? next : ms + 1
}

/**
 * Day-key range for `[startMs, endMs]` when it covers whole days exactly in
 * `timeZone` (start = 00:00, end = 23:59:59.999 of the last day, as the
 * frontend sends them); otherwise null so the caller keeps the scan path.
 */
export function alignedDayRange(
  startMs: number,
  endMs: number,
  timeZone: string,
): { lowKey: string; highKey: string } | null {
  const lowKey = safeDayKey(startMs, timeZone)
  const highKey = safeDayKey(endMs, timeZone)
  if (lowKey === null || highKey === null || lowKey > highKey) return null
  if (zonedStartOfDayMs(lowKey, timeZone) !== startMs) return null
  if (zonedStartOfDayMs(nextDayKey(highKey), timeZone) - 1 !== endMs) return null
  return { lowKey, highKey }
}

export type RangeSums = {
  salesTotal:   number
  itemCount:    number
  sessionCount: number
  expenseTotal: number
  expenseCount: number
}

/** Sum dailyTotals rows whose dayKey is within [lowKey, highKey]. */
export function sumDailyRows(
  rows: Doc<'dailyTotals'>[],
  range: { lowKey: string; highKey: string },
): RangeSums {
  const out: RangeSums = { salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 0, expenseCount: 0 }
  for (const r of rows) {
    if (r.dayKey < range.lowKey || r.dayKey > range.highKey) continue
    out.salesTotal += r.salesTotal
    out.itemCount += r.itemCount
    out.sessionCount += r.sessionCount
    out.expenseTotal += r.expenseTotal
    out.expenseCount += r.expenseCount
  }
  return out
}