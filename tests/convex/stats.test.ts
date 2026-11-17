import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { IDENTITIES, freezeNow, makeT, signIn, signInAndUpsert, stubAdminEmails, type TestT } from './setup'

const NOW = '2026-11-17T12:00:00Z'
const DAY = 24 * 60 * 60 * 1000
const KHI = 'Asia/Karachi'

async function errorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

/** Insert a session (+ items) directly, bypassing write validation (legacy-style seeding). */
async function seedSession(
  t: TestT,
  userId: Id<'users'>,
  sessionDate: number,
  items: { amount: number; categoryId?: Id<'categories'> }[],
) {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert('saleSessions', {
      userId,
      totalAmount: items.reduce((s, i) => s + i.amount, 0),
      itemCount: items.length,
      sessionDate,
      createdAt: 0,
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

async function seedExpense(t: TestT, userId: Id<'users'>, expenseDate: number, amount: number) {
  return t.run((ctx) => ctx.db.insert('expenses', { userId, amount, expenseDate, createdAt: 0 }))
}

beforeEach(() => {
  freezeNow(NOW)
  stubAdminEmails()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('saleSessions.getDailyTotals', () => {
  it('buckets by the requested time zone (2026-03-10T19:30Z → Karachi 03-11, UTC 03-10)', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const at = Date.parse('2026-03-10T19:30:00Z')
    await seedSession(t, userId, at, [{ amount: 100 }])
    await seedExpense(t, userId, at, 30)
    await seedExpense(t, userId, Date.parse('2026-03-09T10:00:00Z'), 5)

    const range = { startDate: Date.parse('2026-03-01T00:00:00Z'), endDate: Date.parse('2026-03-31T00:00:00Z') }
    expect(await as.query(api.saleSessions.getDailyTotals, { ...range, timeZone: KHI })).toEqual([
      { date: '2026-03-09', total: -5 },
      { date: '2026-03-11', total: 70 },
    ])
    expect(await as.query(api.saleSessions.getDailyTotals, { ...range, timeZone: 'UTC' })).toEqual([
      { date: '2026-03-09', total: -5 },
      { date: '2026-03-10', total: 70 },
    ])
    // Blank / invalid zones fall back to UTC like the legacy code.
    expect(await as.query(api.saleSessions.getDailyTotals, { ...range, timeZone: '  ' }))
      .toEqual(await as.query(api.saleSessions.getDailyTotals, { ...range, timeZone: 'Not/AZone' }))
  })

  it('returns [] without a user row and isolates users', async () => {
    const t = makeT()
    const range = { startDate: 0, endDate: Date.parse(NOW), timeZone: KHI }
    expect(await signIn(t, IDENTITIES.A).query(api.saleSessions.getDailyTotals, range)).toEqual([])
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    await seedSession(t, bId, Date.parse('2026-03-10T00:00:00Z'), [{ amount: 1 }])
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await as.query(api.saleSessions.getDailyTotals, range)).toEqual([])
  })
})

describe('saleSessions.getYearlyMonthlyTotals', () => {
  it('2025-12-31T20:00Z is January 2026 in Karachi but December 2025 in UTC', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const at = Date.parse('2025-12-31T20:00:00Z')
    await seedSession(t, userId, at, [{ amount: 200 }])
    await seedExpense(t, userId, at, 50)
    await seedSession(t, userId, Date.parse('2026-06-15T10:00:00Z'), [{ amount: 10 }, { amount: 5 }])

    const khi2026 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: KHI })
    expect(khi2026).toHaveLength(12)
    expect(khi2026[0]).toEqual({ monthIndex: 0, salesTotal: 200, netTotal: 150 })
    expect(khi2026[5]).toEqual({ monthIndex: 5, salesTotal: 15, netTotal: 15 })
    expect(khi2026.filter((m) => m.salesTotal !== 0 || m.netTotal !== 0)).toHaveLength(2)

    const khi2025 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2025, timeZone: KHI })
    expect(khi2025.every((m) => m.salesTotal === 0 && m.netTotal === 0)).toBe(true)

    const utc2025 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2025, timeZone: 'UTC' })
    expect(utc2025[11]).toEqual({ monthIndex: 11, salesTotal: 200, netTotal: 150 })
    const utc2026 = await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: 'UTC' })
    expect(utc2026[0]).toEqual({ monthIndex: 0, salesTotal: 0, netTotal: 0 })
  })

  it('returns 12 zero months without a user row or for a non-integer year', async () => {
    const t = makeT()
    const zeros = Array.from({ length: 12 }, (_, monthIndex) => ({ monthIndex, salesTotal: 0, netTotal: 0 }))
    expect(await signIn(t, IDENTITIES.A).query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: KHI }))
      .toEqual(zeros)
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await as.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026.5, timeZone: KHI })).toEqual(zeros)
  })
})

describe('saleSessions.getAvailableYears', () => {
  it('includes years from sessions and expenses plus the current year, descending', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    for (const iso of ['2023-02-01T10:00:00Z', '2023-08-01T10:00:00Z', '2023-12-01T10:00:00Z', '2025-05-05T10:00:00Z']) {
      await seedSession(t, userId, Date.parse(iso), [{ amount: 1 }])
    }
    await seedExpense(t, userId, Date.parse('2021-07-07T10:00:00Z'), 5)
    await seedExpense(t, userId, Date.parse('2021-09-07T10:00:00Z'), 5)

    expect(await as.query(api.saleSessions.getAvailableYears, { timeZone: KHI }))
      .toEqual([2026, 2025, 2023, 2021])
  })

  it('buckets the year boundary by time zone', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, Date.parse('2024-12-31T20:00:00Z'), [{ amount: 1 }])
    expect(await as.query(api.saleSessions.getAvailableYears, { timeZone: KHI })).toEqual([2026, 2025])
    expect(await as.query(api.saleSessions.getAvailableYears, { timeZone: 'UTC' })).toEqual([2026, 2024])
  })

  it('returns only the current year without a user row', async () => {
    const t = makeT()
    expect(await signIn(t, IDENTITIES.A).query(api.saleSessions.getAvailableYears, { timeZone: KHI }))
      .toEqual([2026])
  })
})

describe('saleSessions.getStats', () => {
  const todayStart = Date.parse('2026-11-16T19:00:00Z') // 17 Nov 00:00 PKT
  const args = {
    todayStart,
    todayEnd:   todayStart + DAY - 1,
    weekStart:  todayStart - 1 * DAY,
    weekEnd:    todayStart + 6 * DAY - 1,
    monthStart: todayStart - 16 * DAY,
    monthEnd:   todayStart + 14 * DAY - 1,
  }

  it('computes all 15 fields and the top category', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await t.run((ctx) => ctx.db.insert('categories', { userId, name: 'Food', color: '#6366F1', createdAt: 0 }))
    const toys = await t.run((ctx) => ctx.db.insert('categories', { userId, name: 'Toys', color: '#EC4899', createdAt: 0 }))

    await seedSession(t, userId, todayStart, [{ amount: 100, categoryId: food }, { amount: 30, categoryId: toys }, { amount: 5 }])
    await seedSession(t, userId, todayStart - DAY, [{ amount: 40, categoryId: toys }]) // week
    await seedSession(t, userId, todayStart - 10 * DAY, [{ amount: 7 }])             // month
    await seedSession(t, userId, Date.parse('2025-01-01T00:00:00Z'), [{ amount: 1000 }]) // all-time only
    await seedExpense(t, userId, todayStart + 1000, 20)
    await seedExpense(t, userId, todayStart - DAY, 3)
    await seedExpense(t, userId, Date.parse('2024-01-01T00:00:00Z'), 400)

    expect(await as.query(api.saleSessions.getStats, args)).toEqual({
      todayTotal:          135,
      todaySalesTotal:     135,
      todayNetTotal:       115,
      todayCount:          3,
      todayExpenseTotal:   20,
      todayExpenseCount:   1,
      weekTotal:           175 - 23,
      weekCount:           4,
      monthTotal:          182 - 23,
      monthCount:          5,
      allTimeTotal:        1182 - 423,
      allTimeCount:        6,
      allTimeSalesTotal:   1182,
      allTimeExpenseTotal: 423,
      topCategoryName:     'Food',
    })
  })

  it("never leaks another user's category name from a poisoned sale row", async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const bCat = await t.run((ctx) => ctx.db.insert('categories', { userId: bId, name: 'B secret', color: '#6366F1', createdAt: 0 }))
    await seedSession(t, userId, todayStart, [{ amount: 100, categoryId: bCat }])

    const stats = await as.query(api.saleSessions.getStats, args)
    expect(stats.topCategoryName).toBeNull()
    expect(stats.todaySalesTotal).toBe(100)
  })

  it('returns zeros without a user row', async () => {
    const t = makeT()
    const stats = await signIn(t, IDENTITIES.A).query(api.saleSessions.getStats, args)
    expect(Object.keys(stats)).toHaveLength(15)
    expect(stats.topCategoryName).toBeNull()
    expect(stats.allTimeTotal).toBe(0)
  })

  it('admin view-as works; non-admin view-as is FORBIDDEN', async () => {
    const t = makeT()
    const { userId: aId } = await signInAndUpsert(t, IDENTITIES.A)
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)
    await seedSession(t, aId, todayStart, [{ amount: 60 }])

    const viaAdmin = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getStats, { ...args, viewAsUserId: aId })
    expect(viaAdmin.todaySalesTotal).toBe(60)
    expect((await asB.query(api.saleSessions.getStats, args)).todaySalesTotal).toBe(0)

    for (const p of [
      asB.query(api.saleSessions.getStats, { ...args, viewAsUserId: aId }),
      asB.query(api.saleSessions.getDailyTotals, { startDate: 0, endDate: 1, timeZone: KHI, viewAsUserId: aId }),
      asB.query(api.saleSessions.getYearlyMonthlyTotals, { year: 2026, timeZone: KHI, viewAsUserId: aId }),
      asB.query(api.saleSessions.getAvailableYears, { timeZone: KHI, viewAsUserId: aId }),
    ]) {
      expect(await errorData(p)).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    }

    const adminYears = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getAvailableYears, {
      timeZone: KHI, viewAsUserId: aId,
    })
    expect(adminYears).toEqual([2026])
  })
})
