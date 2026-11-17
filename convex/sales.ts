import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { authedMutation, authedQuery } from './lib/functions'
import { getOwned } from './lib/ownership'
import { categoryCount, paginated, saleDoc } from './lib/returnValidators'
import { removeSaleItem, updateSaleItem } from './model/sales'
import { categoryStatsReady, getCategoryStatsRow, safe } from './model/totals'

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }

/**
 * All sale line items for a category (newest by saleDate first in handler sort).
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (new UI uses listByCategoryIdPaginated + getCategorySummary).
 */
export const listByCategoryId = authedQuery({
  args: {
    categoryId: v.id('categories'),
  },
  returns: v.array(saleDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []

    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId', (q) =>
        q.eq('userId', user._id).eq('categoryId', args.categoryId),
      )
      .collect()

    rows.sort((a, b) => b.saleDate - a.saleDate)
    return rows
  },
})

/**
 * Sale line items for one of the user's categories, newest saleDate first
 * (paginated). A missing or another user's categoryId yields an empty page.
 */
export const listByCategoryIdPaginated = authedQuery({
  args: {
    categoryId:     v.id('categories'),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(saleDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return EMPTY_PAGE
    if (!(await getOwned(ctx, 'categories', args.categoryId, user._id))) return EMPTY_PAGE

    return ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId_saleDate', (q) =>
        q.eq('userId', user._id).eq('categoryId', args.categoryId),
      )
      .order('desc')
      .paginate(args.paginationOpts)
  },
})

/** Max sales summed by the getCategorySummary fallback before categoryStats is ready. */
export const CATEGORY_SUMMARY_SCAN_LIMIT = 5000

/**
 * `{ count, totalAmount }` of a category's sales: from categoryStats when the
 * user's category counts are ready, else a bounded scan. The scan is exact up
 * to CATEGORY_SUMMARY_SCAN_LIMIT sales; above that it returns the sums of the
 * first LIMIT sales and `capped: true` (a lower bound — the UI may show
 * "5000+"). Old clients ignore the extra optional field.
 * A missing or another user's categoryId yields zeros.
 */
export const getCategorySummary = authedQuery({
  args: { categoryId: v.id('categories') },
  returns: v.object({ count: v.number(), totalAmount: v.number(), capped: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return { count: 0, totalAmount: 0 }
    if (!(await getOwned(ctx, 'categories', args.categoryId, user._id))) {
      return { count: 0, totalAmount: 0 }
    }

    if (await categoryStatsReady(ctx, user._id)) {
      const row = await getCategoryStatsRow(ctx, user._id, args.categoryId)
      return { count: row?.saleCount ?? 0, totalAmount: row?.totalAmount ?? 0 }
    }

    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId', (q) =>
        q.eq('userId', user._id).eq('categoryId', args.categoryId),
      )
      .take(CATEGORY_SUMMARY_SCAN_LIMIT + 1)
    const capped = rows.length > CATEGORY_SUMMARY_SCAN_LIMIT
    if (capped) rows.length = CATEGORY_SUMMARY_SCAN_LIMIT
    let totalAmount = 0
    for (const r of rows) totalAmount += safe(r.amount)
    return capped ? { count: rows.length, totalAmount, capped } : { count: rows.length, totalAmount }
  },
})

/**
 * Total number of sale line items per category: from categoryStats when
 * categoryCountsReady (and TOTALS_READS is not 'off'), else a full scan.
 */
export const getCountsByCategory = authedQuery({
  args: {},
  returns: v.array(categoryCount),
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []

    if (await categoryStatsReady(ctx, user._id)) {
      const stats = await ctx.db
        .query('categoryStats')
        .withIndex('by_userId_categoryId', (q) => q.eq('userId', user._id))
        .collect()
      return stats
        .filter((s) => s.saleCount > 0)
        .map((s) => ({ categoryId: s.categoryId, count: s.saleCount }))
    }

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

/**
 * Get all sale items for a date range.
 * @deprecated kept for cached PWA clients; remove after 2026-12-17 (not called by the current frontend).
 */
export const getForDateRange = authedQuery({
  args: {
    startDate: v.number(),
    endDate:   v.number(),
  },
  returns: v.array(saleDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []
    return ctx.db
      .query('sales')
      .withIndex('by_userId_saleDate', (q) =>
        q.eq('userId', user._id).gte('saleDate', args.startDate).lte('saleDate', args.endDate),
      )
      .collect()
  },
})

/** Update a sale item; also adjusts the parent session's totalAmount (or moves it to another day) */
export const updateItem = authedMutation({
  args: {
    saleId:      v.id('sales'),
    productName: v.string(),
    amount:      v.number(),
    categoryId:  v.optional(v.id('categories')),
    note:        v.optional(v.string()),
    saleDate:    v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateSaleItem(ctx, ctx.user._id, args)
    return null
  },
})

/** Delete a sale item; also updates or removes the parent session */
export const removeItem = authedMutation({
  args: { saleId: v.id('sales') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeSaleItem(ctx, ctx.user._id, args.saleId)
    return null
  },
})
