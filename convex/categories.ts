import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireUser, resolveDataUser } from './authHelpers'

/** List all categories for the current user */
export const list = query({
  args: { viewAsUserId: v.optional(v.id('users')) },
  handler: async (ctx, args) => {
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    if (!user) return []
    return ctx.db
      .query('categories')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .collect()
  },
})

/** Create a new category */
export const create = mutation({
  args: { name: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    return ctx.db.insert('categories', {
      userId:    user._id,
      name:      args.name.trim(),
      color:     args.color,
      createdAt: Date.now(),
    })
  },
})

/** Update a category's name and color */
export const update = mutation({
  args: { categoryId: v.id('categories'), name: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    const cat = await ctx.db.get(args.categoryId)
    if (!cat || cat.userId !== user._id) throw new ConvexError('Category not found')
    await ctx.db.patch(args.categoryId, { name: args.name.trim(), color: args.color })
  },
})

/** Remove a category owned by the current user */
export const remove = mutation({
  args: { categoryId: v.id('categories') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!user) throw new ConvexError('User not found — please sign in again')
    const cat = await ctx.db.get(args.categoryId)
    if (!cat || cat.userId !== user._id) throw new ConvexError('Category not found')
    await ctx.db.delete(args.categoryId)
  },
})
