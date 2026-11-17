import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { authedMutation, authedQuery } from './lib/functions'
import { categoryDoc } from './lib/returnValidators'
import {
  createCategory,
  removeCategory,
  unlinkCategoryBatch,
  updateCategory,
} from './model/categories'

/** List all categories for the current user (small per user, so collect is fine) */
export const list = authedQuery({
  args: {},
  returns: v.array(categoryDoc),
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return []
    return ctx.db
      .query('categories')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .collect()
  },
})

/** Create a new category */
export const create = authedMutation({
  args: { name: v.string(), color: v.string() },
  returns: v.id('categories'),
  handler: async (ctx, args) => createCategory(ctx, ctx.user._id, args),
})

/** Update a category's name and color */
export const update = authedMutation({
  args: { categoryId: v.id('categories'), name: v.string(), color: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateCategory(ctx, ctx.user._id, args.categoryId, {
      name:  args.name,
      color: args.color,
    })
    return null
  },
})

/** Remove a category owned by the current user */
export const remove = authedMutation({
  args: { categoryId: v.id('categories') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeCategory(ctx, ctx.user._id, args.categoryId)
    return null
  },
})

/**
 * Continuation of `remove` (and of the orphan migration): unlink the next
 * batch of sales from a deleted category; reschedules itself until done.
 */
export const unlinkBatch = internalMutation({
  args: { userId: v.id('users'), categoryId: v.id('categories') },
  returns: v.number(),
  handler: async (ctx, args) => unlinkCategoryBatch(ctx, args.userId, args.categoryId),
})