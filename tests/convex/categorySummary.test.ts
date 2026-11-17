import { afterEach, describe, expect, it, vi } from 'vitest'
import { runToCompletion } from '@convex-dev/migrations'
import { api, components, internal } from '../../convex/_generated/api'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { CATEGORY_SUMMARY_SCAN_LIMIT } from '../../convex/sales'
import { IDENTITIES, makeT, signIn, signInAndUpsert } from './setup'
import { KHI, fakeAllTimers, seedCategory, seedSession } from './totalsFixtures'

const NOW = '2026-11-17T12:00:00Z'
const at = (key: string) => zonedStartOfDayMs(key, KHI)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('sales.listByCategoryIdPaginated', () => {
  it('pages newest saleDate first and never leaks a foreign category', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await seedCategory(t, userId, 'Food')
    for (const [day, amount] of [['2026-11-01', 1], ['2026-11-15', 2], ['2026-10-05', 3], ['2026-11-10', 4]] as const) {
      await seedSession(t, userId, at(day), [{ amount, categoryId: food }, { amount: 100 }])
    }
    const first = await as.query(api.sales.listByCategoryIdPaginated, {
      categoryId: food, paginationOpts: { numItems: 3, cursor: null },
    })
    expect(first.page.map((s) => s.amount)).toEqual([2, 4, 1])
    expect(first.isDone).toBe(false)
    const second = await as.query(api.sales.listByCategoryIdPaginated, {
      categoryId: food, paginationOpts: { numItems: 3, cursor: first.continueCursor },
    })
    expect(second.page.map((s) => s.amount)).toEqual([3])
    expect(second.isDone).toBe(true)

    // B's poisoned row points at A's category; B asking for A's category gets nothing.
    const { as: asB, userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    await seedSession(t, bId, at('2026-11-02'), [{ amount: 9, categoryId: food }])
    expect(await asB.query(api.sales.listByCategoryIdPaginated, {
      categoryId: food, paginationOpts: { numItems: 10, cursor: null },
    })).toEqual({ page: [], isDone: true, continueCursor: '' })
    expect(await asB.query(api.sales.getCategorySummary, { categoryId: food })).toEqual({ count: 0, totalAmount: 0 })
    expect(await signIn(t, IDENTITIES.NOT_ADMIN_ROLE).query(api.sales.getCategorySummary, { categoryId: food }))
      .toEqual({ count: 0, totalAmount: 0 })
  })
})

describe('sales.getCategorySummary', () => {
  it('scans before categoryStats is ready, then reads categoryStats', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await seedCategory(t, userId, 'Food')
    await seedSession(t, userId, at('2026-11-01'), [{ amount: 10, categoryId: food }, { amount: NaN, categoryId: food }])
    expect(await as.query(api.sales.getCategorySummary, { categoryId: food })).toEqual({ count: 2, totalAmount: 10 })

    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats))
    await as.mutation(api.saleSessions.record, {
      sessionDate: at('2026-11-17'), items: [{ productName: 'x', amount: 5, categoryId: food }],
    })
    expect(await as.query(api.sales.getCategorySummary, { categoryId: food })).toEqual({ count: 3, totalAmount: 15 })

    // Prove the summary row is used, and that the kill switch falls back to the scan.
    await t.run(async (ctx) => {
      const row = await ctx.db.query('categoryStats')
        .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).eq('categoryId', food)).first()
      await ctx.db.patch('categoryStats', row!._id, { saleCount: 42 })
    })
    expect((await as.query(api.sales.getCategorySummary, { categoryId: food })).count).toBe(42)
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([{ categoryId: food, count: 42 }])
    vi.stubEnv('TOTALS_READS', 'off')
    expect((await as.query(api.sales.getCategorySummary, { categoryId: food })).count).toBe(3)
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([{ categoryId: food, count: 3 }])
  })

  it(`scan fallback is exact up to ${CATEGORY_SUMMARY_SCAN_LIMIT} sales and flags capped above (L4)`, async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const big = await seedCategory(t, userId, 'Big')
    const insert = (n: number, amount: number) => t.run(async (ctx) => {
      const sessionId = await ctx.db.insert('saleSessions', {
        userId, totalAmount: n * amount, itemCount: n, sessionDate: at('2026-11-10'), createdAt: 0,
      })
      for (let i = 0; i < n; i++) {
        await ctx.db.insert('sales', {
          userId, sessionId, categoryId: big, productName: 'p', amount, saleDate: at('2026-11-10'), createdAt: i,
        })
      }
    })
    await insert(CATEGORY_SUMMARY_SCAN_LIMIT, 2)
    expect(await as.query(api.sales.getCategorySummary, { categoryId: big }))
      .toEqual({ count: CATEGORY_SUMMARY_SCAN_LIMIT, totalAmount: 2 * CATEGORY_SUMMARY_SCAN_LIMIT })
    await insert(1, 2)
    expect(await as.query(api.sales.getCategorySummary, { categoryId: big }))
      .toEqual({ count: CATEGORY_SUMMARY_SCAN_LIMIT, totalAmount: 2 * CATEGORY_SUMMARY_SCAN_LIMIT, capped: true })
    // Once categoryStats is ready the exact count is served (no flag).
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats))
    expect(await as.query(api.sales.getCategorySummary, { categoryId: big }))
      .toEqual({ count: CATEGORY_SUMMARY_SCAN_LIMIT + 1, totalAmount: 2 * CATEGORY_SUMMARY_SCAN_LIMIT + 2 })
  }, 30_000)

  it('a category with no sales has zeros', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const empty = await seedCategory(t, userId, 'Empty')
    expect(await as.query(api.sales.getCategorySummary, { categoryId: empty })).toEqual({ count: 0, totalAmount: 0 })
  })
})
