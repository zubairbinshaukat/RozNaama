import { afterEach, describe, expect, it, vi } from 'vitest'
import { runToCompletion } from '@convex-dev/migrations'
import { api, components, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { cleanOrphanCategoryIdsForUser } from '../../convex/model/categories'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { IDENTITIES, makeT, signInAndUpsert, type TestT } from './setup'
import {
  KHI,
  fakeAllTimers,
  readCategoryStats,
  readUserTotals,
  recomputeCategoryStats,
  seedCategory,
  seedSession,
} from './totalsFixtures'

const NOW = '2026-11-17T12:00:00Z'

afterEach(() => {
  vi.useRealTimers()
})

async function seedManySales(t: TestT, userId: Id<'users'>, categoryId: Id<'categories'> | undefined, n: number) {
  await t.run(async (ctx) => {
    const day = zonedStartOfDayMs('2026-11-10', KHI)
    const sessionId = await ctx.db.insert('saleSessions', {
      userId, totalAmount: n, itemCount: n, sessionDate: day, createdAt: 0,
    })
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('sales', {
        userId, sessionId, categoryId, productName: `p${i}`, amount: 1, saleDate: day, createdAt: i,
      })
    }
  })
}

function countLinked(t: TestT, userId: Id<'users'>, categoryId: Id<'categories'>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('sales')
      .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).eq('categoryId', categoryId))
      .collect()).length,
  )
}

describe('categories.remove unlinks sales (WP3)', () => {
  it('< 200 sales: unlinks inline, deletes categoryStats, schedules nothing', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const cat = await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    await as.mutation(api.saleSessions.record, {
      sessionDate: zonedStartOfDayMs('2026-11-10', KHI),
      items: [{ productName: 'a', amount: 5, categoryId: cat }, { productName: 'b', amount: 7, categoryId: cat }],
    })
    await seedManySales(t, userId, cat, 150)
    expect((await readCategoryStats(t, userId))[cat]).toEqual({ saleCount: 2, totalAmount: 12 })

    await as.mutation(api.categories.remove, { categoryId: cat })
    expect(await countLinked(t, userId, cat)).toBe(0)
    expect(await readCategoryStats(t, userId)).toEqual({})
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled).toHaveLength(0)
    const all = await t.run((ctx) => ctx.db.query('sales').collect())
    expect(all).toHaveLength(152)
    expect(all.every((s) => s.categoryId === undefined)).toBe(true)
  })

  it('450 sales: 200 inline, the rest via scheduled unlinkBatch', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const cat = await seedCategory(t, userId, 'Bulk')
    const keep = await seedCategory(t, userId, 'Keep')
    await seedManySales(t, userId, cat, 450)
    await seedManySales(t, userId, keep, 3)
    await t.run((ctx) => ctx.db.insert('categoryStats', { userId, categoryId: cat, saleCount: 450, totalAmount: 450 }))

    await as.mutation(api.categories.remove, { categoryId: cat })
    expect(await countLinked(t, userId, cat)).toBe(250)
    expect(await readCategoryStats(t, userId)).toEqual({})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await countLinked(t, userId, cat)).toBe(0)
    expect(await countLinked(t, userId, keep)).toBe(3)
    expect(await t.run((ctx) => ctx.db.get('categories', cat))).toBeNull()
  })

  it('a foreign category cannot be removed and is left untouched', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const bCat = await seedCategory(t, bId, 'B')
    await seedManySales(t, bId, bCat, 2)
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await expect(as.mutation(api.categories.remove, { categoryId: bCat })).rejects.toThrow(/Category not found/)
    expect(await countLinked(t, bId, bCat)).toBe(2)
  })
})

describe('migrations', () => {
  it('cleanOrphanCategoryIds unlinks missing / foreign ids and is idempotent', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId: aId } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const own = await seedCategory(t, aId, 'Own')
    const gone = await seedCategory(t, aId, 'Gone')
    const foreign = await seedCategory(t, bId, 'Foreign')
    await t.run((ctx) => ctx.db.delete('categories', gone))
    await seedManySales(t, aId, undefined, 5) // undefined must sort first and be skipped
    await seedManySales(t, aId, own, 2)
    await seedManySales(t, aId, gone, 3)
    await seedManySales(t, aId, foreign, 250)
    await seedManySales(t, bId, foreign, 4)

    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.cleanOrphanCategoryIds))
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await countLinked(t, aId, own)).toBe(2)
    expect(await countLinked(t, aId, gone)).toBe(0)
    expect(await countLinked(t, aId, foreign)).toBe(0)
    expect(await countLinked(t, bId, foreign)).toBe(4) // B's own link stays

    const snapshot = await t.run((ctx) => ctx.db.query('sales').collect())
    expect(await t.run((ctx) => cleanOrphanCategoryIdsForUser(ctx, aId))).toBe(0)
    expect(await t.run((ctx) => cleanOrphanCategoryIdsForUser(ctx, bId))).toBe(0)
    expect(await t.run((ctx) => ctx.db.query('sales').collect())).toEqual(snapshot)
  })

  it('backfillUserTotals starts rebuilds per user; backfillCategoryStats sets categoryCountsReady', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const food = await seedCategory(t, userId, 'Food')
    await seedSession(t, userId, zonedStartOfDayMs('2026-10-01', KHI), [{ amount: 10, categoryId: food }, { amount: NaN, categoryId: food }])
    await seedSession(t, bId, zonedStartOfDayMs('2026-09-01', KHI), [{ amount: 3 }])
    await t.run((ctx) => ctx.db.insert('categoryStats', { userId, categoryId: food, saleCount: 99, totalAmount: 1 }))

    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillUserTotals))
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await readUserTotals(t, userId))!.totalsReady).toBe(true)
    expect((await readUserTotals(t, bId))!.totalsReady).toBe(true)
    expect((await readUserTotals(t, userId))!.categoryCountsReady).toBe(false)

    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats))
    expect((await readUserTotals(t, userId))!.categoryCountsReady).toBe(true)
    expect(await readCategoryStats(t, userId)).toEqual(await recomputeCategoryStats(t, userId))
    expect((await readCategoryStats(t, userId))[food]).toEqual({ saleCount: 2, totalAmount: 10 })
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([{ categoryId: food, count: 2 }])

    // Re-running the totals backfill skips users that are already ready.
    const gen = (await readUserTotals(t, userId))!.rebuildGeneration
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillUserTotals, { cursor: null }))
    expect((await readUserTotals(t, userId))!.rebuildGeneration).toBe(gen)
  })

  it('backfillCategoryStats leaves categoryCountsReady=false above 8000 categorised sales', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const cat = await seedCategory(t, userId, 'Big')
    await seedManySales(t, userId, cat, 8001)
    await t.run((ctx) => runToCompletion(ctx, components.migrations, internal.migrations.backfillCategoryStats))
    expect((await readUserTotals(t, userId))?.categoryCountsReady ?? false).toBe(false)
  }, 60_000)
})
