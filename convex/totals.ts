/**
 * Internal operations for the Tier 2 summary tables (never public).
 *
 *   npx convex run --% totals:rebuildUserTotals "{\"userId\":\"<id>\"}"
 *   npx convex run --% totals:verifyUserTotals "{\"userId\":\"<id>\",\"monthKey\":\"2026-11\"}"
 *   npx convex run --% totals:status "{}"
 */
import { v, type Infer } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import {
  getTotalsState,
  getUserTotals,
  rebuildStep,
  startRebuild,
  verifyMonth,
} from './model/totals'
import { DEFAULT_TIME_ZONE, dateKeyInTimeZone } from './lib/time'

const dayValues = v.object({
  salesTotal:   v.number(),
  itemCount:    v.number(),
  sessionCount: v.number(),
  expenseTotal: v.number(),
  expenseCount: v.number(),
})

/** Recompute dailyTotals + userTotals for one user (month at a time, scheduled). */
export const rebuildUserTotals = internalMutation({
  args: { userId: v.id('users') },
  returns: v.union(
    v.null(),
    v.object({
      generation: v.number(),
      timeZone:   v.string(),
      cursor:     v.union(v.string(), v.null()),
      end:        v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => startRebuild(ctx, args.userId),
})

/** One rebuild step; aborts when `generation`/`cursor` are stale. */
export const rebuildMonth = internalMutation({
  args: { userId: v.id('users'), generation: v.number(), cursor: v.string() },
  returns: v.union(v.literal('stale'), v.literal('split'), v.literal('next'), v.literal('done')),
  handler: async (ctx, args) => rebuildStep(ctx, args.userId, args.generation, args.cursor),
})

/** Read-only: compare one month (default: current month) with a recompute from source. */
export const verifyUserTotals = internalQuery({
  args: { userId: v.id('users'), monthKey: v.optional(v.string()) },
  returns: v.object({
    exists:      v.boolean(),
    totalsReady: v.boolean(),
    timeZone:    v.string(),
    monthKey:    v.string(),
    ok:          v.boolean(),
    mismatches:  v.array(v.object({
      dayKey:   v.string(),
      expected: v.union(dayValues, v.null()),
      actual:   v.union(dayValues, v.null()),
    })),
  }),
  handler: async (ctx, args) => {
    const state = await getTotalsState(ctx, args.userId)
    const timeZone = state?.timeZone ?? DEFAULT_TIME_ZONE
    const monthKey = args.monthKey ?? dateKeyInTimeZone(Date.now(), timeZone).slice(0, 7)
    const mismatches = await verifyMonth(ctx, args.userId, timeZone, monthKey)
    return {
      exists:      state !== null,
      totalsReady: state?.totalsReady ?? false,
      timeZone,
      monthKey,
      ok:          mismatches.length === 0,
      mismatches,
    }
  },
})

const STATUS_SCAN_LIMIT = 5000

const statusUser = v.object({
  timeZone:            v.string(),
  totalsReady:         v.boolean(),
  categoryCountsReady: v.boolean(),
  rebuildGeneration:   v.number(),
  rebuildCursor:       v.union(v.string(), v.null()),
  rebuildEnd:          v.union(v.string(), v.null()),
  salesTotal:          v.number(),
  itemCount:           v.number(),
  expenseTotal:        v.number(),
  expenseCount:        v.number(),
})

/**
 * Backfill progress: counts over totalsState (gate) and userTotals (rebuild
 * cursors), plus one user's merged row when `userId` is given.
 */
export const status = internalQuery({
  args: { userId: v.optional(v.id('users')) },
  returns: v.object({
    rows:                v.number(),
    totalsReady:         v.number(),
    categoryCountsReady: v.number(),
    rebuilding:          v.number(),
    truncated:           v.boolean(),
    user: v.union(v.null(), statusUser),
  }),
  handler: async (ctx, args) => {
    const [states, sums] = await Promise.all([
      ctx.db.query('totalsState').take(STATUS_SCAN_LIMIT + 1),
      ctx.db.query('userTotals').take(STATUS_SCAN_LIMIT + 1),
    ])
    const truncated = states.length > STATUS_SCAN_LIMIT || sums.length > STATUS_SCAN_LIMIT
    const scanned = states.slice(0, STATUS_SCAN_LIMIT)
    let user: Infer<typeof statusUser> | null = null
    if (args.userId !== undefined) {
      const [state, totals] = await Promise.all([
        getTotalsState(ctx, args.userId),
        getUserTotals(ctx, args.userId),
      ])
      if (state) {
        user = {
          timeZone:            state.timeZone,
          totalsReady:         state.totalsReady,
          categoryCountsReady: state.categoryCountsReady,
          rebuildGeneration:   totals?.rebuildGeneration ?? 0,
          rebuildCursor:       totals?.rebuildCursor ?? null,
          rebuildEnd:          totals?.rebuildEnd ?? null,
          salesTotal:          totals?.salesTotal ?? 0,
          itemCount:           totals?.itemCount ?? 0,
          expenseTotal:        totals?.expenseTotal ?? 0,
          expenseCount:        totals?.expenseCount ?? 0,
        }
      }
    }
    return {
      rows:                scanned.length,
      totalsReady:         scanned.filter((r) => r.totalsReady).length,
      categoryCountsReady: scanned.filter((r) => r.categoryCountsReady).length,
      rebuilding:          sums.slice(0, STATUS_SCAN_LIMIT).filter((r) => r.rebuildCursor !== undefined).length,
      truncated,
      user,
    }
  },
})
