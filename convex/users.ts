import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { isAdminFromIdentity } from './authHelpers'

/**
 * Upsert a user record synced from Clerk.
 * Called once on dashboard mount after sign-in.
 * Returns the Convex Id<"users"> for the signed-in user.
 */
export const upsertUser = mutation({
  args: {
    name:  v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Unauthorized')

    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first()

    if (existing) {
      // Update name if it changed
      if (existing.name !== args.name) {
        await ctx.db.patch(existing._id, { name: args.name })
      }
      return existing._id
    }

    return ctx.db.insert('users', {
      name:      args.name,
      email:     args.email,
      createdAt: Date.now(),
    })
  },
})

/** All users (admin only). Clerk JWT must include public_metadata with role "Admin". */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Unauthorized')
    if (!isAdminFromIdentity(identity)) throw new ConvexError('Forbidden')

    const rows = await ctx.db.query('users').collect()
    return rows
      .map((u) => ({ _id: u._id, name: u.name, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  },
})
