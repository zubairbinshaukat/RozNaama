/**
 * Auth-aware function builders. Use these instead of raw `query`/`mutation`
 * for any function that touches user data.
 *
 * - authedQuery:    adds optional `viewAsUserId` arg (admin view-as);
 *                   ctx.user: Doc<'users'> | null (null = not yet upserted).
 * - authedMutation: ctx.user: Doc<'users'> (throws USER_NOT_FOUND if missing,
 *                   FORBIDDEN if the email row belongs to another Clerk account).
 * - adminQuery:     throws FORBIDDEN unless the caller's JWT carries Clerk role
 *                   "Admin" (model/users isAdminFromIdentity).
 * - adminMutation:  same admin check for writes (no ctx.user: the target user
 *                   comes from the args and is checked by the function).
 * All of them throw UNAUTHORIZED when signed out and expose ctx.identity.
 */
import { v } from 'convex/values'
import { customMutation, customQuery } from 'convex-helpers/server/customFunctions'
import { mutation, query } from '../_generated/server'
import { forbiddenError } from './errors'
import {
  isAdminFromIdentity,
  requireIdentity,
  requireUserForIdentity,
  resolveDataUser,
} from '../model/users'

export const authedQuery = customQuery(query, {
  args: { viewAsUserId: v.optional(v.id('users')) },
  input: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const user = await resolveDataUser(ctx, args.viewAsUserId)
    return { ctx: { identity, user }, args: {} }
  },
})

export const authedMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const user = await requireUserForIdentity(ctx, identity)
    return { ctx: { identity, user }, args: {} }
  },
})

export const adminQuery = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const identity = await requireIdentity(ctx)
    if (!isAdminFromIdentity(identity)) throw forbiddenError()
    return { ctx: { identity }, args: {} }
  },
})

export const adminMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const identity = await requireIdentity(ctx)
    if (!isAdminFromIdentity(identity)) throw forbiddenError()
    return { ctx: { identity }, args: {} }
  },
})