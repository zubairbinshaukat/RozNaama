import { ConvexError } from 'convex/values'
import type { UserIdentity } from 'convex/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

function roleFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const role = (value as { role?: unknown }).role
  return typeof role === 'string' ? role : undefined
}

/**
 * Admin is determined from Clerk JWT claims (`role: "Admin"`).
 * Different Clerk templates can expose this as:
 * - public_metadata.role
 * - publicMetadata.role
 * - namespaced claim ending in /public_metadata or /publicMetadata
 * - top-level role
 */
function getRoleFromIdentity(identity: UserIdentity): string | undefined {
  const rec = identity as Record<string, unknown>

  // 1) Most common explicit role claim
  if (typeof rec.role === 'string') return rec.role

  // 2) Standard Clerk metadata keys
  const direct = roleFromUnknown(rec.public_metadata) ?? roleFromUnknown(rec.publicMetadata)
  if (direct) return direct

  // 3) Namespaced claims (e.g. "https://clerk.../public_metadata")
  for (const [key, value] of Object.entries(rec)) {
    if (key.endsWith('/public_metadata') || key.endsWith('/publicMetadata')) {
      const namespacedRole = roleFromUnknown(value)
      if (namespacedRole) return namespacedRole
    }
  }

  return undefined
}

export function isAdminFromIdentity(identity: UserIdentity): boolean {
  return getRoleFromIdentity(identity) === 'Admin'
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Unauthorized')

  const email = identity.email
  if (!email) throw new ConvexError('No email on identity')

  return ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
}

/** User whose data to read in queries. Admins may pass viewAsUserId to read another user. */
export async function resolveDataUser(
  ctx: QueryCtx | MutationCtx,
  viewAsUserId: Id<'users'> | undefined,
): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Unauthorized')

  if (viewAsUserId === undefined) {
    const email = identity.email
    if (!email) throw new ConvexError('No email on identity')
    return ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
  }

  if (!isAdminFromIdentity(identity)) throw new ConvexError('Forbidden')

  const target = await ctx.db.get(viewAsUserId)
  if (!target) throw new ConvexError('User not found')

  return target
}
