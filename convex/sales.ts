import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
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

/** All sale line items for a category (newest by saleDate first in handler sort) */
export const listByCategoryId = query({
  args: { categoryId: v.id('categories') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) return []

    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId', (q) =>
        q.eq('userId', user._id).eq('categoryId', args.categoryId)
      )
      .collect()

    rows.sort((a, b) => b.saleDate - a.saleDate)
    return rows
  },
})

/** Total number of sale line items per category */
export const getCountsByCategory = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user) return []

    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_saleDate', (q) => q.eq('userId', user._id))
      .collect()

    const totals = new Map<Id<'categories'>, number>()
    for (const sale of rows) {
      if (!sale.categoryId) continue
      totals.set(sale.categoryId, (totals.get(sale.categoryId) ?? 0) + 1)
    }

    return Array.from(totals.entries()).map(([categoryId, count]) => ({
      categoryId,
      count,
    }))
  },
})

/** Get all sale items for a date range */
export const getForDateRange = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) return []
    return ctx.db
      .query('sales')
      .withIndex('by_userId_saleDate', (q) =>
        q.eq('userId', user._id)
          .gte('saleDate', args.startDate)
          .lte('saleDate', args.endDate)
      )
      .collect()
  },
})

/** Update a sale item; also adjusts the parent session's totalAmount */
export const updateItem = mutation({
  args: {
    saleId:      v.id('sales'),
    productName: v.string(),
    amount:      v.number(),
    categoryId:  v.optional(v.id('categories')),
    note:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')

    const sale = await ctx.db.get(args.saleId)
    if (!sale || sale.userId !== user._id) throw new ConvexError('Sale not found')

    const diff = args.amount - sale.amount

    await ctx.db.patch(args.saleId, {
      productName: args.productName.trim(),
      amount:      args.amount,
      categoryId:  args.categoryId,
      note:        args.note,
    })

    const session = await ctx.db.get(sale.sessionId)
    if (session) {
      await ctx.db.patch(sale.sessionId, {
        totalAmount: Math.max(0, session.totalAmount + diff),
      })
    }
  },
})

/** Delete a sale item; also updates or removes the parent session */
export const removeItem = mutation({
  args: { saleId: v.id('sales') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')

    const sale = await ctx.db.get(args.saleId)
    if (!sale || sale.userId !== user._id) throw new ConvexError('Sale not found')

    await ctx.db.delete(args.saleId)

    const session = await ctx.db.get(sale.sessionId)
    if (session) {
      const newCount = session.itemCount - 1
      if (newCount <= 0) {
        await ctx.db.delete(sale.sessionId)
      } else {
        await ctx.db.patch(sale.sessionId, {
          totalAmount: Math.max(0, session.totalAmount - sale.amount),
          itemCount:   newCount,
        })
      }
    }
  },
})
