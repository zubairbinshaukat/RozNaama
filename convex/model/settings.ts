/**
 * Per-shop settings (`shopSettings`). No row = defaults: khata off, both
 * recognitions 'delivery'. Reads never write; `upsertShopSettings` is the only
 * writer.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type ReadCtx = QueryCtx | MutationCtx

export type Recognition = Doc<'shopSettings'>['advanceRecognition']

export type ShopSettings = Pick<
  Doc<'shopSettings'>,
  'khataEnabled' | 'advanceRecognition' | 'udhaarRecognition' | 'updatedAt'
>

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  khataEnabled:       false,
  advanceRecognition: 'delivery',
  udhaarRecognition:  'delivery',
  updatedAt:          0,
}

export function getShopSettingsRow(ctx: ReadCtx, userId: Id<'users'>): Promise<Doc<'shopSettings'> | null> {
  return ctx.db
    .query('shopSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
}

/** Settings of `userId` (defaults when there is no row). */
export async function getShopSettings(ctx: ReadCtx, userId: Id<'users'>): Promise<ShopSettings> {
  const row = await getShopSettingsRow(ctx, userId)
  if (!row) return { ...DEFAULT_SHOP_SETTINGS }
  return {
    khataEnabled:       row.khataEnabled,
    advanceRecognition: row.advanceRecognition,
    udhaarRecognition:  row.udhaarRecognition,
    updatedAt:          row.updatedAt,
  }
}

export type ShopSettingsPatch = Partial<
  Pick<ShopSettings, 'khataEnabled' | 'advanceRecognition' | 'udhaarRecognition'>
>

/** Insert or patch the user's settings row. Returns the new settings. */
export async function upsertShopSettings(
  ctx: MutationCtx,
  userId: Id<'users'>,
  patch: ShopSettingsPatch,
): Promise<ShopSettings> {
  const existing = await getShopSettingsRow(ctx, userId)
  const base = existing ?? DEFAULT_SHOP_SETTINGS
  const next: ShopSettings = {
    khataEnabled:       patch.khataEnabled ?? base.khataEnabled,
    advanceRecognition: patch.advanceRecognition ?? base.advanceRecognition,
    udhaarRecognition:  patch.udhaarRecognition ?? base.udhaarRecognition,
    updatedAt:          Date.now(),
  }
  if (existing) await ctx.db.patch('shopSettings', existing._id, next)
  else await ctx.db.insert('shopSettings', { userId, ...next })
  return next
}
