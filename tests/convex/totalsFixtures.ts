/**
 * Shared helpers for the Tier 2 totals tests: raw (hook-less) seeding of
 * legacy-style rows and an independent from-source recompute.
 */
import { vi } from 'vitest'
import { internal } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { dateKeyInTimeZone } from '../../convex/lib/time'
import type { TestT } from './setup'

export const KHI = 'Asia/Karachi'
export const DAY = 24 * 60 * 60 * 1000

export type Day = {
  salesTotal:   number
  itemCount:    number
  sessionCount: number
  expenseTotal: number
  expenseCount: number
}

const fin = (x: number) => (Number.isFinite(x) ? x : 0)

function keyOf(ms: number, tz: string): string | null {
  if (!Number.isFinite(ms)) return null
  return dateKeyInTimeZone(ms, tz)
}

/** Insert a session + items directly (no hooks, no validation). */
export async function seedSession(
  t: TestT,
  userId: Id<'users'>,
  sessionDate: number,
  items: { amount: number; categoryId?: Id<'categories'> }[],
  overrides: Partial<Pick<Doc<'saleSessions'>, 'totalAmount' | 'itemCount'>> = {},
): Promise<Id<'saleSessions'>> {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert('saleSessions', {
      userId,
      totalAmount: overrides.totalAmount ?? items.reduce((s, i) => s + i.amount, 0),
      itemCount:   overrides.itemCount ?? items.length,
      sessionDate,
      createdAt:   0,
    })
    for (const item of items) {
      await ctx.db.insert('sales', {
        userId, sessionId, productName: 'p', amount: item.amount,
        categoryId: item.categoryId, saleDate: sessionDate, createdAt: 0,
      })
    }
    return sessionId
  })
}

/** Insert an expense directly (no hooks, no validation). */
export async function seedExpense(
  t: TestT,
  userId: Id<'users'>,
  expenseDate: number,
  amount: number,
): Promise<Id<'expenses'>> {
  return t.run((ctx) => ctx.db.insert('expenses', { userId, amount, expenseDate, createdAt: 0 }))
}

export async function seedCategory(t: TestT, userId: Id<'users'>, name: string): Promise<Id<'categories'>> {
  return t.run((ctx) => ctx.db.insert('categories', { userId, name, color: '#6366F1', createdAt: 0 }))
}

/** From-source recompute of dailyTotals (non-finite → 0, non-finite dates skipped). */
export async function recomputeDays(t: TestT, userId: Id<'users'>, tz: string): Promise<Record<string, Day>> {
  return t.run(async (ctx) => {
    const out: Record<string, Day> = {}
    const get = (k: string) =>
      (out[k] ??= { salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 0, expenseCount: 0 })
    const sessions = await ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) => q.eq('userId', userId))
      .collect()
    for (const s of sessions) {
      const k = keyOf(s.sessionDate, tz)
      if (k === null) continue
      const d = get(k)
      d.salesTotal += fin(s.totalAmount)
      d.itemCount += fin(s.itemCount)
      d.sessionCount += 1
    }
    const expenses = await ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId))
      .collect()
    for (const e of expenses) {
      const k = keyOf(e.expenseDate, tz)
      if (k === null) continue
      const d = get(k)
      d.expenseTotal += fin(e.amount)
      d.expenseCount += 1
    }
    return out
  })
}

export async function readDays(t: TestT, userId: Id<'users'>): Promise<Record<string, Day>> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query('dailyTotals')
      .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId))
      .collect()
    const out: Record<string, Day> = {}
    for (const r of rows) {
      out[r.dayKey] = {
        salesTotal: r.salesTotal, itemCount: r.itemCount, sessionCount: r.sessionCount,
        expenseTotal: r.expenseTotal, expenseCount: r.expenseCount,
      }
    }
    return out
  })
}

export type MergedTotals = {
  timeZone:            string
  totalsReady:         boolean
  categoryCountsReady: boolean
  salesTotal:          number
  itemCount:           number
  expenseTotal:        number
  expenseCount:        number
  rebuildGeneration:   number
  rebuildCursor?:      string
  rebuildEnd?:         string
}

export function readTotalsState(t: TestT, userId: Id<'users'>): Promise<Doc<'totalsState'> | null> {
  return t.run((ctx) =>
    ctx.db.query('totalsState').withIndex('by_userId', (q) => q.eq('userId', userId)).first(),
  )
}

export function readSumsRow(t: TestT, userId: Id<'users'>): Promise<Doc<'userTotals'> | null> {
  return t.run((ctx) =>
    ctx.db.query('userTotals').withIndex('by_userId', (q) => q.eq('userId', userId)).first(),
  )
}

/** totalsState (gate) + userTotals (sums, rebuild progress) merged; null when neither row exists. */
export async function readUserTotals(t: TestT, userId: Id<'users'>): Promise<MergedTotals | null> {
  const [state, sums] = await Promise.all([readTotalsState(t, userId), readSumsRow(t, userId)])
  if (!state && !sums) return null
  return {
    timeZone:            state?.timeZone ?? '',
    totalsReady:         state?.totalsReady ?? false,
    categoryCountsReady: state?.categoryCountsReady ?? false,
    salesTotal:          sums?.salesTotal ?? 0,
    itemCount:           sums?.itemCount ?? 0,
    expenseTotal:        sums?.expenseTotal ?? 0,
    expenseCount:        sums?.expenseCount ?? 0,
    rebuildGeneration:   sums?.rebuildGeneration ?? 0,
    rebuildCursor:       sums?.rebuildCursor,
    rebuildEnd:          sums?.rebuildEnd,
  }
}

/** Patch a user's totalsState row (test-only gate manipulation). */
export async function patchTotalsState(
  t: TestT,
  userId: Id<'users'>,
  patch: Partial<Pick<Doc<'totalsState'>, 'timeZone' | 'totalsReady' | 'categoryCountsReady'>>,
): Promise<void> {
  await t.run(async (ctx) => {
    const row = await ctx.db.query('totalsState').withIndex('by_userId', (q) => q.eq('userId', userId)).first()
    if (!row) throw new Error('no totalsState row')
    await ctx.db.patch('totalsState', row._id, patch)
  })
}

/** Recomputed per-category {saleCount, totalAmount} over the user's own categories. */
export async function recomputeCategoryStats(
  t: TestT,
  userId: Id<'users'>,
): Promise<Record<string, { saleCount: number; totalAmount: number }>> {
  return t.run(async (ctx) => {
    const cats = await ctx.db.query('categories').withIndex('by_userId', (q) => q.eq('userId', userId)).collect()
    const own = new Set(cats.map((c) => c._id as string))
    const sales = await ctx.db.query('sales').withIndex('by_userId_saleDate', (q) => q.eq('userId', userId)).collect()
    const out: Record<string, { saleCount: number; totalAmount: number }> = {}
    for (const s of sales) {
      if (s.categoryId === undefined || !own.has(s.categoryId)) continue
      const row = (out[s.categoryId] ??= { saleCount: 0, totalAmount: 0 })
      row.saleCount += 1
      row.totalAmount += fin(s.amount)
    }
    return out
  })
}

export async function readCategoryStats(
  t: TestT,
  userId: Id<'users'>,
): Promise<Record<string, { saleCount: number; totalAmount: number }>> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query('categoryStats')
      .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId))
      .collect()
    const out: Record<string, { saleCount: number; totalAmount: number }> = {}
    for (const r of rows) out[r.categoryId] = { saleCount: r.saleCount, totalAmount: r.totalAmount }
    return out
  })
}

/** Assert two day maps are equal (amounts within 1e-6). Returns a list of differences. */
export function diffDays(a: Record<string, Day>, b: Record<string, Day>): string[] {
  const out: string[] = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k]
    const y = b[k]
    if (!x || !y) {
      out.push(`${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`)
      continue
    }
    const near = (p: number, q: number) => Math.abs(p - q) <= 1e-6
    if (!near(x.salesTotal, y.salesTotal) || !near(x.expenseTotal, y.expenseTotal) ||
      x.itemCount !== y.itemCount || x.sessionCount !== y.sessionCount || x.expenseCount !== y.expenseCount) {
      out.push(`${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`)
    }
  }
  return out
}

/** Sum of a day map, in userTotals shape. */
export function sumDays(days: Record<string, Day>) {
  let salesTotal = 0
  let itemCount = 0
  let expenseTotal = 0
  let expenseCount = 0
  for (const d of Object.values(days)) {
    salesTotal += d.salesTotal
    itemCount += d.itemCount
    expenseTotal += d.expenseTotal
    expenseCount += d.expenseCount
  }
  return { salesTotal, itemCount, expenseTotal, expenseCount }
}

/**
 * Use fake timers (Date included) so scheduled functions only run when the
 * test drains them. Call vi.useRealTimers() afterwards.
 */
export function fakeAllTimers(iso: string): number {
  vi.useFakeTimers()
  const ms = Date.parse(iso)
  vi.setSystemTime(ms)
  return ms
}

/** Start a rebuild for `userId` and drain all scheduled steps. */
export async function rebuildNow(t: TestT, userId: Id<'users'>): Promise<void> {
  await t.mutation(internal.totals.rebuildUserTotals, { userId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}
