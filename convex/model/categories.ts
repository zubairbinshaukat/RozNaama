/**
 * Category write helpers: validation (name 1..40 chars, case-insensitive
 * unique per user, palette color) and ownership in one place.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { validationError } from '../lib/errors'
import { CATEGORY_NAME_MAX } from '../lib/limits'
import { requireOwned } from '../lib/ownership'
import { assertCategoryColor, normalizeRequiredText } from '../lib/validation'
import { internal } from '../_generated/api'
import { unlinkCategoryFromSales } from './sales'
import { deleteCategoryStats, distinctSaleCategoryIds } from './totals'

const NOT_FOUND_MESSAGE = 'Category not found'

function normalizeCategoryName(name: string): string {
  return normalizeRequiredText(name, 'Category name', CATEGORY_NAME_MAX)
}

/**
 * Throw VALIDATION if another category of `userId` already uses `name`
 * (case-insensitive, trimmed). `excludeId` skips the category being renamed.
 * Categories per user are few, so a by_userId read is cheap.
 */
export async function assertUniqueCategoryName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  name: string,
  excludeId?: Id<'categories'>,
): Promise<void> {
  const wanted = name.trim().toLowerCase()
  const existing = await ctx.db
    .query('categories')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect()
  const clash = existing.some(
    (cat) => cat._id !== excludeId && cat.name.trim().toLowerCase() === wanted,
  )
  if (clash) throw validationError('A category with this name already exists')
}

export type CategoryInput = {
  name:  string
  color: string
}

/** Validate and insert a category. Returns its id. */
export async function createCategory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: CategoryInput,
): Promise<Id<'categories'>> {
  const name = normalizeCategoryName(input.name)
  const color = assertCategoryColor(input.color)
  await assertUniqueCategoryName(ctx, userId, name)

  return ctx.db.insert('categories', {
    userId,
    name,
    color,
    createdAt: Date.now(),
  })
}

/**
 * Update name/color of a category owned by `userId`. Only changed fields are
 * validated: a legacy duplicate-name pair can still change color, and the same
 * category may be renamed to a different letter case of its own name.
 */
export async function updateCategory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
  input: CategoryInput,
): Promise<void> {
  const cat = await requireOwned(ctx, 'categories', categoryId, userId, NOT_FOUND_MESSAGE)

  let name = cat.name
  if (input.name.trim() !== cat.name) {
    name = normalizeCategoryName(input.name)
    await assertUniqueCategoryName(ctx, userId, name, categoryId)
  }

  const color = input.color === cat.color ? cat.color : assertCategoryColor(input.color)

  if (name === cat.name && color === cat.color) return
  await ctx.db.patch('categories', categoryId, { name, color })
}

/** Sales unlinked per transaction when a category is deleted. */
export const UNLINK_BATCH_SIZE = 200

/**
 * Unlink up to UNLINK_BATCH_SIZE sales from `categoryId`, delete its
 * categoryStats row, and schedule `categories:unlinkBatch` if more may remain.
 * Idempotent; used by removeCategory, unlinkBatch and the orphan migration.
 */
export async function unlinkCategoryBatch(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
): Promise<number> {
  const unlinked = await unlinkCategoryFromSales(ctx, userId, categoryId, UNLINK_BATCH_SIZE)
  await deleteCategoryStats(ctx, userId, categoryId)
  if (unlinked === UNLINK_BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.categories.unlinkBatch, { userId, categoryId })
  }
  return unlinked
}

/**
 * Delete a category owned by `userId`: its sales become uncategorised (first
 * 200 inline, the rest in scheduled batches) and its categoryStats row goes.
 */
export async function removeCategory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
): Promise<void> {
  await requireOwned(ctx, 'categories', categoryId, userId, NOT_FOUND_MESSAGE)
  await unlinkCategoryBatch(ctx, userId, categoryId)
  await ctx.db.delete('categories', categoryId)
}

/**
 * Unlink every sale of `userId` that references a missing or another user's
 * category (first 200 per id inline, the rest via scheduled unlinkBatch).
 * Idempotent: a clean user is only read, never written.
 */
export async function cleanOrphanCategoryIdsForUser(
  ctx: MutationCtx,
  userId: Id<'users'>,
): Promise<number> {
  let orphans = 0
  for (const categoryId of await distinctSaleCategoryIds(ctx, userId)) {
    const cat = await ctx.db.get('categories', categoryId)
    if (cat && cat.userId === userId) continue
    orphans++
    await unlinkCategoryBatch(ctx, userId, categoryId)
  }
  return orphans
}