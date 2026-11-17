import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { adminQuery } from './lib/functions'
import { adminUserRow } from './lib/returnValidators'
import { isAdminFromIdentity, requireIdentity, upsertUserFromIdentity } from './model/users'

/**
 * Upsert the signed-in user's row, synced from Clerk.
 * Called once on dashboard mount after sign-in. Returns the Convex Id<"users">.
 *
 * SECURITY: the email always comes from the verified JWT identity. `args.email`
 * is accepted only for compatibility with older cached clients and is IGNORED.
 * Name precedence: identity.name → args.name → 'User' (trimmed, ≤ 100 chars).
 * `timeZone` (optional, IANA) is stored when valid; invalid values are ignored.
 * Throws FORBIDDEN ('This email is linked to a different account…') when the
 * email's row is linked to a different Clerk user (see model/users).
 */
export const upsertUser = mutation({
  args: {
    name:     v.optional(v.string()),
    email:    v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  returns: v.id('users'),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    return upsertUserFromIdentity(ctx, identity, { name: args.name, timeZone: args.timeZone })
  },
})

/**
 * Whether the signed-in caller is an admin (Clerk role "Admin" in the JWT
 * claims, see model/users isAdminFromIdentity). Never throws: `{ isAdmin: false }` when signed out.
 * The frontend uses this instead of reading Clerk metadata itself; the server still checks
 * every admin function itself.
 */
export const getMyAccess = query({
  args: {},
  returns: v.object({ isAdmin: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return { isAdmin: identity !== null && isAdminFromIdentity(identity) }
  },
})

/** All users (admin only: Clerk role "Admin"). */
export const listForAdmin = adminQuery({
  args: {},
  returns: v.array(adminUserRow),
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect()
    return rows
      .map((u) => ({ _id: u._id, name: u.name, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  },
})

/**
 * Check a stored / typed view-as target before using it.
 * Returns `{ _id, name }` when the caller is an admin and the id names an
 * existing user; otherwise null (not admin, signed out, malformed or missing
 * id). Never throws.
 */
export const validateViewAsTarget = query({
  args: { userId: v.string() },
  returns: v.union(v.object({ _id: v.id('users'), name: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity || !isAdminFromIdentity(identity)) return null
    const id = ctx.db.normalizeId('users', args.userId)
    if (id === null) return null
    const user = await ctx.db.get('users', id)
    return user ? { _id: user._id, name: user.name } : null
  },
})
