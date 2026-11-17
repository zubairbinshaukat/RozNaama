import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { authedMutation, authedQuery } from './lib/functions'
import { expenseDoc, paginated } from './lib/returnValidators'
import { recordExpense, removeExpense, updateExpense } from './model/expenses'

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }

/**
 * Atomically record an expense entry for a specific date.
 * Optional `clientRequestId` (offline outbox): a replay of the same id returns
 * the first result and writes nothing.
 */
export const record = authedMutation({
  args: {
    amount:          v.number(),
    expenseDate:     v.number(),
    note:            v.optional(v.string()),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({
    expenseId: v.id('expenses'),
    amount:    v.number(),
  }),
  handler: async (ctx, args) => recordExpense(ctx, ctx.user._id, args),
})

/**
 * Get all expenses for a date range (old per-day dashboard list).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses saleSessions.getDayFeed).
 */
export const getForRange = authedQuery({
  args: {
    startDate: v.number(),
    endDate:   v.number(),
  },
  returns: v.array(expenseDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
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

/**
 * Get all-time expenses in descending date order (paginated).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses saleSessions.getDayFeed).
 */
export const getPaginated = authedQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(expenseDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return EMPTY_PAGE

    return ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', user._id))
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

/**
 * Get expenses in descending date order for a date range (paginated).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses saleSessions.getDayFeed).
 */
export const getForRangePaginated = authedQuery({
  args: {
    startDate:      v.number(),
    endDate:        v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(expenseDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return EMPTY_PAGE

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
export const updateItem = authedMutation({
  args: {
    expenseId: v.id('expenses'),
    amount:    v.number(),
    note:      v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateExpense(ctx, ctx.user._id, args.expenseId, {
      amount: args.amount,
      note:   args.note,
    })
    return null
  },
})

/** Delete one expense entry */
export const removeItem = authedMutation({
  args: { expenseId: v.id('expenses') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeExpense(ctx, ctx.user._id, args.expenseId)
    return null
  },
})
