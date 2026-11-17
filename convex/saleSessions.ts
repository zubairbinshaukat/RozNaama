import { v } from 'convex/values'
import { paginationOptsValidator, type PaginationResult } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { authedMutation, authedQuery } from './lib/functions'
import { validationError } from './lib/errors'
import {
  dailyTotal,
  expenseDoc,
  monthlyTotal,
  paginated,
  sessionWithItems,
  statsValidator,
} from './lib/returnValidators'
import {
  DEFAULT_TIME_ZONE,
  dateKeyInTimeZone,
  monthIndexInTimeZone,
  normalizeTimeZone,
  yearInTimeZone,
  zonedStartOfDayMs,
} from './lib/time'
import { recordSaleSession } from './model/sales'
import {
  alignedDayRange,
  expenseYears,
  expensesInRange,
  expensesInYear,
  getAllTimeTotals,
  loadSessionsWithItems,
  MAX_YEAR_PROBES,
  sessionsInRange,
  sessionsInYear,
  sessionYears,
  sumDailyRows,
  sumExpenses,
  sumSessions,
  type SessionWithItems,
} from './model/stats'
import {
  DAY_KEY_RE,
  dailyRowsInKeyRange,
  nextDayKey,
  safe,
  safeDayKey,
  totalsGate,
} from './model/totals'

const saleItemValidator = v.object({
  productName: v.string(),
  amount:      v.number(),
  categoryId:  v.optional(v.id('categories')),
  note:        v.optional(v.string()),
})

/**
 * Atomically record a sale session with all its line items.
 * Optional `clientRequestId` (offline outbox): a replay of the same id returns
 * the first result and writes nothing.
 */
export const record = authedMutation({
  args: {
    items:           v.array(saleItemValidator),
    sessionDate:     v.number(),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({
    sessionId:   v.id('saleSessions'),
    totalAmount: v.number(),
    itemCount:   v.number(),
  }),
  handler: async (ctx, args) => {
    return recordSaleSession(ctx, ctx.user._id, {
      items:           args.items,
      sessionDate:     args.sessionDate,
      clientRequestId: args.clientRequestId,
    })
  },
})

/**
 * Get sessions + items for today.
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses getDayFeed).
 */
export const getForDate = authedQuery({
  args: {
    startOfDay: v.number(),
    endOfDay:   v.number(),
  },
  returns: v.array(sessionWithItems),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []
    const sessions = await sessionsInRange(ctx, user._id, args.startOfDay, args.endOfDay)
    return loadSessionsWithItems(ctx, user._id, sessions)
  },
})

/**
 * Get sessions + items for a date range (multi-day view, weekly/monthly detail).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses getDayFeed).
 */
export const getSessionsForRange = authedQuery({
  args: {
    startDate: v.number(),
    endDate:   v.number(),
  },
  returns: v.array(sessionWithItems),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []
    const sessions = await sessionsInRange(ctx, user._id, args.startDate, args.endDate)
    return loadSessionsWithItems(ctx, user._id, sessions)
  },
})

/**
 * Get all-time sessions + items in descending date order (paginated).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses getDayFeed).
 */
export const getSessionsPaginated = authedQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(sessionWithItems),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    const page = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', user._id))
      .order('desc')
      .paginate(args.paginationOpts)

    return { ...page, page: await loadSessionsWithItems(ctx, user._id, page.page) }
  },
})

/**
 * Get sessions + items in descending date order for a date range (paginated).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses getDayFeed).
 */
export const getSessionsForRangePaginated = authedQuery({
  args: {
    startDate:      v.number(),
    endDate:        v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(sessionWithItems),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    const page = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id).gte('sessionDate', args.startDate).lte('sessionDate', args.endDate),
      )
      .order('desc')
      .paginate(args.paginationOpts)

    return { ...page, page: await loadSessionsWithItems(ctx, user._id, page.page) }
  },
})

/**
 * Get daily totals (sales − expenses) for a date range (for charts).
 * Served from `dailyTotals` when the user's totals are ready in this zone and
 * the range covers whole days; otherwise the legacy scan.
 */
export const getDailyTotals = authedQuery({
  args: {
    startDate: v.number(),
    endDate:   v.number(),
    timeZone:  v.string(),
  },
  returns: v.array(dailyTotal),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []

    const tz = normalizeTimeZone(args.timeZone)

    const range = alignedDayRange(args.startDate, args.endDate, tz)
    if (range && (await totalsGate(ctx, user._id, tz))) {
      const rows = await dailyRowsInKeyRange(ctx, user._id, range.lowKey, range.highKey)
      return rows.map((r) => ({ date: r.dayKey, total: r.salesTotal - r.expenseTotal }))
    }

    const [sessions, expenses] = await Promise.all([
      sessionsInRange(ctx, user._id, args.startDate, args.endDate),
      expensesInRange(ctx, user._id, args.startDate, args.endDate),
    ])

    const salesByDay = new Map<string, number>()
    for (const s of sessions) {
      const day = dateKeyInTimeZone(s.sessionDate, tz)
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + s.totalAmount)
    }

    const expensesByDay = new Map<string, number>()
    for (const e of expenses) {
      const day = dateKeyInTimeZone(e.expenseDate, tz)
      expensesByDay.set(day, (expensesByDay.get(day) ?? 0) + e.amount)
    }

    const allDays = new Set<string>([...salesByDay.keys(), ...expensesByDay.keys()])
    return Array.from(allDays.values())
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({
        date,
        total: (salesByDay.get(date) ?? 0) - (expensesByDay.get(date) ?? 0),
      }))
  },
})

const EMPTY_STATS = {
  todayTotal: 0, todayCount: 0,
  todaySalesTotal: 0, todayNetTotal: 0,
  todayExpenseTotal: 0, todayExpenseCount: 0,
  weekTotal: 0,  weekCount: 0,
  monthTotal: 0, monthCount: 0,
  allTimeTotal: 0, allTimeCount: 0, allTimeSalesTotal: 0, allTimeExpenseTotal: 0,
  topCategoryName: null,
}

/** Longest span (days) of the today/week/month union served from dailyTotals. */
const MAX_STATS_SPAN_DAYS = 93

type StatsArgs = {
  todayStart: number
  todayEnd:   number
  weekStart:  number
  weekEnd:    number
  monthStart: number
  monthEnd:   number
}

type PeriodSums = { salesTotal: number; itemCount: number; expenseTotal: number; expenseCount: number; hasSales: boolean }

/** today/week/month sums from dailyTotals, or null when the gate / alignment fails. */
async function statsFromTotals(
  ctx: QueryCtx,
  userId: Id<'users'>,
  args: StatsArgs,
  timeZone: string | undefined,
): Promise<{ today: PeriodSums; week: PeriodSums; month: PeriodSums } | null> {
  if (timeZone === undefined) return null
  const tz = normalizeTimeZone(timeZone)
  const today = alignedDayRange(args.todayStart, args.todayEnd, tz)
  const week = alignedDayRange(args.weekStart, args.weekEnd, tz)
  const month = alignedDayRange(args.monthStart, args.monthEnd, tz)
  if (!today || !week || !month) return null
  const lowKey = [today.lowKey, week.lowKey, month.lowKey].sort()[0] as string
  const highKey = [today.highKey, week.highKey, month.highKey].sort()[2] as string
  const spanDays = (Date.parse(highKey) - Date.parse(lowKey)) / 86_400_000
  if (!(spanDays <= MAX_STATS_SPAN_DAYS)) return null
  if (!(await totalsGate(ctx, userId, tz))) return null

  const rows = await dailyRowsInKeyRange(ctx, userId, lowKey, highKey)
  const sums = (range: { lowKey: string; highKey: string }): PeriodSums => {
    const s = sumDailyRows(rows, range)
    return { ...s, hasSales: s.sessionCount > 0 }
  }
  return { today: sums(today), week: sums(week), month: sums(month) }
}

/** Get dashboard summary stats (optional `timeZone` enables the dailyTotals fast path). */
export const getStats = authedQuery({
  args: {
    todayStart: v.number(),
    todayEnd:   v.number(),
    weekStart:  v.number(),
    weekEnd:    v.number(),
    monthStart: v.number(),
    monthEnd:   v.number(),
    timeZone:   v.optional(v.string()),
  },
  returns: statsValidator,
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return EMPTY_STATS
    const userId = user._id

    let periods = await statsFromTotals(ctx, userId, args, args.timeZone)
    if (!periods) {
      const [
        todaySessions,
        weekSessions,
        monthSessions,
        todayExpenses,
        weekExpenses,
        monthExpenses,
      ] = await Promise.all([
        sessionsInRange(ctx, userId, args.todayStart, args.todayEnd),
        sessionsInRange(ctx, userId, args.weekStart, args.weekEnd),
        sessionsInRange(ctx, userId, args.monthStart, args.monthEnd),
        expensesInRange(ctx, userId, args.todayStart, args.todayEnd),
        expensesInRange(ctx, userId, args.weekStart, args.weekEnd),
        expensesInRange(ctx, userId, args.monthStart, args.monthEnd),
      ])
      const period = (sessions: Doc<'saleSessions'>[], expenses: Doc<'expenses'>[]): PeriodSums => {
        const s = sumSessions(sessions)
        const e = sumExpenses(expenses)
        return {
          salesTotal:   s.total,
          itemCount:    s.count,
          expenseTotal: e.total,
          expenseCount: e.count,
          hasSales:     sessions.length > 0,
        }
      }
      periods = {
        today: period(todaySessions, todayExpenses),
        week:  period(weekSessions, weekExpenses),
        month: period(monthSessions, monthExpenses),
      }
    }
    const { today, week, month } = periods
    const allTime = await getAllTimeTotals(ctx, userId)

    const catTotals = new Map<Id<'categories'>, number>()
    if (today.hasSales) {
      const todaySales = await ctx.db
        .query('sales')
        .withIndex('by_userId_saleDate', (q) =>
          q.eq('userId', userId).gte('saleDate', args.todayStart).lte('saleDate', args.todayEnd),
        )
        .collect()
      for (const sale of todaySales) {
        if (sale.categoryId) {
          catTotals.set(sale.categoryId, (catTotals.get(sale.categoryId) ?? 0) + sale.amount)
        }
      }
    }

    let topCategoryName: string | null = null
    if (catTotals.size > 0) {
      const topId = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (topId) {
        const cat = await ctx.db.get('categories', topId)
        // Poisoned legacy rows may reference another user's category: never leak its name.
        topCategoryName = cat && cat.userId === userId ? cat.name : null
      }
    }

    return {
      todayTotal:          today.salesTotal,
      todaySalesTotal:     today.salesTotal,
      todayNetTotal:       today.salesTotal - today.expenseTotal,
      todayCount:          today.itemCount,
      todayExpenseTotal:   today.expenseTotal,
      todayExpenseCount:   today.expenseCount,
      weekTotal:           week.salesTotal - week.expenseTotal,
      weekCount:           week.itemCount,
      monthTotal:          month.salesTotal - month.expenseTotal,
      monthCount:          month.itemCount,
      allTimeTotal:        allTime.salesTotal - allTime.expenseTotal,
      allTimeCount:        allTime.itemCount,
      allTimeSalesTotal:   allTime.salesTotal,
      allTimeExpenseTotal: allTime.expenseTotal,
      topCategoryName,
    }
  },
})

function emptyMonths() {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    salesTotal: 0,
    netTotal:   0,
  }))
}

/** Get monthly totals for a selected year; includes sales and net values per month. */
export const getYearlyMonthlyTotals = authedQuery({
  args: {
    year:     v.number(),
    timeZone: v.string(),
  },
  returns: v.array(monthlyTotal),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user || !Number.isInteger(args.year)) return emptyMonths()

    const tz = normalizeTimeZone(args.timeZone)
    const salesTotals = Array.from({ length: 12 }, () => 0)
    const expenseTotals = Array.from({ length: 12 }, () => 0)

    if (args.year >= 1000 && args.year <= 9999 && (await totalsGate(ctx, user._id, tz))) {
      const rows = await dailyRowsInKeyRange(ctx, user._id, `${args.year}-01-01`, `${args.year}-12-31`)
      for (const r of rows) {
        const m = Number(r.dayKey.slice(5, 7)) - 1
        if (m < 0 || m > 11) continue
        salesTotals[m] += r.salesTotal
        expenseTotals[m] += r.expenseTotal
      }
    } else {
      const [sessions, expenses] = await Promise.all([
        sessionsInYear(ctx, user._id, args.year, tz),
        expensesInYear(ctx, user._id, args.year, tz),
      ])

      for (const session of sessions) {
        salesTotals[monthIndexInTimeZone(session.sessionDate, tz)] += session.totalAmount
      }
      for (const expense of expenses) {
        expenseTotals[monthIndexInTimeZone(expense.expenseDate, tz)] += expense.amount
      }
    }

    return salesTotals.map((salesTotal, monthIndex) => ({
      monthIndex,
      salesTotal,
      netTotal: salesTotal - expenseTotals[monthIndex],
    }))
  },
})

/** Distinct years with a dailyTotals row: one `.first()` per year. */
async function dailyTotalsYears(ctx: QueryCtx, userId: Id<'users'>): Promise<number[]> {
  const years: number[] = []
  let from = ''
  for (let i = 0; i < MAX_YEAR_PROBES; i++) {
    const lower = from
    const row = await ctx.db
      .query('dailyTotals')
      .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId).gte('dayKey', lower))
      .first()
    if (!row) break
    const year = Number(row.dayKey.slice(0, 4))
    if (!Number.isInteger(year) || year >= 9999) break
    years.push(year)
    from = `${String(year + 1).padStart(4, '0')}-01-01`
  }
  return years
}

/** Return selectable years (descending) from sales and expense data, plus the current year. */
export const getAvailableYears = authedQuery({
  args: {
    timeZone: v.string(),
  },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const tz = normalizeTimeZone(args.timeZone)
    const currentYear = yearInTimeZone(Date.now(), tz)

    const user = ctx.user
    if (!user) return [currentYear]

    let found: number[]
    if (await totalsGate(ctx, user._id, tz)) {
      found = await dailyTotalsYears(ctx, user._id)
    } else {
      const [fromSessions, fromExpenses] = await Promise.all([
        sessionYears(ctx, user._id, tz),
        expenseYears(ctx, user._id, tz),
      ])
      found = [...fromSessions, ...fromExpenses]
    }

    const years = new Set<number>([currentYear, ...found])
    return Array.from(years.values()).sort((a, b) => b - a)
  },
})

// ─── Day feed (Tier 3 contract) ─────────────────────────────────────────────

const dayFeedEntry = v.object({
  date:         v.string(),
  salesTotal:   v.number(),
  expenseTotal: v.number(),
  saleCount:    v.number(),
  expenseCount: v.number(),
  sessions:     v.array(sessionWithItems),
  expenses:     v.array(expenseDoc),
  // Set only when ONE day holds more than DAY_FEED_DAY_HARD_CAP sessions or
  // expenses: the entry then has the newest rows only (totals cover those).
  truncated:    v.optional(v.boolean()),
})

type DayFeedEntry = {
  date:         string
  salesTotal:   number
  expenseTotal: number
  saleCount:    number
  expenseCount: number
  sessions:     SessionWithItems[]
  expenses:     Doc<'expenses'>[]
  truncated?:   boolean
}

/** Max days per page (numItems is clamped to 1..this). */
export const DAY_FEED_MAX_DAYS = 31
/** Max days a page bound by `endCursor` may return; larger windows are split. */
export const DAY_FEED_MAX_BOUND_DAYS = 200
/** Max sessions and max expenses read per page; a page ends early (or splits) instead. */
export const DAY_FEED_ROW_CAP = 1000
/**
 * Max sessions and max expenses loaded for a single day that alone exceeds
 * DAY_FEED_ROW_CAP (a day cannot be split across pages). Beyond this the
 * entry is returned with `truncated: true`.
 */
export const DAY_FEED_DAY_HARD_CAP = 2000
/** Extra index steps allowed per day lookup (only matters for corrupt empty dailyTotals rows). */
const DAY_SCAN_SLACK = 50

const NO_UPPER_KEY = '￿'
const MIN_MS = -Number.MAX_VALUE
const MAX_MS = Number.MAX_VALUE

/** Day-key window: lowKey ≤ dayKey < upperKey. */
type KeyWindow = { lowKey: string; upperKey: string }

/**
 * Result of a newest-first day lookup.
 * - `exhausted`: the window was walked to its end (no day below the last one).
 *   false = more may exist (limit reached, or the scan cap was hit).
 * - `resumeKey`: lowest day key examined; every day ≥ it in the window is
 *   accounted for, so it is a safe cursor when the scan cap cut the walk short.
 */
type DaySearch = { days: string[]; exhausted: boolean; resumeKey: string | null }

function parseFeedCursor(cursor: string | null | undefined, label: string): string | null {
  if (cursor === null || cursor === undefined) return null
  if (cursor === '') return ''
  if (!DAY_KEY_RE.test(cursor)) throw validationError(`InvalidCursor: ${label} must be a YYYY-MM-DD day key`)
  return cursor
}

/** Newest-first distinct day keys from dailyTotals (ready path). */
async function daysFromTotals(
  ctx: QueryCtx,
  userId: Id<'users'>,
  w: KeyWindow,
  limit: number,
): Promise<DaySearch> {
  const days: string[] = []
  let resumeKey: string | null = null
  let scanned = 0
  const rows = ctx.db
    .query('dailyTotals')
    .withIndex('by_userId_dayKey', (q) =>
      q.eq('userId', userId).gte('dayKey', w.lowKey).lt('dayKey', w.upperKey),
    )
    .order('desc')
  for await (const row of rows) {
    if (days.length >= limit || scanned >= limit + DAY_SCAN_SLACK) {
      return { days, exhausted: false, resumeKey }
    }
    scanned++
    resumeKey = row.dayKey
    // Empty rows are deleted by the hooks; skip any that slipped through.
    if (row.sessionCount > 0 || row.expenseCount > 0) days.push(row.dayKey)
  }
  return { days, exhausted: true, resumeKey }
}

/** Newest-first distinct day keys from saleSessions + expenses (not-ready path, skip-scan). */
async function daysFromSource(
  ctx: QueryCtx,
  userId: Id<'users'>,
  w: KeyWindow,
  tz: string,
  limit: number,
): Promise<DaySearch> {
  const days: string[] = []
  let resumeKey: string | null = null
  const lowMs = w.lowKey === '' ? MIN_MS : zonedStartOfDayMs(w.lowKey, tz)
  let upMs = w.upperKey === NO_UPPER_KEY ? MAX_MS : zonedStartOfDayMs(w.upperKey, tz)
  for (let i = 0; i < limit + DAY_SCAN_SLACK; i++) {
    if (days.length >= limit) return { days, exhausted: false, resumeKey }
    const below = upMs
    const [s, e] = await Promise.all([
      ctx.db
        .query('saleSessions')
        .withIndex('by_userId_sessionDate', (q) =>
          q.eq('userId', userId).gte('sessionDate', lowMs).lt('sessionDate', below),
        )
        .order('desc')
        .first(),
      ctx.db
        .query('expenses')
        .withIndex('by_userId_expenseDate', (q) =>
          q.eq('userId', userId).gte('expenseDate', lowMs).lt('expenseDate', below),
        )
        .order('desc')
        .first(),
    ])
    const candidates = [s?.sessionDate, e?.expenseDate].filter(
      (ms): ms is number => ms !== undefined && Number.isFinite(ms),
    )
    if (candidates.length === 0) return { days, exhausted: true, resumeKey }
    const ms = Math.max(...candidates)
    const key = safeDayKey(ms, tz)
    if (key === null) return { days, exhausted: true, resumeKey }
    if (key >= w.lowKey && key < w.upperKey) {
      if (days[days.length - 1] !== key) days.push(key)
      resumeKey = key
    }
    const dayStart = zonedStartOfDayMs(key, tz)
    upMs = Number.isFinite(dayStart) && dayStart <= ms ? dayStart : ms
  }
  // Step cap hit. Without any in-window key there is no safe resume point, so stop.
  return { days, exhausted: resumeKey === null, resumeKey }
}

type DayRows = {
  sessions: Doc<'saleSessions'>[]
  expenses: Doc<'expenses'>[]
  /** null = every day in range is whole; else days ≤ cutoff may be partial. */
  cutoff:   string | null
}

/** Sessions + expenses of the days [oldest, newest] (newest first), at most `cap` of each. */
async function loadDayRows(
  ctx: QueryCtx,
  userId: Id<'users'>,
  newest: string,
  oldest: string,
  tz: string,
  cap: number,
): Promise<DayRows> {
  const lowMs = zonedStartOfDayMs(oldest, tz)
  const highMs = zonedStartOfDayMs(nextDayKey(newest), tz)
  const [sessions, expenses] = await Promise.all([
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', userId).gte('sessionDate', lowMs).lt('sessionDate', highMs),
      )
      .order('desc')
      .take(cap + 1),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', userId).gte('expenseDate', lowMs).lt('expenseDate', highMs),
      )
      .order('desc')
      .take(cap + 1),
  ])
  // If a table hit the cap, days at or below its last loaded day may be partial.
  const cutoffs: string[] = []
  if (sessions.length > cap) {
    sessions.length = cap
    cutoffs.push(safeDayKey(sessions[cap - 1]?.sessionDate ?? NaN, tz) ?? newest)
  }
  if (expenses.length > cap) {
    expenses.length = cap
    cutoffs.push(safeDayKey(expenses[cap - 1]?.expenseDate ?? NaN, tz) ?? newest)
  }
  const cutoff = cutoffs.length === 0 ? null : (cutoffs.sort().reverse()[0] as string)
  return { sessions, expenses, cutoff }
}

/** Build entries (newest first) for `days` from loaded rows. */
async function buildEntries(
  ctx: QueryCtx,
  userId: Id<'users'>,
  days: string[],
  rows: DayRows,
  tz: string,
  truncated = false,
): Promise<DayFeedEntry[]> {
  const byDay = new Map<string, { sessions: Doc<'saleSessions'>[]; expenses: Doc<'expenses'>[] }>()
  for (const d of days) byDay.set(d, { sessions: [], expenses: [] })
  const sessions: Doc<'saleSessions'>[] = []
  for (const s of rows.sessions) {
    const group = byDay.get(safeDayKey(s.sessionDate, tz) ?? '')
    if (group) {
      group.sessions.push(s)
      sessions.push(s)
    }
  }
  for (const e of rows.expenses) byDay.get(safeDayKey(e.expenseDate, tz) ?? '')?.expenses.push(e)

  const withItems = new Map<Id<'saleSessions'>, SessionWithItems>()
  for (const s of await loadSessionsWithItems(ctx, userId, sessions)) withItems.set(s._id, s)

  const entries: DayFeedEntry[] = []
  for (const date of days) {
    const group = byDay.get(date)
    if (!group) continue
    let salesTotal = 0
    let saleCount = 0
    for (const s of group.sessions) {
      salesTotal += safe(s.totalAmount)
      saleCount += safe(s.itemCount)
    }
    let expenseTotal = 0
    for (const e of group.expenses) expenseTotal += safe(e.amount)
    entries.push({
      date,
      salesTotal,
      expenseTotal,
      saleCount,
      expenseCount: group.expenses.length,
      sessions:     group.sessions.map((s) => withItems.get(s._id) ?? { ...s, items: [] }),
      expenses:     group.expenses,
      ...(truncated ? { truncated: true } : {}),
    })
  }
  return entries
}

/** One day on its own, up to DAY_FEED_DAY_HARD_CAP rows per table (`truncated` beyond). */
async function loadSingleDay(
  ctx: QueryCtx,
  userId: Id<'users'>,
  day: string,
  tz: string,
): Promise<DayFeedEntry[]> {
  const rows = await loadDayRows(ctx, userId, day, day, tz, DAY_FEED_DAY_HARD_CAP)
  return buildEntries(ctx, userId, [day], rows, tz, rows.cutoff !== null)
}

/** Day key that splits newest-first `days` into two non-empty halves (days ≥ it / days < it). */
function middleSplit(days: string[]): string | undefined {
  return days[Math.floor((days.length - 1) / 2)]
}

const EMPTY_FEED = { page: [] as DayFeedEntry[], isDone: true, continueCursor: '' }

/**
 * Merged day feed (sales sessions + expenses grouped by day), newest day
 * first, for the dashboard lists. One page item = one day.
 *
 * - Days are keyed in `timeZone` (blank/invalid → 'Asia/Karachi'). When the
 *   user's totals are ready in that zone, pages walk `dailyTotals`; otherwise
 *   day keys come from a bounded skip-scan over saleSessions + expenses. Both
 *   paths return identical pages.
 * - `startDate`/`endDate` (ms) restrict to the days containing them (whole days).
 * - Custom cursor = day key: `cursor` → days strictly before it; `endCursor`
 *   (sent by convex-helpers' usePaginatedQuery on loadMore) → days ≥ it, so a
 *   page's end stays stable while it re-runs. `continueCursor` is the last day
 *   of the page (or, when a lookup hit its scan cap, the last day examined).
 * - `saleCount` = Σ session.itemCount (number of sale line items), the same
 *   meaning as the legacy SalesList day header; amounts coerce non-finite to 0.
 * - Reads per page are capped (≤ 31 days, ≤ 1000 sessions and ≤ 1000
 *   expenses). A day is never split silently:
 *   - unbound page: it ends early (isDone=false) after the last WHOLE day;
 *     if the newest day alone exceeds the cap, it is returned alone with up
 *     to DAY_FEED_DAY_HARD_CAP rows per table, flagged `truncated` beyond that;
 *   - endCursor-bound page (fixed range that grew past the caps or past 200
 *     days): returns `pageStatus: 'SplitRequired'` + `splitCursor` (a day key)
 *     so the client re-queries the range as two smaller pages; a single day
 *     is handled as above.
 */
export const getDayFeed = authedQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    timeZone:       v.string(),
    startDate:      v.optional(v.number()),
    endDate:        v.optional(v.number()),
  },
  returns: paginated(dayFeedEntry),
  handler: async (ctx, args): Promise<PaginationResult<DayFeedEntry>> => {
    const user = ctx.user
    if (!user) return EMPTY_FEED
    const userId = user._id
    const tz = normalizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)

    const cursor = parseFeedCursor(args.paginationOpts.cursor, 'cursor')
    const endCursor = parseFeedCursor(args.paginationOpts.endCursor, 'endCursor')
    if (cursor === '') return EMPTY_FEED

    const startKey = args.startDate === undefined ? '' : safeDayKey(args.startDate, tz)
    const endKey = args.endDate === undefined ? null : safeDayKey(args.endDate, tz)
    if (startKey === null || (args.endDate !== undefined && endKey === null)) return EMPTY_FEED

    let upperKey = endKey === null ? NO_UPPER_KEY : nextDayKey(endKey)
    if (cursor !== null && cursor < upperKey) upperKey = cursor
    if (startKey >= upperKey) return EMPTY_FEED

    const ready = (await totalsGate(ctx, userId, tz)) !== null
    const findDays = (w: KeyWindow, limit: number): Promise<DaySearch> =>
      ready ? daysFromTotals(ctx, userId, w, limit) : daysFromSource(ctx, userId, w, tz, limit)

    if (endCursor !== null && endCursor !== '') {
      // Bound page (re-run after loadMore): exactly the days in [endCursor, upper).
      const lowKey = endCursor > startKey ? endCursor : startKey
      const found = lowKey < upperKey
        ? await findDays({ lowKey, upperKey }, DAY_FEED_MAX_BOUND_DAYS + 1)
        : { days: [], exhausted: true, resumeKey: null }
      let more = false
      if (endCursor > startKey) {
        const below = await findDays({ lowKey: startKey, upperKey: endCursor }, 1)
        more = below.days.length > 0 || !below.exhausted
      }
      const base = { isDone: !more, continueCursor: endCursor }
      const split = (splitCursor: string) =>
        ({ ...base, page: [] as DayFeedEntry[], splitCursor, pageStatus: 'SplitRequired' as const })

      if (!found.exhausted) {
        // The range holds more days than one page may return (or the scan cap hit).
        const at = found.days.length >= 2 ? middleSplit(found.days) : found.resumeKey
        // Only split strictly inside the bound: splitting at lowKey would hand the
        // client back an identical first half and loop forever (review N1).
        if (at !== undefined && at !== null && at > lowKey) return split(at)
      }
      const days = found.days.slice(0, DAY_FEED_MAX_BOUND_DAYS)
      if (days.length === 0) return { ...base, page: [] }
      const rows = await loadDayRows(ctx, userId, days[0] as string, days[days.length - 1] as string, tz, DAY_FEED_ROW_CAP)
      if (rows.cutoff === null) return { ...base, page: await buildEntries(ctx, userId, days, rows, tz) }
      if (days.length >= 2) {
        const cutoff = rows.cutoff
        const whole = days.filter((d) => d > cutoff)
        return split(whole.length > 0 ? (whole[whole.length - 1] as string) : (days[0] as string))
      }
      return { ...base, page: await loadSingleDay(ctx, userId, days[0] as string, tz) }
    }

    const n = Math.min(Math.max(1, Math.floor(args.paginationOpts.numItems) || 1), DAY_FEED_MAX_DAYS)
    const found = await findDays({ lowKey: startKey, upperKey }, n + 1)
    const days = found.days.slice(0, n)
    const more = found.days.length > n || !found.exhausted
    // Scan cap hit before n days: resume right after the last examined day.
    const continueCursor = found.days.length <= n && !found.exhausted && found.resumeKey !== null
      ? found.resumeKey
      : (days[days.length - 1] ?? '')
    if (days.length === 0) return { page: [], isDone: !more, continueCursor }

    const newest = days[0] as string
    const rows = await loadDayRows(ctx, userId, newest, days[days.length - 1] as string, tz, DAY_FEED_ROW_CAP)
    if (rows.cutoff === null) {
      return { page: await buildEntries(ctx, userId, days, rows, tz), isDone: !more, continueCursor }
    }
    const cutoff = rows.cutoff
    const whole = days.filter((d) => d > cutoff)
    if (whole.length > 0) {
      return {
        page:           await buildEntries(ctx, userId, whole, rows, tz),
        isDone:         false,
        continueCursor: whole[whole.length - 1] as string,
      }
    }
    // The newest day alone exceeds the per-page cap: return it on its own page.
    return {
      page:           await loadSingleDay(ctx, userId, newest, tz),
      isDone:         days.length === 1 ? !more : false,
      continueCursor: newest,
    }
  },
})
