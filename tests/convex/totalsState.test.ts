/**
 * Review follow-ups for the summary tables:
 * - P1: gate state (totalsState) split from the write-hot sums (userTotals).
 * - Legacy first-dev-deploy userTotals rows (gate fields inside userTotals).
 * - Zone change during a rebuild with interleaved live writes.
 * - G1 rebuildAllUserTotals, G2 categoryCountsReady reset above the limit.
 * - Migrations end to end through the generic runner (incl. dryRun).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runToCompletion } from '@convex-dev/migrations'
import { api, components, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { QueryCtx } from '../../convex/_generated/server'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { categoryStatsReady, totalsGate } from '../../convex/model/totals'
import { getAllTimeTotals } from '../../convex/model/stats'
import { IDENTITIES, makeT, signInAndUpsert, type TestT } from './setup'
import {
  DAY,
  KHI,
  diffDays,
  fakeAllTimers,
  readCategoryStats,
  readDays,
  readSumsRow,
  readTotalsState,
  readUserTotals,
  rebuildNow,
  recomputeCategoryStats,
  recomputeDays,
  seedCategory,
  seedExpense,
  seedSession,
  sumDays,
} from './totalsFixtures'

const NOW = '2026-11-17T12:00:00Z'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const at = (key: string, hours = 0, tz = KHI) => zonedStartOfDayMs(key, tz) + hours * 3600_000

async function expectConsistent(t: TestT, userId: Id<'users'>, tz: string) {
  const expected = await recomputeDays(t, userId, tz)
  expect(diffDays(await readDays(t, userId), expected)).toEqual([])
  const totals = await readUserTotals(t, userId)
  const sums = sumDays(expected)
  expect(totals!.salesTotal).toBeCloseTo(sums.salesTotal, 6)
  expect(totals!.expenseTotal).toBeCloseTo(sums.expenseTotal, 6)
  expect(totals!.itemCount).toBe(sums.itemCount)
  expect(totals!.expenseCount).toBe(sums.expenseCount)
}

/** Wrap a ctx so every table touched through db.query / db.get is recorded. */
function recordingCtx(ctx: QueryCtx, tables: string[]): QueryCtx {
  const db = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (table: string) => {
          tables.push(table)
          return (target.query as unknown as (t: string) => unknown)(table)
        }
      }
      if (prop === 'get') {
        return (table: string, id: string) => {
          tables.push(table)
          return (target.get as unknown as (t: string, i: string) => unknown)(table, id)
        }
      }
      const value: unknown = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
  return { ...ctx, db }
}

describe('P1: gate state is split from the write-hot sums', () => {
  it('the gates read only totalsState; all-time stats read userTotals', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, at('2026-11-17'), [{ amount: 5 }])
    await rebuildNow(t, userId)
    await t.run(async (ctx) => {
      const reads: string[] = []
      const rec = recordingCtx(ctx, reads)
      expect(await totalsGate(rec, userId, KHI)).not.toBeNull()
      expect(await categoryStatsReady(rec, userId)).toBe(false)
      expect(new Set(reads)).toEqual(new Set(['totalsState']))
      reads.length = 0
      expect((await getAllTimeTotals(rec, userId)).salesTotal).toBe(5)
      expect(reads).toContain('userTotals')
    })
  })

  it('writes patch userTotals but leave the totalsState doc untouched', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.expenses.record, { amount: 1, expenseDate: at('2026-11-16') })
    await rebuildNow(t, userId)
    const stateBefore = await readTotalsState(t, userId)
    const sumsBefore = await readSumsRow(t, userId)
    await as.mutation(api.saleSessions.record, { sessionDate: at('2026-11-17'), items: [{ productName: 'a', amount: 9 }] })
    const { expenseId } = await as.mutation(api.expenses.record, { amount: 2, expenseDate: at('2026-11-17') })
    await as.mutation(api.expenses.updateItem, { expenseId, amount: 3 })
    expect(await readTotalsState(t, userId)).toEqual(stateBefore)
    expect(await readSumsRow(t, userId)).not.toEqual(sumsBefore)
    expect((await readSumsRow(t, userId))!.salesTotal).toBe(9)
  })

  it('range queries keep the summary path with no userTotals row; getStats falls back to the scan for all-time', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await seedCategory(t, userId, 'Food')
    await seedSession(t, userId, at('2026-11-17'), [{ amount: 50, categoryId: food }])
    await rebuildNow(t, userId)
    await t.run((ctx) => runToCompletionCategoryStats(ctx))
    // Prove the summary path is used: corrupt summaries, add a phantom day, drop the sums row.
    await t.run(async (ctx) => {
      const row = await ctx.db.query('dailyTotals').withIndex('by_userId_dayKey', (q) => q.eq('userId', userId)).first()
      await ctx.db.patch('dailyTotals', row!._id, { salesTotal: 999 })
      await ctx.db.insert('dailyTotals', {
        userId, dayKey: '2024-05-05', salesTotal: 1, itemCount: 1, sessionCount: 1, expenseTotal: 0, expenseCount: 0,
      })
      const stats = await ctx.db.query('categoryStats').withIndex('by_userId_categoryId', (q) => q.eq('userId', userId)).first()
      await ctx.db.patch('categoryStats', stats!._id, { saleCount: 77, totalAmount: 7 })
      const sums = await ctx.db.query('userTotals').withIndex('by_userId', (q) => q.eq('userId', userId)).first()
      await ctx.db.delete('userTotals', sums!._id)
    })

    const dayStart = at('2026-11-17')
    expect(await as.query(api.saleSessions.getDailyTotals, { startDate: dayStart, endDate: dayStart + DAY - 1, timeZone: KHI }))
      .toEqual([{ date: '2026-11-17', total: 999 }])
    expect((await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: KHI }))[10]!.salesTotal).toBe(999)
    expect(await as.query(api.saleSessions.getAvailableYears, { timeZone: KHI })).toEqual([2026, 2024])
    const feed = await as.query(api.saleSessions.getDayFeed, { paginationOpts: { numItems: 5, cursor: null }, timeZone: KHI })
    expect(feed.page.map((e) => e.date)).toEqual(['2026-11-17', '2024-05-05'])
    expect(await as.query(api.sales.getCategorySummary, { categoryId: food })).toEqual({ count: 77, totalAmount: 7 })
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([{ categoryId: food, count: 77 }])

    const stats = await as.query(api.saleSessions.getStats, {
      todayStart: dayStart, todayEnd: dayStart + DAY - 1, weekStart: dayStart, weekEnd: dayStart + DAY - 1,
      monthStart: dayStart, monthEnd: dayStart + DAY - 1, timeZone: KHI,
    })
    expect(stats.todaySalesTotal).toBe(999) // period sums: dailyTotals
    expect(stats.allTimeSalesTotal).toBe(50) // no sums row → scan
  })
})

async function runToCompletionCategoryStats(ctx: Parameters<Parameters<TestT['run']>[0]>[0]) {
  await runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats)
}

describe('legacy userTotals rows from the first dev deploy', () => {
  it('validate, are ignored by the gate, seed the bucket zone, and are cleaned by the rebuild', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, Date.parse('2026-11-16T20:00:00Z'), [{ amount: 10 }]) // UTC 16th, PKT 17th
    // Old shape: gate fields inside userTotals, day rows bucketed in UTC.
    await t.run(async (ctx) => {
      await ctx.db.insert('userTotals', {
        userId, timeZone: 'UTC', totalsReady: true, categoryCountsReady: true,
        salesTotal: 10, itemCount: 1, expenseTotal: 0, expenseCount: 0, rebuildGeneration: 3,
      })
      await ctx.db.insert('dailyTotals', {
        userId, dayKey: '2026-11-16', salesTotal: 10, itemCount: 1, sessionCount: 1, expenseTotal: 0, expenseCount: 0,
      })
    })
    expect(await readTotalsState(t, userId)).toBeNull()
    // Not ready → scan path even in UTC (the old row said ready).
    await t.run(async (ctx) => {
      const row = await ctx.db.query('dailyTotals').withIndex('by_userId_dayKey', (q) => q.eq('userId', userId)).first()
      await ctx.db.patch('dailyTotals', row!._id, { salesTotal: 555 })
    })
    const utcDay = Date.parse('2026-11-16T00:00:00Z')
    expect(await as.query(api.saleSessions.getDailyTotals, { startDate: utcDay, endDate: utcDay + DAY - 1, timeZone: 'UTC' }))
      .toEqual([{ date: '2026-11-16', total: 10 }])

    // A hook write creates totalsState seeded with the legacy zone, not ready.
    await as.mutation(api.expenses.record, { amount: 2, expenseDate: Date.parse('2026-11-16T10:00:00Z') })
    expect(await readTotalsState(t, userId)).toMatchObject({ timeZone: 'UTC', totalsReady: false, categoryCountsReady: false })
    expect((await readDays(t, userId))['2026-11-16']).toMatchObject({ expenseTotal: 2, expenseCount: 1 })

    // The backfill rebuilds into the user's preferred zone and clears the old fields.
    await t.run(async (ctx) => {
      await runToCompletion(ctx, components.migrations, internal.migrations.backfillUserTotals)
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await readTotalsState(t, userId)).toMatchObject({ timeZone: KHI, totalsReady: true })
    const sums = await readSumsRow(t, userId)
    expect(sums).toMatchObject({ rebuildGeneration: 4 })
    expect(sums!.timeZone).toBeUndefined()
    expect(sums!.totalsReady).toBeUndefined()
    expect(sums!.categoryCountsReady).toBeUndefined()
    await expectConsistent(t, userId, KHI)
  })
})

describe('zone change during a rebuild with interleaved live writes', () => {
  it('ends consistent in the new zone (ported review probe)', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    for (const k of ['2026-08-01', '2026-08-31', '2026-09-15', '2026-10-01', '2026-10-31', '2026-11-01']) {
      await as.mutation(api.saleSessions.record, { items: [{ productName: 'x', amount: 10 }], sessionDate: at(k) })
      await as.mutation(api.expenses.record, { amount: 3, expenseDate: at(k, 1) })
    }
    await seedSession(t, userId, at('2026-07-01'), [{ amount: 7 }])
    await seedExpense(t, userId, at('2026-07-02'), 2)
    await rebuildNow(t, userId)
    await expectConsistent(t, userId, KHI)

    const NY = 'America/New_York'
    await t.run((ctx) => ctx.db.patch('users', userId, { timeZone: NY }))
    const start = await t.mutation(internal.totals.rebuildUserTotals, { userId })
    expect(start!.timeZone).toBe(NY)
    let cursor: string | null = start!.cursor
    let step = 0
    while (cursor !== null) {
      const result = await t.mutation(internal.totals.rebuildMonth, { userId, generation: start!.generation, cursor })
      if (step === 0) {
        // Live writes touching rows still bucketed in the OLD zone.
        const sales = await t.run((ctx) =>
          ctx.db.query('sales').withIndex('by_userId_saleDate', (q) => q.eq('userId', userId)).collect())
        await as.mutation(api.sales.removeItem, { saleId: sales[sales.length - 1]!._id })
        await as.mutation(api.sales.updateItem, {
          saleId: sales[2]!._id, productName: 'x', amount: 99, saleDate: at('2026-11-10'),
        })
        await as.mutation(api.saleSessions.record, {
          items: [{ productName: 'y', amount: 5 }], sessionDate: Date.parse('2026-11-17T04:00:00Z'),
        })
        const expenses = await t.run((ctx) =>
          ctx.db.query('expenses').withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId)).collect())
        await as.mutation(api.expenses.removeItem, { expenseId: expenses[3]!._id })
      }
      step++
      expect(['next', 'split', 'done']).toContain(result)
      if (result === 'done') break
      cursor = (await readUserTotals(t, userId))!.rebuildCursor ?? null
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers) // leftover duplicates are stale no-ops
    const totals = await readUserTotals(t, userId)
    expect(totals).toMatchObject({ totalsReady: true, timeZone: NY })
    await expectConsistent(t, userId, NY)
    // Reads in the new zone use the summary path and agree with the scan.
    const args = { startDate: at('2026-07-01', 0, NY), endDate: at('2026-12-01', 0, NY) - 1, timeZone: NY }
    const fast = await as.query(api.saleSessions.getDailyTotals, args)
    vi.stubEnv('TOTALS_READS', 'off')
    expect(await as.query(api.saleSessions.getDailyTotals, args)).toEqual(fast)
  })
})

describe('G1: rebuildAllUserTotals forces a rebuild of ready users', () => {
  it('backfillUserTotals skips a ready user; rebuildAllUserTotals repairs it', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    await seedSession(t, userId, at('2026-11-10'), [{ amount: 10 }])
    await seedSession(t, bId, at('2026-10-10'), [{ amount: 4 }])
    await rebuildNow(t, userId)
    await rebuildNow(t, bId)
    await t.run(async (ctx) => {
      const row = await ctx.db.query('dailyTotals').withIndex('by_userId_dayKey', (q) => q.eq('userId', userId)).first()
      await ctx.db.patch('dailyTotals', row!._id, { salesTotal: 1234 })
    })

    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillUserTotals))
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await readDays(t, userId))['2026-11-10']!.salesTotal).toBe(1234) // skipped

    const genA = (await readUserTotals(t, userId))!.rebuildGeneration
    const genB = (await readUserTotals(t, bId))!.rebuildGeneration
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.rebuildAllUserTotals))
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await readUserTotals(t, userId))!.rebuildGeneration).toBe(genA + 1)
    expect((await readUserTotals(t, bId))!.rebuildGeneration).toBe(genB + 1)
    expect((await readUserTotals(t, userId))!.totalsReady).toBe(true)
    await expectConsistent(t, userId, KHI)
    await expectConsistent(t, bId, KHI)
  })
})

describe('G2: categoryCountsReady is reset above the backfill limit', () => {
  it('a previously-ready user over 8000 categorised sales goes back to the scan', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const cat = await seedCategory(t, userId, 'Big')
    await seedSession(t, userId, at('2026-11-10'), [{ amount: 2, categoryId: cat }])
    await t.run((ctx) => runToCompletionCategoryStats(ctx))
    expect((await readTotalsState(t, userId))!.categoryCountsReady).toBe(true)

    await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert('saleSessions', {
        userId, totalAmount: 8000, itemCount: 8000, sessionDate: at('2026-11-11'), createdAt: 0,
      })
      for (let i = 0; i < 8000; i++) {
        await ctx.db.insert('sales', {
          userId, sessionId, categoryId: cat, productName: 'p', amount: 1, saleDate: at('2026-11-11'), createdAt: i,
        })
      }
    })
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats, { cursor: null }))
    expect((await readTotalsState(t, userId))!.categoryCountsReady).toBe(false)
    // Reads fall back to the scan (exact counts; the summary is flagged capped above 5000).
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([{ categoryId: cat, count: 8001 }])
    expect(await as.query(api.sales.getCategorySummary, { categoryId: cat }))
      .toEqual({ count: 5000, totalAmount: 5001, capped: true }) // the amount-2 sale + 4999 × 1
  }, 60_000)
})

describe('migrations end to end through migrations:run', () => {
  it('dryRun changes nothing; the real runs clean orphans, backfill totals and category stats', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const own = await seedCategory(t, userId, 'Own')
    const foreign = await seedCategory(t, bId, 'Foreign')
    const gone = await seedCategory(t, userId, 'Gone')
    await t.run((ctx) => ctx.db.delete('categories', gone))
    await seedSession(t, userId, at('2026-11-10'), [{ amount: 10, categoryId: own }, { amount: 4, categoryId: foreign }])
    await seedSession(t, userId, at('2026-09-01', 5), [{ amount: 6, categoryId: gone }])
    await seedSession(t, bId, at('2026-10-10'), [{ amount: 3, categoryId: foreign }])
    await seedExpense(t, userId, at('2026-11-12'), 2)

    const snapshot = () => t.run(async (ctx) => ({
      sales:       await ctx.db.query('sales').collect(),
      dailyTotals: await ctx.db.query('dailyTotals').collect(),
      userTotals:  await ctx.db.query('userTotals').collect(),
      totalsState: await ctx.db.query('totalsState').collect(),
      stats:       await ctx.db.query('categoryStats').collect(),
    }))
    const before = await snapshot()

    const run = async (fn: string, dryRun?: boolean) => {
      await t.mutation(internal.migrations.run, { fn, ...(dryRun ? { dryRun } : {}) })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    }
    for (const fn of ['migrations:cleanOrphanCategoryIds', 'migrations:backfillUserTotals', 'migrations:backfillCategoryStats']) {
      await run(fn, true)
    }
    expect(await snapshot()).toEqual(before)

    await run('migrations:cleanOrphanCategoryIds')
    const aSales = await t.run((ctx) =>
      ctx.db.query('sales').withIndex('by_userId_saleDate', (q) => q.eq('userId', userId)).collect())
    expect(aSales.filter((s) => s.categoryId !== undefined).map((s) => s.categoryId)).toEqual([own])
    const bSales = await t.run((ctx) =>
      ctx.db.query('sales').withIndex('by_userId_saleDate', (q) => q.eq('userId', bId)).collect())
    expect(bSales.map((s) => s.categoryId)).toEqual([foreign])

    await run('migrations:backfillUserTotals')
    await run('migrations:backfillCategoryStats')
    for (const id of [userId, bId]) {
      expect(await readTotalsState(t, id)).toMatchObject({ timeZone: KHI, totalsReady: true, categoryCountsReady: true })
      await expectConsistent(t, id, KHI)
      expect(await readCategoryStats(t, id)).toEqual(await recomputeCategoryStats(t, id))
    }
    const status = await t.query(internal.totals.status, {})
    expect(status).toMatchObject({ rows: 2, totalsReady: 2, categoryCountsReady: 2, rebuilding: 0, truncated: false })

    // Summary-path reads equal scan-path reads after the rollout.
    const dayStart = at('2026-11-10')
    const reads = async () => ({
      stats: await as.query(api.saleSessions.getStats, {
        todayStart: dayStart, todayEnd: dayStart + DAY - 1, weekStart: dayStart, weekEnd: dayStart + 7 * DAY - 1,
        monthStart: at('2026-11-01'), monthEnd: at('2026-12-01') - 1, timeZone: KHI,
      }),
      years:  await as.query(api.saleSessions.getAvailableYears, { timeZone: KHI }),
      counts: await as.query(api.sales.getCountsByCategory, {}),
      own:    await as.query(api.sales.getCategorySummary, { categoryId: own }),
    })
    const fast = await reads()
    vi.stubEnv('TOTALS_READS', 'off')
    expect(await reads()).toEqual(fast)
    expect(fast.own).toEqual({ count: 1, totalAmount: 10 })
  })
})
