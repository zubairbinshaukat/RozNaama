import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { paginationOptsValidator } from 'convex/server'
import { requireUser, resolveDataUser } from './authHelpers'

/** YYYY-MM-DD in the given IANA zone (matches browser local keys when zones align). */
function dateKeyInTimeZone(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone })
  } catch {
    return new Date(ms).toISOString().split('T')[0]!
  }
}

function monthIndexInTimeZone(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      month: '2-digit',
    }).formatToParts(new Date(ms))
    const monthPart = parts.find((part) => part.type === 'month')?.value
    const month = Number(monthPart)
    if (Number.isFinite(month) && month >= 1 && month <= 12) return month - 1
  } catch {
    // Fall through to UTC/local fallback below.
  }
  return new Date(ms).getMonth()
}

function yearInTimeZone(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
    }).formatToParts(new Date(ms))
    const yearPart = parts.find((part) => part.type === 'year')?.value
    const year = Number(yearPart)
    if (Number.isFinite(year)) return year
  } catch {
    // Fall through to UTC/local fallback below.
  }
  return new Date(ms).getFullYear()
}

const saleItemValidator = v.object({
  productName: v.string(),
  amount:      v.number(),
  categoryId:  v.optional(v.id('categories')),
  note:        v.optional(v.string()),
})

/** Atomically record a sale session with all its line items */
export const record = mutation({
  args: {
    items:       v.array(saleItemValidator),
    sessionDate: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    if (args.items.length === 0) throw new ConvexError('At least one sale item is required')

    const totalAmount = args.items.reduce((sum, item) => sum + item.amount, 0)
    const now = Date.now()

    const sessionId: Id<'saleSessions'> = await ctx.db.insert('saleSessions', {
      userId:      user._id,
      totalAmount,
      itemCount:   args.items.length,
      sessionDate: args.sessionDate,
      createdAt:   now,
    })

    for (const item of args.items) {
      await ctx.db.insert('sales', {
        userId:      user._id,
        sessionId,
        categoryId:  item.categoryId,
        productName: item.productName.trim(),
        amount:      item.amount,
        note:        item.note,
        saleDate:    args.sessionDate,
        createdAt:   now,
      })
    }

    return { sessionId, totalAmount, itemCount: args.items.length }
  },
})

/** Get sessions + items for today */
export const getForDate = query({
  args: {
    startOfDay:   v.number(),
    endOfDay:     v.number(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return []

    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.startOfDay)
          .lte('sessionDate', args.endOfDay)
      )
      .collect()

    return Promise.all(
      sessions.map(async (session) => {
        const items = await ctx.db
          .query('sales')
          .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
          .collect()
        return { ...session, items }
      })
    )
  },
})

/** Get sessions + items for a date range (multi-day view, weekly/monthly detail) */
export const getSessionsForRange = query({
  args: {
    startDate:    v.number(),
    endDate:      v.number(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return []

    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.startDate)
          .lte('sessionDate', args.endDate)
      )
      .collect()

    return Promise.all(
      sessions.map(async (session) => {
        const items = await ctx.db
          .query('sales')
          .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
          .collect()
        return { ...session, items }
      })
    )
  },
})

/** Get all-time sessions + items in descending date order (paginated). */
export const getSessionsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    viewAsUserId:   v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    const page = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', user._id))
      .order('desc')
      .paginate(args.paginationOpts)

    const sessionsWithItems = await Promise.all(
      page.page.map(async (session) => {
        const items = await ctx.db
          .query('sales')
          .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
          .collect()
        return { ...session, items }
      })
    )

    return {
      ...page,
      page: sessionsWithItems,
    }
  },
})

/** Get sessions + items in descending date order for a date range (paginated). */
export const getSessionsForRangePaginated = query({
  args: {
    startDate:      v.number(),
    endDate:        v.number(),
    paginationOpts: paginationOptsValidator,
    viewAsUserId:   v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    const page = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id).gte('sessionDate', args.startDate).lte('sessionDate', args.endDate)
      )
      .order('desc')
      .paginate(args.paginationOpts)

    const sessionsWithItems = await Promise.all(
      page.page.map(async (session) => {
        const items = await ctx.db
          .query('sales')
          .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
          .collect()
        return { ...session, items }
      })
    )

    return {
      ...page,
      page: sessionsWithItems,
    }
  },
})

/** Get daily totals for a date range (for charts) */
export const getDailyTotals = query({
  args: {
    startDate:    v.number(),
    endDate:      v.number(),
    timeZone:     v.string(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return []

    const tz = args.timeZone.trim() || 'UTC'

    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.startDate)
          .lte('sessionDate', args.endDate)
      )
      .collect()

    const expenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id)
          .gte('expenseDate', args.startDate)
          .lte('expenseDate', args.endDate)
      )
      .collect()

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

/** Get dashboard summary stats */
export const getStats = query({
  args: {
    todayStart:   v.number(),
    todayEnd:     v.number(),
    weekStart:    v.number(),
    weekEnd:      v.number(),
    monthStart:   v.number(),
    monthEnd:     v.number(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return {
      todayTotal: 0, todayCount: 0,
      todaySalesTotal: 0, todayNetTotal: 0,
      todayExpenseTotal: 0, todayExpenseCount: 0,
      weekTotal: 0,  weekCount: 0,
      monthTotal: 0, monthCount: 0,
      allTimeTotal: 0, allTimeCount: 0, allTimeSalesTotal: 0, allTimeExpenseTotal: 0,
      topCategoryName: null,
    }

    const todaySessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.todayStart)
          .lte('sessionDate', args.todayEnd)
      )
      .collect()

    const weekSessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.weekStart)
          .lte('sessionDate', args.weekEnd)
      )
      .collect()

    const monthSessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id)
          .gte('sessionDate', args.monthStart)
          .lte('sessionDate', args.monthEnd)
      )
      .collect()

    const todayExpenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id)
          .gte('expenseDate', args.todayStart)
          .lte('expenseDate', args.todayEnd)
      )
      .collect()

    const weekExpenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id)
          .gte('expenseDate', args.weekStart)
          .lte('expenseDate', args.weekEnd)
      )
      .collect()

    const monthExpenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id)
          .gte('expenseDate', args.monthStart)
          .lte('expenseDate', args.monthEnd)
      )
      .collect()

    const allSessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', user._id))
      .collect()

    const allExpenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', user._id))
      .collect()

    const todaySalesTotal  = todaySessions.reduce((s, x) => s + x.totalAmount, 0)
    const todayCount       = todaySessions.reduce((s, x) => s + x.itemCount, 0)
    const todayExpenseTotal = todayExpenses.reduce((s, x) => s + x.amount, 0)
    const todayExpenseCount = todayExpenses.length

    const weekSalesTotal    = weekSessions.reduce((s, x) => s + x.totalAmount, 0)
    const weekCount         = weekSessions.reduce((s, x) => s + x.itemCount, 0)
    const weekExpenseTotal  = weekExpenses.reduce((s, x) => s + x.amount, 0)

    const monthSalesTotal   = monthSessions.reduce((s, x) => s + x.totalAmount, 0)
    const monthCount        = monthSessions.reduce((s, x) => s + x.itemCount, 0)
    const monthExpenseTotal = monthExpenses.reduce((s, x) => s + x.amount, 0)

    const todayNetTotal = todaySalesTotal - todayExpenseTotal
    const todayTotal    = todaySalesTotal
    const weekTotal   = weekSalesTotal - weekExpenseTotal
    const monthTotal  = monthSalesTotal - monthExpenseTotal
    const allTimeSalesTotal = allSessions.reduce((s, x) => s + x.totalAmount, 0)
    const allTimeCount = allSessions.reduce((s, x) => s + x.itemCount, 0)
    const allTimeExpenseTotal = allExpenses.reduce((s, x) => s + x.amount, 0)
    const allTimeTotal = allTimeSalesTotal - allTimeExpenseTotal

    const catTotals = new Map<string, number>()

    if (todaySessions.length > 0) {
      const todaySales = await ctx.db.query('sales')
        .withIndex('by_userId_saleDate', (q) =>
          q.eq('userId', user._id)
            .gte('saleDate', args.todayStart)
            .lte('saleDate', args.todayEnd)
        )
        .collect()

      for (const sale of todaySales) {
        if (sale.categoryId) {
          const key = sale.categoryId as string
          catTotals.set(key, (catTotals.get(key) ?? 0) + sale.amount)
        }
      }
    }

    let topCategoryName: string | null = null
    if (catTotals.size > 0) {
      const topId = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const cat = await ctx.db.get(topId as Id<'categories'>)
      topCategoryName = cat?.name ?? null
    }

    return {
      todayTotal,
      todaySalesTotal,
      todayNetTotal,
      todayCount,
      todayExpenseTotal,
      todayExpenseCount,
      weekTotal,
      weekCount,
      monthTotal,
      monthCount,
      allTimeTotal,
      allTimeCount,
      allTimeSalesTotal,
      allTimeExpenseTotal,
      topCategoryName,
    }
  },
})

/** Get monthly totals for a selected year; includes sales and net values per month. */
export const getYearlyMonthlyTotals = query({
  args: {
    year:         v.number(),
    timeZone:     v.string(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) {
      return Array.from({ length: 12 }, (_, monthIndex) => ({
        monthIndex,
        salesTotal: 0,
        netTotal: 0,
      }))
    }

    const tz = args.timeZone.trim() || 'UTC'
    const salesTotals = Array.from({ length: 12 }, () => 0)
    const expenseTotals = Array.from({ length: 12 }, () => 0)

    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', user._id))
      .collect()

    for (const session of sessions) {
      if (yearInTimeZone(session.sessionDate, tz) !== args.year) continue
      const monthIndex = monthIndexInTimeZone(session.sessionDate, tz)
      salesTotals[monthIndex] += session.totalAmount
    }

    const expenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', user._id))
      .collect()

    for (const expense of expenses) {
      if (yearInTimeZone(expense.expenseDate, tz) !== args.year) continue
      const monthIndex = monthIndexInTimeZone(expense.expenseDate, tz)
      expenseTotals[monthIndex] += expense.amount
    }

    return salesTotals.map((salesTotal, monthIndex) => ({
      monthIndex,
      salesTotal,
      netTotal: salesTotal - expenseTotals[monthIndex],
    }))
  },
})

/** Return selectable years based on available sales/expense data. */
export const getAvailableYears = query({
  args: {
    timeZone:     v.string(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    const tz = args.timeZone.trim() || 'UTC'
    const currentYear = yearInTimeZone(Date.now(), tz)

    if (!user) return [currentYear]

    const years = new Set<number>([currentYear])

    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', user._id))
      .collect()

    for (const session of sessions) {
      years.add(yearInTimeZone(session.sessionDate, tz))
    }

    const expenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', user._id))
      .collect()

    for (const expense of expenses) {
      years.add(yearInTimeZone(expense.expenseDate, tz))
    }

    return Array.from(years.values()).sort((a, b) => b - a)
  },
})
