/**
 * Sale / session write helpers. Every write to `saleSessions` and `sales`
 * goes through this file so validation and the Tier 2 totals hooks live in
 * one place.
 *
 * Invariant kept from the legacy code: `sale.saleDate === session.sessionDate`.
 * Validation applies only to NEW values / CHANGED fields, so legacy rows that
 * violate today's limits stay editable.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { NOTE_MAX, PRODUCT_NAME_MAX } from '../lib/limits'
import {
  assertAmount,
  assertClientRequestId,
  assertEntryDate,
  assertItemCount,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../lib/validation'
import { assertOwnedCategory, requireOwned } from '../lib/ownership'
import { assertAppliedKind, findApplied, recordApplied } from './idempotency'
import { totalsOnSaleChange, totalsOnSessionChange } from './totals'

// ─── Tier 2 totals hooks ────────────────────────────────────────────────────
//
// Implemented by delegating to convex/model/totals.ts. Both hooks receive the full documents before and
// after a write (null = did not exist / was deleted) and run in the SAME
// mutation as the write.
//
// onSessionChange call sites (all in this file):
//   1. recordSaleSession — insert new session            (null → after)
//   2. updateSaleItem    — same-date edit, amount changed (before → after)
//   3. updateSaleItem    — date move, old session patched (before → after)
//   4. updateSaleItem    — date move, old session deleted (before → null)
//   5. updateSaleItem    — date move, target session patched (before → after)
//   6. updateSaleItem    — date move, target session inserted (null → after)
//   7. removeSaleItem    — session patched (before → after)
//   8. removeSaleItem    — session deleted (before → null)
//
// onSaleCategoryChange call sites (every `sales` row write; diff categoryId,
// and amount/saleDate if per-category totals are ever needed):
//   1. recordSaleSession — each item inserted (null → after)
//   2. updateSaleItem    — sale patched, same date (before → after)
//   3. updateSaleItem    — sale patched, date move (before → after)
//   4. removeSaleItem    — sale deleted (before → null)

/** Totals hook for every saleSessions insert/patch/delete: updates dailyTotals + userTotals. */
export async function onSessionChange(
  ctx: MutationCtx,
  before: Doc<'saleSessions'> | null,
  after: Doc<'saleSessions'> | null,
): Promise<void> {
  await totalsOnSessionChange(ctx, before, after)
}

/** Totals hook for every sales insert/patch/delete: updates categoryStats (count + amount). */
export async function onSaleCategoryChange(
  ctx: MutationCtx,
  before: Doc<'sales'> | null,
  after: Doc<'sales'> | null,
): Promise<void> {
  await totalsOnSaleChange(ctx, before, after)
}

// ─── Internal write primitives (each one fires its hook) ────────────────────

type SessionPatch = Partial<Pick<Doc<'saleSessions'>, 'totalAmount' | 'itemCount'>>
type SalePatch = Partial<
  Pick<Doc<'sales'>, 'productName' | 'amount' | 'categoryId' | 'note' | 'sessionId' | 'saleDate'>
>

async function insertSession(
  ctx: MutationCtx,
  fields: Omit<Doc<'saleSessions'>, '_id' | '_creationTime'>,
): Promise<Id<'saleSessions'>> {
  const id = await ctx.db.insert('saleSessions', fields)
  await onSessionChange(ctx, null, await ctx.db.get('saleSessions', id))
  return id
}

async function patchSession(
  ctx: MutationCtx,
  before: Doc<'saleSessions'>,
  patch: SessionPatch,
): Promise<void> {
  await ctx.db.patch('saleSessions', before._id, patch)
  await onSessionChange(ctx, before, await ctx.db.get('saleSessions', before._id))
}

async function deleteSession(ctx: MutationCtx, before: Doc<'saleSessions'>): Promise<void> {
  await ctx.db.delete('saleSessions', before._id)
  await onSessionChange(ctx, before, null)
}

async function insertSale(
  ctx: MutationCtx,
  fields: Omit<Doc<'sales'>, '_id' | '_creationTime'>,
): Promise<Id<'sales'>> {
  const id = await ctx.db.insert('sales', fields)
  await onSaleCategoryChange(ctx, null, await ctx.db.get('sales', id))
  return id
}

async function patchSale(ctx: MutationCtx, before: Doc<'sales'>, patch: SalePatch): Promise<void> {
  await ctx.db.patch('sales', before._id, patch)
  await onSaleCategoryChange(ctx, before, await ctx.db.get('sales', before._id))
}

async function deleteSale(ctx: MutationCtx, before: Doc<'sales'>): Promise<void> {
  await ctx.db.delete('sales', before._id)
  await onSaleCategoryChange(ctx, before, null)
}

/**
 * The sale's parent session, only when it belongs to `userId`. A legacy row
 * whose sessionId points at another user's session is treated as orphaned:
 * that session (and its owner's totals) is never touched.
 */
async function getOwnSession(
  ctx: MutationCtx,
  sessionId: Id<'saleSessions'>,
  userId: Id<'users'>,
): Promise<Doc<'saleSessions'> | null> {
  const session = await ctx.db.get('saleSessions', sessionId)
  return session && session.userId === userId ? session : null
}

/**
 * Take one item out of its session: delete the session if it becomes empty,
 * otherwise decrement count and total (clamped at 0, as before). No-op when
 * the session is missing or belongs to another user.
 */
async function detachFromSession(
  ctx: MutationCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
  amount: number,
): Promise<void> {
  const session = await getOwnSession(ctx, sessionId, userId)
  if (!session) return
  const newCount = session.itemCount - 1
  if (newCount <= 0) {
    await deleteSession(ctx, session)
  } else {
    await patchSession(ctx, session, {
      totalAmount: Math.max(0, session.totalAmount - amount),
      itemCount:   newCount,
    })
  }
}

// ─── Public helpers ─────────────────────────────────────────────────────────

export type SaleItemInput = {
  productName: string
  amount:      number
  categoryId?: Id<'categories'>
  note?:       string
}

export type RecordSaleSessionResult = {
  sessionId:   Id<'saleSessions'>
  totalAmount: number
  itemCount:   number
}

/**
 * Validate and insert a session with all its line items (one new session per call).
 * With `clientRequestId`: a replay returns the first result and writes nothing
 * (convex/model/idempotency.ts); without it, behaviour is unchanged.
 */
export async function recordSaleSession(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: { items: SaleItemInput[]; sessionDate: number; clientRequestId?: string },
): Promise<RecordSaleSessionResult> {
  const clientRequestId =
    input.clientRequestId === undefined ? undefined : assertClientRequestId(input.clientRequestId)
  if (clientRequestId !== undefined) {
    const applied = await findApplied(ctx, userId, clientRequestId)
    if (applied) {
      assertAppliedKind(applied, 'sale')
      return {
        sessionId:   applied.sessionId as Id<'saleSessions'>,
        totalAmount: applied.totalAmount,
        itemCount:   applied.itemCount,
      }
    }
  }

  const result = await insertSaleSession(ctx, userId, input)
  if (clientRequestId !== undefined) {
    await recordApplied(ctx, {
      userId,
      clientRequestId,
      kind:        'sale',
      sessionId:   result.sessionId,
      totalAmount: result.totalAmount,
      itemCount:   result.itemCount,
    })
  }
  return result
}

async function insertSaleSession(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: { items: SaleItemInput[]; sessionDate: number },
): Promise<RecordSaleSessionResult> {
  assertItemCount(input.items.length)
  const sessionDate = assertEntryDate(input.sessionDate, 'Sale date')

  const checkedCategories = new Set<Id<'categories'>>()
  const items: SaleItemInput[] = []
  for (const item of input.items) {
    const amount = assertAmount(item.amount)
    const productName = normalizeRequiredText(item.productName, 'Product name', PRODUCT_NAME_MAX)
    const note = normalizeOptionalText(item.note, 'Note', NOTE_MAX)
    if (item.categoryId !== undefined && !checkedCategories.has(item.categoryId)) {
      await assertOwnedCategory(ctx, item.categoryId, userId)
      checkedCategories.add(item.categoryId)
    }
    items.push({ productName, amount, categoryId: item.categoryId, note })
  }

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0)
  const now = Date.now()

  const sessionId = await insertSession(ctx, {
    userId,
    totalAmount,
    itemCount:   items.length,
    sessionDate,
    createdAt:   now,
  })

  for (const item of items) {
    await insertSale(ctx, {
      userId,
      sessionId,
      categoryId:  item.categoryId,
      productName: item.productName,
      amount:      item.amount,
      note:        item.note,
      saleDate:    sessionDate,
      createdAt:   now,
    })
  }

  return { sessionId, totalAmount, itemCount: items.length }
}

export type UpdateSaleItemInput = {
  saleId:      Id<'sales'>
  productName: string
  amount:      number
  categoryId?: Id<'categories'>
  note?:       string
  saleDate?:   number
}

/**
 * Edit one sale line item. A changed `saleDate` moves it into the session
 * with exactly that sessionDate (created if missing); the old session is
 * decremented or deleted. Only changed fields are validated.
 */
export async function updateSaleItem(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: UpdateSaleItemInput,
): Promise<void> {
  const sale = await requireOwned(ctx, 'sales', input.saleId, userId, 'Sale not found')

  const trimmedName = input.productName.trim()
  const productName =
    trimmedName === sale.productName.trim()
      ? trimmedName
      : normalizeRequiredText(input.productName, 'Product name', PRODUCT_NAME_MAX)

  const amount = Object.is(input.amount, sale.amount) ? sale.amount : assertAmount(input.amount)

  const trimmedNote = input.note?.trim() || undefined
  const existingNote = sale.note?.trim() || undefined
  const note =
    trimmedNote === existingNote ? trimmedNote : normalizeOptionalText(input.note, 'Note', NOTE_MAX)

  if (input.categoryId !== undefined && input.categoryId !== sale.categoryId) {
    await assertOwnedCategory(ctx, input.categoryId, userId)
  }
  const categoryId = input.categoryId

  const dateChanged = input.saleDate !== undefined && input.saleDate !== sale.saleDate

  if (dateChanged) {
    const newDate = assertEntryDate(input.saleDate as number, 'Sale date')

    await detachFromSession(ctx, userId, sale.sessionId, sale.amount)

    // User-scoped lookup: only ever joins one of the caller's own sessions.
    const target = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', userId).eq('sessionDate', newDate),
      )
      .first()

    let newSessionId: Id<'saleSessions'>
    if (target) {
      newSessionId = target._id
      await patchSession(ctx, target, {
        totalAmount: target.totalAmount + amount,
        itemCount:   target.itemCount + 1,
      })
    } else {
      newSessionId = await insertSession(ctx, {
        userId,
        totalAmount: amount,
        itemCount:   1,
        sessionDate: newDate,
        createdAt:   Date.now(),
      })
    }

    await patchSale(ctx, sale, {
      productName,
      amount,
      categoryId,
      note,
      sessionId: newSessionId,
      saleDate:  newDate,
    })
    return
  }

  const diff = amount - sale.amount

  await patchSale(ctx, sale, { productName, amount, categoryId, note })

  if (diff !== 0) {
    const session = await getOwnSession(ctx, sale.sessionId, userId)
    if (session) {
      await patchSession(ctx, session, {
        totalAmount: Math.max(0, session.totalAmount + diff),
      })
    }
  }
}

/**
 * Clear `categoryId` on up to `limit` of the user's sales that reference it.
 * Deliberately bypasses `onSaleCategoryChange`: callers delete the category's
 * categoryStats row instead (one write instead of `limit` row patches).
 * Returns the number of sales patched (`=== limit` → more may remain).
 */
export async function unlinkCategoryFromSales(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
  limit: number,
): Promise<number> {
  const rows = await ctx.db
    .query('sales')
    .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).eq('categoryId', categoryId))
    .take(limit)
  for (const row of rows) {
    await ctx.db.patch('sales', row._id, { categoryId: undefined })
  }
  return rows.length
}

/** Delete one sale line item and update or remove its parent session. */
export async function removeSaleItem(
  ctx: MutationCtx,
  userId: Id<'users'>,
  saleId: Id<'sales'>,
): Promise<void> {
  const sale = await requireOwned(ctx, 'sales', saleId, userId, 'Sale not found')
  await deleteSale(ctx, sale)
  await detachFromSession(ctx, userId, sale.sessionId, sale.amount)
}
