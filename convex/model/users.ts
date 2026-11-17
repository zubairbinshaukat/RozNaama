/**
 * The single place that resolves a Clerk identity to a `users` row.
 * Every Convex function goes through these helpers (directly or via
 * `convex/lib/functions.ts` wrappers).
 *
 * Lookup order: `by_token` (stable Clerk `tokenIdentifier`) first, then the
 * verified JWT email (`by_email`, for rows created before tokens were linked,
 * or linked under another issuer for the same Clerk subject). An email row
 * linked to a DIFFERENT subject is never handed out (queries: no user;
 * mutations / upsertUser: FORBIDDEN).
 * Queries never write; `upsertUserFromIdentity` links the token lazily.
 */
import type { UserIdentity } from 'convex/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import {
  appError,
  ERROR_CODES,
  forbiddenError,
  unauthorizedError,
  userNotFoundError,
} from '../lib/errors'
import { USER_NAME_MAX } from '../lib/limits'
import { normalizeTimeZone } from '../lib/time'

type AuthCtx = Pick<QueryCtx, 'auth'>
type ReadCtx = QueryCtx | MutationCtx

function roleFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const role = (value as { role?: unknown }).role
  return typeof role === 'string' ? role : undefined
}

/**
 * Role from the Clerk JWT claims. Clerk templates can expose it as:
 * - top-level `role`
 * - `public_metadata.role` / `publicMetadata.role`
 * - a namespaced claim ending in `/public_metadata` or `/publicMetadata`
 * Public metadata is only writable from the Clerk dashboard / backend API,
 * never by the user, and the JWT is signed by Clerk.
 */
function getRoleFromIdentity(identity: UserIdentity): string | undefined {
  const rec = identity as Record<string, unknown>

  if (typeof rec.role === 'string') return rec.role

  const direct = roleFromUnknown(rec.public_metadata) ?? roleFromUnknown(rec.publicMetadata)
  if (direct) return direct

  for (const [key, value] of Object.entries(rec)) {
    if (key.endsWith('/public_metadata') || key.endsWith('/publicMetadata')) {
      const namespacedRole = roleFromUnknown(value)
      if (namespacedRole) return namespacedRole
    }
  }

  return undefined
}

/** Admin = Clerk role `"Admin"` (exact match) in the JWT claims. The single admin check. */
export function isAdminFromIdentity(identity: UserIdentity): boolean {
  return getRoleFromIdentity(identity) === 'Admin'
}

/** Signed-in identity or throw `{ code: 'UNAUTHORIZED', message: 'Unauthorized' }`. */
export async function requireIdentity(ctx: AuthCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw unauthorizedError()
  return identity
}

/** Non-empty token / email from the identity, else undefined. */
function tokenOf(identity: UserIdentity): string | undefined {
  const token: unknown = identity.tokenIdentifier
  return typeof token === 'string' && token.length > 0 ? token : undefined
}

function emailOf(identity: UserIdentity): string | undefined {
  const email: unknown = identity.email
  return typeof email === 'string' && email.length > 0 ? email : undefined
}

async function findByToken(ctx: ReadCtx, token: string): Promise<Doc<'users'> | null> {
  return ctx.db
    .query('users')
    .withIndex('by_token', (q) => q.eq('tokenIdentifier', token))
    .first()
}

async function findByEmail(ctx: ReadCtx, email: string): Promise<Doc<'users'> | null> {
  return ctx.db
    .query('users')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
}

/** Shown when the email belongs to a row linked to a different Clerk account. */
export const ACCOUNT_CONFLICT_MESSAGE = 'This email is linked to a different account. Please contact support.'

export const accountConflictError = () => appError(ERROR_CODES.FORBIDDEN, ACCOUNT_CONFLICT_MESSAGE)

/**
 * Subject part of a stored token. Convex builds `tokenIdentifier` as
 * `${issuer}|${subject}` (see `UserIdentity.tokenIdentifier`: "JWT claims:
 * sub + iss"; convex-test does the same). Clerk subjects (`user_…`) never
 * contain '|', so the subject is everything after the LAST '|'.
 */
function subjectOfToken(token: string): string | undefined {
  const sep = token.lastIndexOf('|')
  if (sep < 0) return undefined
  const subject = token.slice(sep + 1)
  return subject.length > 0 ? subject : undefined
}

/**
 * True when `storedToken` names the same Clerk user as `identity` and only the
 * issuer differs (e.g. the Clerk instance / Frontend API domain changed).
 * A subject containing '|' is never treated as a match (ambiguous split).
 */
function isSameSubject(storedToken: string, identity: UserIdentity): boolean {
  const subject: unknown = identity.subject
  if (typeof subject !== 'string' || subject.length === 0 || subject.includes('|')) return false
  return subjectOfToken(storedToken) === subject
}

type IdentityMatch =
  /** `relink`: the row is not yet linked to this identity's token. */
  | { kind: 'user'; user: Doc<'users'>; relink: boolean }
  /** The email row is linked to a different Clerk user (different subject). */
  | { kind: 'conflict'; user: Doc<'users'> }
  | { kind: 'none' }

/**
 * Resolve an identity without writing:
 * 1. `by_token` match → that row;
 * 2. else the verified-email row:
 *    - no tokenIdentifier (legacy row) → allowed, needs linking;
 *    - token with the same subject, different issuer → allowed, needs relinking;
 *    - token of a different subject (e.g. a re-created Clerk account) → conflict;
 * 3. else none.
 */
async function matchIdentity(ctx: ReadCtx, identity: UserIdentity): Promise<IdentityMatch> {
  const token = tokenOf(identity)
  if (token) {
    const byToken = await findByToken(ctx, token)
    if (byToken) return { kind: 'user', user: byToken, relink: false }
  }
  const email = emailOf(identity)
  if (!email) return { kind: 'none' }
  const byEmail = await findByEmail(ctx, email)
  if (!byEmail) return { kind: 'none' }

  const stored = byEmail.tokenIdentifier
  if (stored === undefined || stored === '') return { kind: 'user', user: byEmail, relink: token !== undefined }
  if (stored === token) return { kind: 'user', user: byEmail, relink: false }
  if (isSameSubject(stored, identity)) return { kind: 'user', user: byEmail, relink: token !== undefined }
  return { kind: 'conflict', user: byEmail }
}

/**
 * Look up the `users` row for an identity (see `matchIdentity`). Never writes.
 * Returns null when no row matches — including an email row linked to a
 * different Clerk account, so queries return empty data for that identity.
 */
export async function findUserForIdentity(
  ctx: ReadCtx,
  identity: UserIdentity,
): Promise<Doc<'users'> | null> {
  const match = await matchIdentity(ctx, identity)
  return match.kind === 'user' ? match.user : null
}

/**
 * Row for a mutation: throws FORBIDDEN (account conflict) when the email row
 * is linked to a different Clerk account, USER_NOT_FOUND when there is no row.
 */
export async function requireUserForIdentity(
  ctx: ReadCtx,
  identity: UserIdentity,
): Promise<Doc<'users'>> {
  const match = await matchIdentity(ctx, identity)
  if (match.kind === 'user') return match.user
  if (match.kind === 'conflict') throw accountConflictError()
  throw userNotFoundError('User not found — please sign in again')
}

/** Current signed-in user's row (or null if not yet upserted). Throws if signed out. */
export async function getCurrentUser(ctx: ReadCtx): Promise<Doc<'users'> | null> {
  const identity = await requireIdentity(ctx)
  return findUserForIdentity(ctx, identity)
}

/**
 * User whose data to read in queries. Admins may pass `viewAsUserId` to read
 * another user; non-admins get FORBIDDEN, a missing target USER_NOT_FOUND.
 */
export async function resolveDataUser(
  ctx: ReadCtx,
  viewAsUserId: Id<'users'> | undefined,
): Promise<Doc<'users'> | null> {
  const identity = await requireIdentity(ctx)
  if (viewAsUserId === undefined) return findUserForIdentity(ctx, identity)

  if (!isAdminFromIdentity(identity)) throw forbiddenError()

  const target = await ctx.db.get('users', viewAsUserId)
  if (!target) throw userNotFoundError()
  return target
}

/** Display name: identity name, then client-supplied name, then 'User'; trimmed and capped. */
export function displayNameFor(identity: UserIdentity, fallbackName: string | undefined): string {
  const candidates = [identity.name, fallbackName]
  for (const candidate of candidates) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : ''
    if (trimmed.length > 0) return trimmed.slice(0, USER_NAME_MAX)
  }
  return 'User'
}

/** Valid IANA zone from the client, or undefined (invalid / blank input is ignored). */
export function clientTimeZone(timeZone: string | undefined): string | undefined {
  const normalized = normalizeTimeZone(timeZone, '')
  return normalized.length > 0 ? normalized : undefined
}

type UserPatch = Partial<Pick<Doc<'users'>, 'name' | 'email' | 'tokenIdentifier' | 'timeZone'>>

/**
 * Create or update the `users` row for the signed-in identity.
 * The email ALWAYS comes from the verified JWT, never from the client.
 *
 * - token match → patch only changed name / timeZone, and the email if the
 *   Clerk email changed and no other row already owns the new email;
 * - email match with no token → link the token (plus changed name / timeZone);
 * - email match whose token has the same subject but another issuer → relink;
 * - email match linked to a DIFFERENT subject → FORBIDDEN (account conflict);
 * - no email and no token match → UNAUTHORIZED 'No email on identity';
 * - otherwise insert a new row with the token.
 */
export async function upsertUserFromIdentity(
  ctx: MutationCtx,
  identity: UserIdentity,
  opts: { name?: string; timeZone?: string } = {},
): Promise<Id<'users'>> {
  const token = tokenOf(identity)
  const email = emailOf(identity)
  const name = displayNameFor(identity, opts.name)
  const timeZone = clientTimeZone(opts.timeZone)

  const changedProfile = (row: Doc<'users'>): UserPatch => {
    const patch: UserPatch = {}
    if (row.name !== name) patch.name = name
    if (timeZone !== undefined && row.timeZone !== timeZone) patch.timeZone = timeZone
    return patch
  }

  const applyPatch = async (row: Doc<'users'>, patch: UserPatch): Promise<Id<'users'>> => {
    if (Object.keys(patch).length > 0) await ctx.db.patch('users', row._id, patch)
    return row._id
  }

  if (token) {
    const byToken = await findByToken(ctx, token)
    if (byToken) {
      const patch = changedProfile(byToken)
      if (email && byToken.email !== email) {
        const owner = await findByEmail(ctx, email)
        if (owner && owner._id !== byToken._id) {
          console.warn(
            `upsertUser: email change for user ${byToken._id} skipped; email already used by ${owner._id}`,
          )
        } else {
          patch.email = email
        }
      }
      return applyPatch(byToken, patch)
    }
  }

  if (!email) throw appError(ERROR_CODES.UNAUTHORIZED, 'No email on identity')

  const byEmail = await findByEmail(ctx, email)
  if (byEmail) {
    const stored = byEmail.tokenIdentifier
    const legacy = stored === undefined || stored === ''
    if (legacy || isSameSubject(stored, identity)) {
      // Legacy row (link) or same Clerk user under a new issuer (relink).
      const patch = changedProfile(byEmail)
      if (token && stored !== token) patch.tokenIdentifier = token
      if (!legacy && patch.tokenIdentifier !== undefined) {
        console.warn(`upsertUser: user ${byEmail._id} relinked to a new issuer for the same subject`)
      }
      return applyPatch(byEmail, patch)
    }
    // Linked to a different Clerk user with the same email (e.g. a re-created
    // account). Never hand over or re-point the row.
    console.warn(
      `upsertUser: user ${byEmail._id} is linked to a different Clerk subject; access denied`,
    )
    throw accountConflictError()
  }

  return ctx.db.insert('users', {
    name,
    email,
    createdAt: Date.now(),
    ...(token ? { tokenIdentifier: token } : {}),
    ...(timeZone !== undefined ? { timeZone } : {}),
  })
}
