/**
 * Links between sale sessions and khata entries (`khataSessionLinks`) and the
 * sale-edit guard used by model/sales.
 *
 * Must NOT import model/sales (model/sales imports this file). Session writes
 * for khata live in model/khata.
 *
 * Cost for shops without khata data: guardSessionEdit / sessionHasLinks are
 * one indexed read on an empty range.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { KHATA_MESSAGES, validationError } from '../lib/errors'
import { formatPkr, deliveredStatus, patchEntry, toPaisa } from './khataBalance'
import { getShopSettings } from './settings'

type ReadCtx = QueryCtx | MutationCtx

export type SessionLink = Doc<'khataSessionLinks'>

/** Max links one session can carry (normally exactly one). */
const LINKS_PER_SESSION_LIMIT = 10

/** The user's links for one session (normally 0 or 1). */
export async function getSessionLinks(
  ctx: ReadCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
): Promise<SessionLink[]> {
  const rows = await ctx.db
    .query('khataSessionLinks')
    .withIndex('by_saleSessionId', (q) => q.eq('saleSessionId', sessionId))
    .take(LINKS_PER_SESSION_LIMIT)
  return rows.filter((r) => r.userId === userId)
}

/** True when the session belongs to khata (used to avoid merging a moved sale into it). */
export async function sessionHasLinks(
  ctx: ReadCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
): Promise<boolean> {
  return (await getSessionLinks(ctx, userId, sessionId)).length > 0
}

export async function insertLink(
  ctx: MutationCtx,
  fields: Omit<SessionLink, '_id' | '_creationTime'>,
): Promise<Id<'khataSessionLinks'>> {
  return ctx.db.insert('khataSessionLinks', fields)
}

/** Delete every link of the user's session. */
export async function deleteSessionLinks(
  ctx: MutationCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
): Promise<void> {
  for (const link of await getSessionLinks(ctx, userId, sessionId)) {
    await ctx.db.delete('khataSessionLinks', link._id)
  }
}

export type GuardOptions = {
  dateChanged:      boolean
  amountChanged:    boolean
  /** Lazily evaluated: only read when the session has a delivery link. */
  removingLastItem: boolean | (() => Promise<boolean>)
}

/**
 * Called by updateSaleItem / removeSaleItem before any write.
 *  - no link → null (no-op; one indexed read).
 *  - payment link → every edit is blocked.
 *  - delivery link → date change and deleting the last item are blocked; a
 *    cancelled entry's session ("Advance kept") also blocks amount changes.
 *    Other edits are allowed; returns the link so the caller runs
 *    syncDeliveryTotal after the write.
 * With khata turned off the message asks to turn it on.
 */
export async function guardSessionEdit(
  ctx: MutationCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
  opts: GuardOptions,
): Promise<SessionLink | null> {
  const links = await getSessionLinks(ctx, userId, sessionId)
  if (links.length === 0) return null

  const block = async (message: string): Promise<never> => {
    const { khataEnabled } = await getShopSettings(ctx, userId)
    throw validationError(khataEnabled ? message : KHATA_MESSAGES.KHATA_OFF_LOCK)
  }

  if (links.some((l) => l.role === 'payment')) return block(KHATA_MESSAGES.PAYMENT_LOCK)

  const delivery = links.find((l) => l.role === 'delivery')
  if (!delivery) return null
  const entry = await ctx.db.get('khataEntries', delivery.entryId)
  if (!entry || entry.userId !== userId) return null // stale link: treat as a normal sale

  if (opts.dateChanged) return block(KHATA_MESSAGES.DELIVERY_LOCK)
  if (entry.status === 'cancelled' && opts.amountChanged) return block(KHATA_MESSAGES.DELIVERY_LOCK)
  const removingLast =
    typeof opts.removingLastItem === 'function' ? await opts.removingLastItem() : opts.removingLastItem
  if (removingLast) return block(KHATA_MESSAGES.DELIVERY_LOCK)
  return delivery
}

/**
 * After an allowed edit of a delivery session: entry.total = session total.
 * Rejects (VALIDATION, whole mutation rolls back) when the new total is below
 * what was already paid (+ forgiven). Recomputes due/settled.
 */
export async function syncDeliveryTotal(
  ctx: MutationCtx,
  userId: Id<'users'>,
  link: SessionLink,
): Promise<void> {
  const [session, entry] = await Promise.all([
    ctx.db.get('saleSessions', link.saleSessionId),
    ctx.db.get('khataEntries', link.entryId),
  ])
  if (!session || session.userId !== userId) return
  if (!entry || entry.userId !== userId || entry.status === 'cancelled') return
  if (entry.total !== undefined && toPaisa(entry.total) === toPaisa(session.totalAmount)) return

  const floor = toPaisa(entry.paid) + toPaisa(entry.forgiven)
  if (toPaisa(session.totalAmount) < floor) {
    throw validationError(`Bill can't be less than paid (${formatPkr(floor / 100)})`)
  }
  const next = { total: session.totalAmount, paid: entry.paid, forgiven: entry.forgiven }
  const status = deliveredStatus(next)
  await patchEntry(ctx, entry, {
    total:    session.totalAmount,
    status,
    closedAt: status === 'settled' ? (entry.closedAt ?? Date.now()) : undefined,
  })
}
