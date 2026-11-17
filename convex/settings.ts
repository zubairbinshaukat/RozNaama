/**
 * Shop settings (Advance & Udhaar opt-in and recognition modes).
 * `get` always runs on the client (tiny, one indexed read) and never writes.
 */
import { v } from 'convex/values'
import { authedMutation, authedQuery } from './lib/functions'
import { recognitionValidator, shopSettingsValue } from './lib/returnValidators'
import { DEFAULT_SHOP_SETTINGS, getShopSettings, upsertShopSettings } from './model/settings'

/** The (view-as) user's settings; defaults when there is no row or no user yet. */
export const get = authedQuery({
  args: {},
  returns: shopSettingsValue,
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return { ...DEFAULT_SHOP_SETTINGS }
    return getShopSettings(ctx, user._id)
  },
})

/**
 * Change the caller's own settings (omitted fields keep their value).
 * Recognition changes apply to NEW khata entries only. Turning khata off keeps
 * all data (hidden by the UI).
 */
export const update = authedMutation({
  args: {
    khataEnabled:       v.optional(v.boolean()),
    advanceRecognition: v.optional(recognitionValidator),
    udhaarRecognition:  v.optional(recognitionValidator),
  },
  returns: shopSettingsValue,
  handler: async (ctx, args) => upsertShopSettings(ctx, ctx.user._id, args),
})
