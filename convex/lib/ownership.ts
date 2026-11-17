import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { notFoundError } from './errors'

type ReadCtx = QueryCtx | MutationCtx

/** Tables whose rows carry an owning `userId`. */
export type OwnedTable = 'categories' | 'saleSessions' | 'sales' | 'expenses'

/** Load `id` from `table` if it exists AND belongs to `userId`; otherwise null. */
export async function getOwned<T extends OwnedTable>(
  ctx: ReadCtx,
  table: T,
  id: Id<T>,
  userId: Id<'users'>,
): Promise<Doc<T> | null> {
  const doc = await ctx.db.get(table, id)
  if (!doc) return null
  const owner: unknown = (doc as { userId?: unknown }).userId
  return owner === userId ? doc : null
}

/** Like getOwned but throws `{ code: 'NOT_FOUND', message }` instead of returning null. */
export async function requireOwned<T extends OwnedTable>(
  ctx: ReadCtx,
  table: T,
  id: Id<T>,
  userId: Id<'users'>,
  message: string,
): Promise<Doc<T>> {
  const doc = await getOwned(ctx, table, id, userId)
  if (!doc) throw notFoundError(message)
  return doc
}

/** Category must exist and belong to `userId`; throws NOT_FOUND 'Category not found'. */
export async function assertOwnedCategory(
  ctx: ReadCtx,
  categoryId: Id<'categories'>,
  userId: Id<'users'>,
): Promise<Doc<'categories'>> {
  return requireOwned(ctx, 'categories', categoryId, userId, 'Category not found')
}
