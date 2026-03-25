import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

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
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
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

