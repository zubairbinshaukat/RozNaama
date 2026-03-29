import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/** YYYY-MM-DD in the given IANA zone (matches browser local keys when zones align). */
function dateKeyInTimeZone(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone })
  } catch {
    return new Date(ms).toISOString().split('T')[0]!
  }
}

/**
 * Resolve the current user from Clerk identity.
 * Returns null (instead of throwing) when user not yet in DB —
 * handles the race condition on first sign-in where upsertUser
 * hasn't completed before dashboard queries fire.
 */
async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Unauthorized')

  const email = identity.email
  if (!email) throw new ConvexError('No email on identity')

  return ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
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
    startOfDay: v.number(),
    endOfDay:   v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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
    startDate: v.number(),
    endDate:   v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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

/** Get daily totals for a date range (for charts) */
export const getDailyTotals = query({
  args: {
    startDate: v.number(),
    endDate:   v.number(),
    timeZone:  v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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
    todayStart:  v.number(),
    todayEnd:    v.number(),
    weekStart:   v.number(),
    weekEnd:     v.number(),
    monthStart:  v.number(),
    monthEnd:    v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) return {
      todayTotal: 0, todayCount: 0,
      todaySalesTotal: 0, todayNetTotal: 0,
      todayExpenseTotal: 0, todayExpenseCount: 0,
      weekTotal: 0,  weekCount: 0,
      monthTotal: 0, monthCount: 0,
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
      topCategoryName,
    }
  },
})
