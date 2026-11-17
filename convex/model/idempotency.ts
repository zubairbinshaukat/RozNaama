/**
 * Idempotency ledger for creates replayed by the offline outbox.
 *
 * A create that carries a `clientRequestId` first looks it up here
 * (`findApplied`). A hit returns the stored result and the caller writes
 * nothing (so the totals hooks never run twice). A miss runs the normal
 * insert + hooks and then `recordApplied` in the SAME mutation, so the ledger
 * row exists iff the create committed. Concurrent replays of one id are
 * serialised by Convex OCC: both read the same index range, so the loser
 * retries and then sees the winner's row.
 *
 * Creates without a `clientRequestId` (old clients) never touch this table.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { validationError } from '../lib/errors'

export type ClientRequestKind = Doc<'clientRequests'>['kind']

/** The ledger row for (userId, clientRequestId), or null. */
export async function findApplied(
  ctx: MutationCtx,
  userId: Id<'users'>,
  clientRequestId: string,
): Promise<Doc<'clientRequests'> | null> {
  return ctx.db
    .query('clientRequests')
    .withIndex('by_userId_clientRequestId', (q) =>
      q.eq('userId', userId).eq('clientRequestId', clientRequestId),
    )
    .first()
}

/** A hit of another kind (or a malformed row) is a client bug: never apply or return it. */
export function assertAppliedKind(row: Doc<'clientRequests'>, kind: ClientRequestKind): void {
  const hasTarget = kind === 'sale' ? row.sessionId !== undefined : row.expenseId !== undefined
  if (row.kind !== kind || !hasTarget) {
    throw validationError('clientRequestId was already used for a different entry')
  }
}

/** Remember a committed create. Call only after the insert + hooks succeeded. */
export async function recordApplied(
  ctx: MutationCtx,
  fields: Omit<Doc<'clientRequests'>, '_id' | '_creationTime' | 'createdAt'>,
): Promise<void> {
  await ctx.db.insert('clientRequests', { ...fields, createdAt: Date.now() })
}
