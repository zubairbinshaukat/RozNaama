import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { paginationOptsValidator } from 'convex/server'
import { requireUser, resolveDataUser } from './authHelpers'

/** Atomically record an expense entry for a specific date */
export const record = mutation({
  args: {
    amount:      v.number(),
    expenseDate: v.number(),
    note:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    if (args.amount <= 0) throw new ConvexError('Expense amount must be greater than 0')

    const now = Date.now()

    const expenseId = await ctx.db.insert('expenses', {
      userId:      user._id,
      amount:      args.amount,
      note:        args.note?.trim() || undefined,
      expenseDate: args.expenseDate,
      createdAt:   now,
    })

    return { expenseId, amount: args.amount }
  },
})

/** Get all expenses for a date range (used for per-day dashboard list) */
export const getForRange = query({
  args: {
    startDate:    v.number(),
    endDate:      v.number(),
    viewAsUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return []

    return ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id)
          .gte('expenseDate', args.startDate)
          .lte('expenseDate', args.endDate),
      )
      .collect()
  },
})

/** Get all-time expenses in descending date order (paginated). */
export const getPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    viewAsUserId:   v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    return ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', user._id))
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

/** Get expenses in descending date order for a date range (paginated). */
export const getForRangePaginated = query({
  args: {
    startDate:      v.number(),
    endDate:        v.number(),
    paginationOpts: paginationOptsValidator,
    viewAsUserId:   v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return { page: [], isDone: true, continueCursor: '' }

    return ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', user._id).gte('expenseDate', args.startDate).lte('expenseDate', args.endDate),
      )
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

/** Update one expense entry */
export const updateItem = mutation({
  args: {
    expenseId: v.id('expenses'),
    amount:    v.number(),
    note:      v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    if (args.amount <= 0) throw new ConvexError('Expense amount must be greater than 0')

    const expense = await ctx.db.get(args.expenseId)
    if (!expense || expense.userId !== user._id) throw new ConvexError('Expense not found')

    await ctx.db.patch(args.expenseId, {
      amount: args.amount,
      note:   args.note?.trim() || undefined,
    })
  },
})

/** Delete one expense entry */
export const removeItem = mutation({
  args: { expenseId: v.id('expenses') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')

    const expense = await ctx.db.get(args.expenseId)
    if (!expense || expense.userId !== user._id) throw new ConvexError('Expense not found')

    await ctx.db.delete(args.expenseId)
  },
})

