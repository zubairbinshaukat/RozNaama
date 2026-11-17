import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MAX_SALE_ITEMS } from '../../convex/lib/limits'
import { IDENTITIES, freezeNow, makeT, signIn, signInAndUpsert, stubAdminEmails, type TestT } from './setup'

const NOW = '2026-11-17T12:00:00Z'
const DAY = 24 * 60 * 60 * 1000
/** 2026-11-17 00:00 PKT */
const TODAY = Date.parse('2026-11-16T19:00:00Z')
const YESTERDAY = TODAY - DAY

async function errorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

async function addCategory(t: TestT, userId: Id<'users'>, name = 'Food') {
  return t.run((ctx) =>
    ctx.db.insert('categories', { userId, name, color: '#6366F1', createdAt: 0 }),
  )
}

beforeEach(() => {
  freezeNow(NOW)
  stubAdminEmails()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('saleSessions.record', () => {
  it('rejects signed-out callers and users without a row', async () => {
    const t = makeT()
    const args = { items: [{ productName: 'Tea', amount: 50 }], sessionDate: TODAY }
    expect(await errorData(t.mutation(api.saleSessions.record, args)))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
    expect(await errorData(signIn(t, IDENTITIES.A).mutation(api.saleSessions.record, args)))
      .toEqual({ code: 'USER_NOT_FOUND', message: 'User not found — please sign in again' })
  })

  it('records a session with trimmed items and returns {sessionId, totalAmount, itemCount}', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const catId = await addCategory(t, userId)

    const result = await as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [
        { productName: '  Tea  ', amount: 50, categoryId: catId, note: '  hot  ' },
        { productName: 'Biscuit', amount: 30.5, note: '   ' },
      ],
    })
    expect(Object.keys(result).sort()).toEqual(['itemCount', 'sessionId', 'totalAmount'])
    expect(result).toMatchObject({ totalAmount: 80.5, itemCount: 2 })

    const session = await t.run((ctx) => ctx.db.get('saleSessions', result.sessionId))
    expect(session).toMatchObject({ userId, totalAmount: 80.5, itemCount: 2, sessionDate: TODAY })

    const items = await t.run((ctx) =>
      ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', result.sessionId)).collect(),
    )
    expect(items.map((i) => [i.productName, i.amount, i.note, i.categoryId, i.saleDate])).toEqual([
      ['Tea', 50, 'hot', catId, TODAY],
      ['Biscuit', 30.5, undefined, undefined, TODAY],
    ])
  })

  it('always creates a new session (no merge with an existing same-date session)', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const one = { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }] }
    const a = await as.mutation(api.saleSessions.record, one)
    const b = await as.mutation(api.saleSessions.record, one)
    expect(a.sessionId).not.toBe(b.sessionId)
  })

  it.each([
    ['no items', { items: [] }, 'At least one sale item is required'],
    [
      'too many items',
      { items: Array.from({ length: MAX_SALE_ITEMS + 1 }, () => ({ productName: 'x', amount: 1 })) },
      `You can add up to ${MAX_SALE_ITEMS} items at a time`,
    ],
    ['zero amount', { items: [{ productName: 'x', amount: 0 }] }, 'Amount must be greater than 0'],
    ['negative amount', { items: [{ productName: 'x', amount: -5 }] }, 'Amount must be greater than 0'],
    ['NaN amount', { items: [{ productName: 'x', amount: NaN }] }, 'Amount must be a valid number'],
    ['huge amount', { items: [{ productName: 'x', amount: 2e9 }] }, 'Amount is too large'],
    ['blank name', { items: [{ productName: '   ', amount: 1 }] }, 'Product name is required'],
    [
      'long name',
      { items: [{ productName: 'n'.repeat(81), amount: 1 }] },
      'Product name must be 80 characters or fewer',
    ],
    [
      'long note',
      { items: [{ productName: 'x', amount: 1, note: 'n'.repeat(101) }] },
      'Note must be 100 characters or fewer',
    ],
    [
      'future date',
      { items: [{ productName: 'x', amount: 1 }], sessionDate: Date.parse(NOW) + 3 * DAY },
      'Sale date cannot be in the future',
    ],
    [
      'pre-2000 date',
      { items: [{ productName: 'x', amount: 1 }], sessionDate: Date.UTC(1999, 0, 1) },
      'Sale date is too far in the past',
    ],
  ])('rejects %s and writes nothing', async (_label, override, message) => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const args = { sessionDate: TODAY, ...override }
    expect(await errorData(as.mutation(api.saleSessions.record, args)))
      .toEqual({ code: 'VALIDATION', message })
    expect(await t.run((ctx) => ctx.db.query('saleSessions').collect())).toHaveLength(0)
    expect(await t.run((ctx) => ctx.db.query('sales').collect())).toHaveLength(0)
  })

  it('accepts exactly 20 items, an 80-char name and a 100-char note', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const items = Array.from({ length: MAX_SALE_ITEMS }, () => ({
      productName: 'n'.repeat(80),
      amount: 1,
      note: 'm'.repeat(100),
    }))
    const res = await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items })
    expect(res.itemCount).toBe(MAX_SALE_ITEMS)
  })

  it("rejects another user's category", async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const bCat = await addCategory(t, bId, 'Secret')
    expect(await errorData(as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [{ productName: 'Tea', amount: 50, categoryId: bCat }],
    }))).toEqual({ code: 'NOT_FOUND', message: 'Category not found' })
    expect(await t.run((ctx) => ctx.db.query('sales').collect())).toHaveLength(0)
  })
})

describe('session reads', () => {
  async function seedTwoUsers(t: TestT) {
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const s1 = await a.as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [{ productName: 'Tea', amount: 50 }, { productName: 'Bun', amount: 20 }],
    })
    const s2 = await a.as.mutation(api.saleSessions.record, {
      sessionDate: YESTERDAY,
      items: [{ productName: 'Milk', amount: 100 }],
    })
    await b.as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [{ productName: 'B-only', amount: 999 }],
    })
    return { a, b, s1, s2 }
  }

  it('getForDate / getSessionsForRange attach items and only show the caller\'s data', async () => {
    const t = makeT()
    const { a, b, s1, s2 } = await seedTwoUsers(t)

    const today = await a.as.query(api.saleSessions.getForDate, {
      startOfDay: TODAY,
      endOfDay: TODAY + DAY - 1,
    })
    expect(today.map((s) => s._id)).toEqual([s1.sessionId])
    expect(today[0]!.items.map((i) => i.productName)).toEqual(['Tea', 'Bun'])

    const range = await a.as.query(api.saleSessions.getSessionsForRange, {
      startDate: YESTERDAY,
      endDate: TODAY + DAY - 1,
    })
    expect(range.map((s) => [s._id, s.items.map((i) => i.productName)])).toEqual([
      [s2.sessionId, ['Milk']],
      [s1.sessionId, ['Tea', 'Bun']],
    ])

    const bView = await b.as.query(api.saleSessions.getSessionsForRange, {
      startDate: YESTERDAY,
      endDate: TODAY + DAY - 1,
    })
    expect(bView.flatMap((s) => s.items.map((i) => i.productName))).toEqual(['B-only'])
  })

  it('falls back to by_sessionId for legacy rows (saleDate ≠ sessionDate, drifted itemCount)', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { legacyId, driftId } = await t.run(async (ctx) => {
      const legacyId = await ctx.db.insert('saleSessions', {
        userId, totalAmount: 30, itemCount: 2, sessionDate: TODAY, createdAt: 0,
      })
      // One item has a saleDate outside the session's day (legacy drift).
      await ctx.db.insert('sales', {
        userId, sessionId: legacyId, productName: 'In range', amount: 10, saleDate: TODAY, createdAt: 0,
      })
      await ctx.db.insert('sales', {
        userId, sessionId: legacyId, productName: 'Out of range', amount: 20,
        saleDate: TODAY - 10 * DAY, createdAt: 0,
      })
      const driftId = await ctx.db.insert('saleSessions', {
        userId, totalAmount: 0, itemCount: 5, sessionDate: TODAY + 1000, createdAt: 0,
      })
      await ctx.db.insert('sales', {
        userId, sessionId: driftId, productName: 'Only one', amount: -3,
        saleDate: TODAY + 1000, createdAt: 0, note: 'x'.repeat(300),
      })
      return { legacyId, driftId }
    })

    const rows = await as.query(api.saleSessions.getForDate, {
      startOfDay: TODAY,
      endOfDay: TODAY + DAY - 1,
    })
    expect(rows.map((s) => [s._id, s.items.map((i) => i.productName)])).toEqual([
      [legacyId, ['In range', 'Out of range']],
      [driftId, ['Only one']],
    ])
  })

  it('getSessionsPaginated pages newest-first with items', async () => {
    const t = makeT()
    const { a, s1, s2 } = await seedTwoUsers(t)
    const first = await a.as.query(api.saleSessions.getSessionsPaginated, {
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(first.page.map((s) => s._id)).toEqual([s1.sessionId])
    expect(first.page[0]!.items).toHaveLength(2)
    expect(first.isDone).toBe(false)

    const second = await a.as.query(api.saleSessions.getSessionsPaginated, {
      paginationOpts: { numItems: 5, cursor: first.continueCursor },
    })
    expect(second.page.map((s) => [s._id, s.items.length])).toEqual([[s2.sessionId, 1]])
    expect(second.isDone).toBe(true)
  })

  it('getSessionsForRangePaginated respects the range', async () => {
    const t = makeT()
    const { a, s1 } = await seedTwoUsers(t)
    const res = await a.as.query(api.saleSessions.getSessionsForRangePaginated, {
      startDate: TODAY,
      endDate: TODAY + DAY - 1,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(res.page.map((s) => s._id)).toEqual([s1.sessionId])
    expect(res.isDone).toBe(true)
  })

  it('returns empty shapes for a signed-in user without a row', async () => {
    const t = makeT()
    const as = signIn(t, IDENTITIES.A)
    const opts = { paginationOpts: { numItems: 10, cursor: null } }
    expect(await as.query(api.saleSessions.getForDate, { startOfDay: 0, endOfDay: TODAY })).toEqual([])
    expect(await as.query(api.saleSessions.getSessionsForRange, { startDate: 0, endDate: TODAY })).toEqual([])
    expect(await as.query(api.saleSessions.getSessionsPaginated, opts))
      .toEqual({ page: [], isDone: true, continueCursor: '' })
    expect(await as.query(api.saleSessions.getSessionsForRangePaginated, { startDate: 0, endDate: TODAY, ...opts }))
      .toEqual({ page: [], isDone: true, continueCursor: '' })
  })

  it('rejects signed-out reads', async () => {
    const t = makeT()
    expect(await errorData(t.query(api.saleSessions.getForDate, { startOfDay: 0, endOfDay: 1 })))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  })

  it('admins can view another user; non-admins get FORBIDDEN', async () => {
    const t = makeT()
    const { a, b, s1, s2 } = await seedTwoUsers(t)
    const range = { startDate: YESTERDAY, endDate: TODAY + DAY - 1 }

    const adminView = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getSessionsForRange, {
      ...range,
      viewAsUserId: a.userId,
    })
    expect(adminView.map((s) => s._id)).toEqual([s2.sessionId, s1.sessionId])

    const adminPaged = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getSessionsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
      viewAsUserId: a.userId,
    })
    expect(adminPaged.page).toHaveLength(2)

    expect(await errorData(b.as.query(api.saleSessions.getSessionsForRange, {
      ...range,
      viewAsUserId: a.userId,
    }))).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await errorData(b.as.query(api.saleSessions.getForDate, {
      startOfDay: TODAY, endOfDay: TODAY + DAY - 1, viewAsUserId: a.userId,
    }))).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })
})
