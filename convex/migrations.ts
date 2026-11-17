/**
 * Data migrations (via the @convex-dev/migrations component). All iterate
 * `users` with batchSize 1 (one user per transaction) and are idempotent.
 *
 * Rollout order (owner runs these; agents never do). Dev first, then add --prod:
 *   npx convex run --% migrations:run "{\"fn\":\"migrations:cleanOrphanCategoryIds\",\"dryRun\":true}"
 *   npx convex run --% migrations:run "{\"fn\":\"migrations:cleanOrphanCategoryIds\"}"
 *   npx convex run --% migrations:run "{\"fn\":\"migrations:backfillUserTotals\"}"
 *   npx convex run --% migrations:run "{\"fn\":\"migrations:backfillCategoryStats\"}"
 *   npx convex run --component migrations lib:getStatus --watch
 *   npx convex run --% totals:status "{}"
 *
 * Force-rebuild everyone (skips nothing):
 *   npx convex run --% migrations:run "{\"fn\":\"migrations:rebuildAllUserTotals\"}"
 */
import { Migrations } from '@convex-dev/migrations'
import { components } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { DataModel } from './_generated/dataModel'
import { cleanOrphanCategoryIdsForUser } from './model/categories'
import {
  backfillCategoryStatsForUser,
  getTotalsState,
  preferredBucketTimeZone,
  startRebuild,
} from './model/totals'

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
})

/** Generic runner: `migrations:run {"fn": "migrations:<name>"}`. */
export const run = migrations.runner()

/** Unlink sales whose categoryId points at a missing or another user's category. */
export const cleanOrphanCategoryIds = migrations.define({
  table: 'users',
  batchSize: 1,
  migrateOne: async (ctx, user) => {
    await cleanOrphanCategoryIdsForUser(ctx, user._id)
  },
})

/**
 * Start a dailyTotals/userTotals rebuild per user (the rebuild itself runs in
 * scheduled `totals:rebuildMonth` steps; follow with `totals:status`).
 * Users already ready in their current zone are skipped.
 */
export const backfillUserTotals = migrations.define({
  table: 'users',
  batchSize: 1,
  migrateOne: async (ctx, user) => {
    const state = await getTotalsState(ctx, user._id)
    if (state?.totalsReady && state.timeZone === preferredBucketTimeZone(user)) return
    await startRebuild(ctx, user._id)
  },
})

/**
 * Force a dailyTotals/userTotals rebuild for EVERY user, ready or not (repair
 * after a rollback window or a suspected drift). Users stay on the scan path
 * until their own rebuild finishes. Re-run with `"reset":true` to force again.
 */
export const rebuildAllUserTotals = migrations.define({
  table: 'users',
  batchSize: 1,
  migrateOne: async (ctx, user) => {
    await startRebuild(ctx, user._id)
  },
})

/**
 * Recount categoryStats per user and set categoryCountsReady (≤ 8000
 * categorised sales; above that it sets categoryCountsReady=false). Always
 * recounts, so `"reset":true` is the force path.
 */
export const backfillCategoryStats = migrations.define({
  table: 'users',
  batchSize: 1,
  migrateOne: async (ctx, user) => {
    await backfillCategoryStatsForUser(ctx, user._id)
  },
})
