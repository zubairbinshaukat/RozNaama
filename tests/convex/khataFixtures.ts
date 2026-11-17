/**
 * Shared helpers for the khata tests: error payloads, row counts and the
 * "summary tables == recompute" + "khata balances == recompute" checks.
 */
import { expect } from 'vitest'
import { ConvexError } from 'convex/values'
import { internal } from '../../convex/_generated/api'
import type { Id, TableNames } from '../../convex/_generated/dataModel'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import type { TestT } from './setup'
import {
  DAY,
  KHI,
  diffDays,
  readCategoryStats,
  readDays,
  readUserTotals,
  recomputeCategoryStats,
  recomputeDays,
  sumDays,
} from './totalsFixtures'

export const NOW = '2026-11-17T12:00:00Z'
export const TODAY = zonedStartOfDayMs('2026-11-17', KHI)
export const YESTERDAY = TODAY - DAY
export { DAY, KHI }

export async function errorData(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<{ code: string; message: string }>).data
  }
  throw new Error('expected promise to reject')
}

export function count(t: TestT, table: TableNames): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.query(table).collect()).length)
}

/** dailyTotals / userTotals / categoryStats equal a from-source recompute. */
export async function expectTotalsMatchSource(t: TestT, userId: Id<'users'>): Promise<void> {
  const expected = await recomputeDays(t, userId, KHI)
  expect(diffDays(await readDays(t, userId), expected)).toEqual([])
  const totals = await readUserTotals(t, userId)
  const sums = sumDays(expected)
  if (totals) {
    expect(totals.salesTotal).toBeCloseTo(sums.salesTotal, 6)
    expect(totals.expenseTotal).toBeCloseTo(sums.expenseTotal, 6)
    expect(totals.itemCount).toBe(sums.itemCount)
    expect(totals.expenseCount).toBe(sums.expenseCount)
  } else {
    expect(sums).toEqual({ salesTotal: 0, itemCount: 0, expenseTotal: 0, expenseCount: 0 })
  }
  expect(await readCategoryStats(t, userId)).toEqual(await recomputeCategoryStats(t, userId))
}

/** khata:verifyUser reports no drift. */
export async function expectKhataConsistent(t: TestT, userId: Id<'users'>): Promise<void> {
  const res = await t.query(internal.khata.verifyUser, { userId })
  expect(res.mismatches).toEqual([])
  expect(res.ok).toBe(true)
}

/** Σ sales per local day key (from source rows). */
export async function salesByDay(t: TestT, userId: Id<'users'>): Promise<Record<string, number>> {
  const days = await recomputeDays(t, userId, KHI)
  const out: Record<string, number> = {}
  for (const [k, d] of Object.entries(days)) if (d.salesTotal !== 0) out[k] = d.salesTotal
  return out
}

export async function expensesTotal(t: TestT, userId: Id<'users'>): Promise<number> {
  return sumDays(await recomputeDays(t, userId, KHI)).expenseTotal
}
