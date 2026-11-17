import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { IDENTITIES, makeT, signInAndUpsert, type TestT } from './setup'
import {
  DAY,
  KHI,
  diffDays,
  fakeAllTimers,
  patchTotalsState,
  readCategoryStats,
  readDays,
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

async function setUserTimeZone(t: TestT, userId: Id<'users'>, timeZone: string) {
  await t.run((ctx) => ctx.db.patch('users', userId, { timeZone }))
}

async function expectTotalsMatchSource(t: TestT, userId: Id<'users'>, tz = KHI) {
  const expected = await recomputeDays(t, userId, tz)
  expect(diffDays(await readDays(t, userId), expected)).toEqual([])
  const totals = await readUserTotals(t, userId)
  const sums = sumDays(expected)
  expect(totals).not.toBeNull()
  expect(totals!.salesTotal).toBeCloseTo(sums.salesTotal, 6)
  expect(totals!.expenseTotal).toBeCloseTo(sums.expenseTotal, 6)
  expect(totals!.itemCount).toBe(sums.itemCount)
  expect(totals!.expenseCount).toBe(sums.expenseCount)
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

describe('write hooks keep dailyTotals / userTotals / categoryStats in sync', () => {
  it('300 seeded random ops: summaries equal a from-source recompute after every 25 ops', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const rand = rng(20261117)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T
    const today = zonedStartOfDayMs('2026-11-17', KHI)
    const randomDate = () => {
      const day = today - Math.floor(rand() * 40) * DAY
      // Mostly PKT midnight (as the app sends), sometimes mid-day instants.
      return rand() < 0.7 ? day : day + Math.floor(rand() * DAY)
    }
    const amount = () => Math.round(rand() * 100000) / 100 + 0.01
    const categories: Id<'categories'>[] = [
      await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' }),
      await as.mutation(api.categories.create, { name: 'Toys', color: '#EC4899' }),
    ]
    const maybeCategory = () => (rand() < 0.3 ? undefined : pick(categories))

    const listSales = () =>
      t.run((ctx) => ctx.db.query('sales').withIndex('by_userId_saleDate', (q) => q.eq('userId', userId)).collect())
    const listExpenses = () =>
      t.run((ctx) => ctx.db.query('expenses').withIndex('by_userId_expenseDate', (q) => q.eq('userId', userId)).collect())

    for (let op = 1; op <= 300; op++) {
      const r = rand()
      if (r < 0.3) {
        const n = 1 + Math.floor(rand() * 3)
        await as.mutation(api.saleSessions.record, {
          sessionDate: randomDate(),
          items: Array.from({ length: n }, () => ({ productName: 'x', amount: amount(), categoryId: maybeCategory() })),
        })
      } else if (r < 0.55) {
        const sales = await listSales()
        if (sales.length > 0) {
          const sale = pick(sales)
          const kind = rand()
          await as.mutation(api.sales.updateItem, {
            saleId:      sale._id,
            productName: sale.productName,
            amount:      kind < 0.4 ? amount() : sale.amount,
            categoryId:  kind >= 0.4 && kind < 0.7 ? maybeCategory() : sale.categoryId,
            saleDate:    kind >= 0.7 ? randomDate() : undefined,
          })
        }
      } else if (r < 0.65) {
        const sales = await listSales()
        if (sales.length > 0) await as.mutation(api.sales.removeItem, { saleId: pick(sales)._id })
      } else if (r < 0.8) {
        await as.mutation(api.expenses.record, { amount: amount(), expenseDate: randomDate() })
      } else if (r < 0.88) {
        const expenses = await listExpenses()
        if (expenses.length > 0) {
          await as.mutation(api.expenses.updateItem, { expenseId: pick(expenses)._id, amount: amount() })
        }
      } else if (r < 0.96) {
        const expenses = await listExpenses()
        if (expenses.length > 0) await as.mutation(api.expenses.removeItem, { expenseId: pick(expenses)._id })
      } else if (r < 0.98) {
        if (categories.length > 0) {
          const victim = categories.splice(Math.floor(rand() * categories.length), 1)[0]!
          await as.mutation(api.categories.remove, { categoryId: victim })
        }
      } else {
        categories.push(await as.mutation(api.categories.create, { name: `Cat ${op}`, color: '#22C55E' }))
      }

      if (op % 25 === 0) {
        await expectTotalsMatchSource(t, userId)
        const stats = await readCategoryStats(t, userId)
        const expected = await recomputeCategoryStats(t, userId)
        expect(Object.keys(stats).sort()).toEqual(Object.keys(expected).sort())
        for (const [k, v] of Object.entries(expected)) {
          expect(stats[k]!.saleCount).toBe(v.saleCount)
          expect(stats[k]!.totalAmount).toBeCloseTo(v.totalAmount, 6)
        }
      }
    }
  }, 60_000)

  it('deletes the day row when its last session and expense are gone', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const day = zonedStartOfDayMs('2026-11-10', KHI)
    const { sessionId } = await as.mutation(api.saleSessions.record, {
      sessionDate: day, items: [{ productName: 'a', amount: 10 }],
    })
    const { expenseId } = await as.mutation(api.expenses.record, { amount: 3, expenseDate: day + 1000 })
    expect(await readDays(t, userId)).toEqual({
      '2026-11-10': { salesTotal: 10, itemCount: 1, sessionCount: 1, expenseTotal: 3, expenseCount: 1 },
    })
    const sale = await t.run((ctx) => ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).first())
    await as.mutation(api.sales.removeItem, { saleId: sale!._id })
    await as.mutation(api.expenses.removeItem, { expenseId })
    expect(await readDays(t, userId)).toEqual({})
    const totals = await readUserTotals(t, userId)
    expect([totals!.salesTotal, totals!.itemCount, totals!.expenseTotal, totals!.expenseCount]).toEqual([0, 0, 0, 0])
    expect(totals!.totalsReady).toBe(false)
  })
})

describe('rebuild (WP5)', () => {
  it('backfill == recompute for legacy rows (NaN, negative, drifted, non-midnight, bad dates)', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const d1 = zonedStartOfDayMs('2026-10-01', KHI)
    await seedSession(t, userId, d1, [{ amount: 100 }, { amount: 50 }])
    await seedSession(t, userId, d1 + 5 * 3600_000, [{ amount: 7 }]) // non-midnight
    await seedSession(t, userId, d1 - 40 * DAY, [{ amount: 1 }], { totalAmount: NaN })
    await seedSession(t, userId, d1 - 400 * DAY, [{ amount: 5 }], { totalAmount: -20, itemCount: 4 }) // drifted
    await seedSession(t, userId, NaN, [{ amount: 9 }]) // cannot be bucketed
    await seedExpense(t, userId, d1 + 1000, 30)
    await seedExpense(t, userId, d1 - 40 * DAY + 5, Infinity)
    await seedExpense(t, userId, Date.parse('2024-02-29T10:00:00Z'), 12)

    await rebuildNow(t, userId)
    await expectTotalsMatchSource(t, userId)
    const totals = await readUserTotals(t, userId)
    expect(totals!.totalsReady).toBe(true)
    expect(totals!.rebuildCursor).toBeUndefined()
    expect(totals!.timeZone).toBe(KHI)
    expect((await readDays(t, userId))['2026-10-01']).toEqual({
      salesTotal: 157, itemCount: 3, sessionCount: 2, expenseTotal: 30, expenseCount: 1,
    })

    const check = await t.query(internal.totals.verifyUserTotals, { userId, monthKey: '2026-10' })
    expect(check.ok).toBe(true)
    // Rebuilding again writes nothing new and stays equal.
    await rebuildNow(t, userId)
    await expectTotalsMatchSource(t, userId)
  })

  it('totals-path reads equal scan-path reads after backfill', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await seedCategory(t, userId, 'Food')
    for (const [iso, amt] of [
      ['2026-11-17T08:00:00Z', 40], ['2026-11-16T19:00:00Z', 15], ['2026-11-16T18:59:59Z', 3],
      ['2026-11-01T00:00:00Z', 22], ['2026-06-15T10:00:00Z', 9], ['2025-12-31T20:00:00Z', 200],
      ['2023-03-03T03:00:00Z', 1],
    ] as const) {
      await seedSession(t, userId, Date.parse(iso), [{ amount: amt, categoryId: food }, { amount: -2 }])
    }
    await seedExpense(t, userId, Date.parse('2026-11-17T09:00:00Z'), 11)
    await seedExpense(t, userId, Date.parse('2026-11-10T09:00:00Z'), 4)
    await seedExpense(t, userId, Date.parse('2021-07-07T10:00:00Z'), 5)
    await rebuildNow(t, userId)

    const todayStart = zonedStartOfDayMs('2026-11-17', KHI)
    const statsArgs = {
      todayStart, todayEnd: todayStart + DAY - 1,
      weekStart: zonedStartOfDayMs('2026-11-16', KHI), weekEnd: zonedStartOfDayMs('2026-11-23', KHI) - 1,
      monthStart: zonedStartOfDayMs('2026-11-01', KHI), monthEnd: zonedStartOfDayMs('2026-12-01', KHI) - 1,
      timeZone: KHI,
    }
    const reads = async () => ({
      daily: await as.query(api.saleSessions.getDailyTotals, {
        startDate: statsArgs.monthStart, endDate: statsArgs.monthEnd, timeZone: KHI,
      }),
      stats: await as.query(api.saleSessions.getStats, statsArgs),
      year2026: await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: KHI }),
      year2025: await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2025, timeZone: KHI }),
      years: await as.query(api.saleSessions.getAvailableYears, { timeZone: KHI }),
      counts: await as.query(api.sales.getCountsByCategory, {}),
    })
    const fast = await reads()
    vi.stubEnv('TOTALS_READS', 'off')
    const scan = await reads()
    vi.unstubAllEnvs()
    expect(fast).toEqual(scan)
    expect(fast.stats.todaySalesTotal).toBe(51)
    expect(fast.years).toEqual([2026, 2023, 2021])

    // Prove the fast path is really used: corrupt a summary row.
    await t.run(async (ctx) => {
      const row = await ctx.db.query('dailyTotals')
        .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId).eq('dayKey', '2026-11-17')).first()
      await ctx.db.patch('dailyTotals', row!._id, { salesTotal: 1000 })
    })
    expect((await as.query(api.saleSessions.getStats, statsArgs)).todaySalesTotal).toBe(1000)
    vi.stubEnv('TOTALS_READS', 'off')
    expect((await as.query(api.saleSessions.getStats, statsArgs)).todaySalesTotal).toBe(51)
  })

  it('live writes interleaved with rebuild steps end consistent', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    for (const iso of ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05']) {
      await seedSession(t, userId, zonedStartOfDayMs(iso, KHI), [{ amount: 10 }])
      await seedExpense(t, userId, zonedStartOfDayMs(iso, KHI) + 1000, 1)
    }
    const start = await t.mutation(internal.totals.rebuildUserTotals, { userId })
    expect(start).toMatchObject({ generation: 1, cursor: '2026-07', end: '2026-11' })

    const writes = [
      () => as.mutation(api.saleSessions.record, { sessionDate: zonedStartOfDayMs('2026-07-05', KHI), items: [{ productName: 'a', amount: 5 }] }),
      () => as.mutation(api.saleSessions.record, { sessionDate: zonedStartOfDayMs('2026-10-20', KHI), items: [{ productName: 'b', amount: 6 }] }),
      () => as.mutation(api.expenses.record, { amount: 2, expenseDate: zonedStartOfDayMs('2026-08-06', KHI) }),
      () => as.mutation(api.saleSessions.record, { sessionDate: zonedStartOfDayMs('2026-11-17', KHI), items: [{ productName: 'c', amount: 7 }] }),
    ]
    let result: string = 'next'
    let i = 0
    while (result !== 'done') {
      await writes[i % writes.length]!()
      i++
      const totals = await readUserTotals(t, userId)
      result = await t.mutation(internal.totals.rebuildMonth, {
        userId, generation: 1, cursor: totals!.rebuildCursor!,
      })
      expect(['next', 'done']).toContain(result)
    }
    // Scheduled duplicates of the steps we ran by hand are now stale no-ops.
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await as.mutation(api.expenses.record, { amount: 9, expenseDate: zonedStartOfDayMs('2026-09-01', KHI) })
    await expectTotalsMatchSource(t, userId)
    expect((await readUserTotals(t, userId))!.totalsReady).toBe(true)
  })

  it('a stale generation aborts without writing', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, zonedStartOfDayMs('2026-10-05', KHI), [{ amount: 10 }])
    await t.mutation(internal.totals.rebuildUserTotals, { userId })
    const second = await t.mutation(internal.totals.rebuildUserTotals, { userId })
    expect(second!.generation).toBe(2)
    expect(await t.mutation(internal.totals.rebuildMonth, { userId, generation: 1, cursor: '2026-10' })).toBe('stale')
    expect(await readDays(t, userId)).toEqual({})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await expectTotalsMatchSource(t, userId)
    expect((await readUserTotals(t, userId))!.rebuildGeneration).toBe(2)
  })

  it('splits a huge month into day steps', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const day = zonedStartOfDayMs('2026-10-05', KHI)
    await t.run(async (ctx) => {
      for (let i = 0; i < 2001; i++) {
        await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: day + i, createdAt: 0 })
      }
    })
    await t.mutation(internal.totals.rebuildUserTotals, { userId })
    expect(await t.mutation(internal.totals.rebuildMonth, { userId, generation: 1, cursor: '2026-10' })).toBe('split')
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await readDays(t, userId)).toEqual({
      '2026-10-05': { salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 2001, expenseCount: 2001 },
    })
    expect((await readUserTotals(t, userId))!.totalsReady).toBe(true)
  })

  it('a user with no data finalizes immediately; status reports progress', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await t.mutation(internal.totals.rebuildUserTotals, { userId })).toMatchObject({ cursor: null })
    const status = await t.query(internal.totals.status, { userId })
    expect(status).toMatchObject({ rows: 1, totalsReady: 1, rebuilding: 0, user: { totalsReady: true, salesTotal: 0 } })
  })
})

describe('time-zone edges', () => {
  it('Karachi day boundary: 18:59:59Z vs 19:00Z', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, Date.parse('2026-03-10T18:59:59Z'), [{ amount: 1 }])
    await seedSession(t, userId, Date.parse('2026-03-10T19:00:00Z'), [{ amount: 2 }])
    await rebuildNow(t, userId)
    const days = await readDays(t, userId)
    expect(days['2026-03-10']!.salesTotal).toBe(1)
    expect(days['2026-03-11']!.salesTotal).toBe(2)
  })

  it('UTC user: 23:59:59Z vs 00:00Z; Dec 31 → Jan 1 yearly split', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await setUserTimeZone(t, userId, 'UTC')
    await seedSession(t, userId, Date.parse('2025-12-31T23:59:59Z'), [{ amount: 1 }])
    await seedSession(t, userId, Date.parse('2026-01-01T00:00:00Z'), [{ amount: 2 }])
    await rebuildNow(t, userId)
    expect((await readUserTotals(t, userId))!.timeZone).toBe('UTC')
    const days = await readDays(t, userId)
    expect(Object.keys(days)).toEqual(['2025-12-31', '2026-01-01'])
    const y25 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2025, timeZone: 'UTC' })
    const y26 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: 'UTC' })
    expect(y25[11]!.salesTotal).toBe(1)
    expect(y26[0]!.salesTotal).toBe(2)
    expect(await as.query(api.saleSessions.getAvailableYears, { timeZone: 'UTC' })).toEqual([2026, 2025])
  })

  it('America/New_York across DST and Asia/Kathmandu match their scan paths', async () => {
    for (const tz of ['America/New_York', 'Asia/Kathmandu']) {
      fakeAllTimers(NOW)
      const t = makeT()
      const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
      await setUserTimeZone(t, userId, tz)
      for (const iso of ['2026-03-08T04:59:00Z', '2026-03-08T05:00:00Z', '2026-03-08T07:30:00Z', '2026-03-09T03:59:00Z',
        '2026-03-09T04:00:00Z', '2026-03-09T18:14:00Z', '2026-03-09T18:15:00Z', '2026-11-01T05:30:00Z']) {
        await seedSession(t, userId, Date.parse(iso), [{ amount: 1 }])
        await seedExpense(t, userId, Date.parse(iso) + 1, 0.5)
      }
      await rebuildNow(t, userId)
      await expectTotalsMatchSource(t, userId, tz)
      const args = {
        startDate: zonedStartOfDayMs('2026-03-01', tz), endDate: zonedStartOfDayMs('2026-04-01', tz) - 1, timeZone: tz,
      }
      const fast = await as.query(api.saleSessions.getDailyTotals, args)
      vi.stubEnv('TOTALS_READS', 'off')
      expect(await as.query(api.saleSessions.getDailyTotals, args)).toEqual(fast)
      vi.unstubAllEnvs()
      vi.useRealTimers()
    }
  })
})

describe('read gates fall back to the scan path', () => {
  async function corruptedUser() {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const day = zonedStartOfDayMs('2026-11-17', KHI)
    await seedSession(t, userId, day, [{ amount: 50 }])
    await rebuildNow(t, userId)
    await t.run(async (ctx) => {
      const row = await ctx.db.query('dailyTotals').withIndex('by_userId_dayKey', (q) => q.eq('userId', userId)).first()
      await ctx.db.patch('dailyTotals', row!._id, { salesTotal: 999 })
    })
    const range = { startDate: day, endDate: day + DAY - 1 }
    return { t, as, userId, day, range }
  }

  it('uses totals only when ready, zone matches, range is whole days and the kill switch is not off', async () => {
    const { t, as, userId, day, range } = await corruptedUser()
    const daily = (timeZone: string, r = range) => as.query(api.saleSessions.getDailyTotals, { ...r, timeZone })
    expect(await daily(KHI)).toEqual([{ date: '2026-11-17', total: 999 }])          // totals path
    expect(await daily('UTC')).toEqual([{ date: '2026-11-16', total: 50 }])          // zone mismatch → scan
    expect(await daily(KHI, { startDate: day + 1, endDate: day + DAY - 1 })).toEqual([]) // not aligned → scan (legacy semantics)
    vi.stubEnv('TOTALS_READS', 'off')
    expect(await daily(KHI)).toEqual([{ date: '2026-11-17', total: 50 }])            // kill switch
    vi.unstubAllEnvs()
    await patchTotalsState(t, userId, { totalsReady: false })
    expect(await daily(KHI)).toEqual([{ date: '2026-11-17', total: 50 }])            // not ready
  })

  it('getStats without timeZone scans the periods (old clients)', async () => {
    const { as, day } = await corruptedUser()
    const args = {
      todayStart: day, todayEnd: day + DAY - 1, weekStart: day, weekEnd: day + DAY - 1,
      monthStart: day, monthEnd: day + DAY - 1,
    }
    expect((await as.query(api.saleSessions.getStats, args)).todaySalesTotal).toBe(50)
    expect((await as.query(api.saleSessions.getStats, { ...args, timeZone: KHI })).todaySalesTotal).toBe(999)
  })

  it('users without a userTotals row use the scan path', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const day = zonedStartOfDayMs('2026-11-17', KHI)
    await seedSession(t, userId, day, [{ amount: 50 }])
    expect(await readUserTotals(t, userId)).toBeNull()
    expect(await as.query(api.saleSessions.getDailyTotals, { startDate: day, endDate: day + DAY - 1, timeZone: KHI }))
      .toEqual([{ date: '2026-11-17', total: 50 }])
  })
})
