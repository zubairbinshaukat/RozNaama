import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { IDENTITIES, freezeNow, makeT, signIn, signInAndUpsert, type TestT } from './setup'

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

function addCategory(t: TestT, userId: Id<'users'>, name = 'Food') {
  return t.run((ctx) => ctx.db.insert('categories', { userId, name, color: '#6366F1', createdAt: 0 }))
}

function itemsOf(t: TestT, sessionId: Id<'saleSessions'>) {
  return t.run((ctx) =>
    ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).collect(),
  )
}

function getSession(t: TestT, id: Id<'saleSessions'>) {
  return t.run((ctx) => ctx.db.get('saleSessions', id))
}

function getSale(t: TestT, id: Id<'sales'>) {
  return t.run((ctx) => ctx.db.get('sales', id))
}

beforeEach(() => {
  freezeNow(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function setup() {
  const t = makeT()
  const a = await signInAndUpsert(t, IDENTITIES.A)
  const rec = await a.as.mutation(api.saleSessions.record, {
    sessionDate: TODAY,
    items: [{ productName: 'Tea', amount: 50 }, { productName: 'Bun', amount: 20, note: 'fresh' }],
  })
  const [tea, bun] = await itemsOf(t, rec.sessionId)
  return { t, a, sessionId: rec.sessionId, tea: tea!, bun: bun! }
}

describe('sales.updateItem', () => {
  it('applies the amount diff to the session total and returns null', async () => {
    const { t, a, sessionId, tea } = await setup()
    const catId = await addCategory(t, a.userId)
    const res = await a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: '  Green tea ', amount: 80, categoryId: catId, note: ' hot ',
    })
    expect(res).toBeNull()
    expect(await getSale(t, tea._id)).toMatchObject({
      productName: 'Green tea', amount: 80, categoryId: catId, note: 'hot', sessionId, saleDate: TODAY,
    })
    expect(await getSession(t, sessionId)).toMatchObject({ totalAmount: 100, itemCount: 2 })
  })

  it('clamps the session total at 0 on legacy drift', async () => {
    const { t, a, sessionId, tea } = await setup()
    await t.run((ctx) => ctx.db.patch('saleSessions', sessionId, { totalAmount: 10 }))
    await a.as.mutation(api.sales.updateItem, { saleId: tea._id, productName: 'Tea', amount: 1 })
    expect((await getSession(t, sessionId))?.totalAmount).toBe(0)
  })

  it('removes the note when cleared', async () => {
    const { t, a, bun } = await setup()
    await a.as.mutation(api.sales.updateItem, { saleId: bun._id, productName: 'Bun', amount: 20, note: '  ' })
    expect((await getSale(t, bun._id))?.note).toBeUndefined()
    await a.as.mutation(api.sales.updateItem, { saleId: bun._id, productName: 'Bun', amount: 20, note: 'x' })
    await a.as.mutation(api.sales.updateItem, { saleId: bun._id, productName: 'Bun', amount: 20 })
    expect((await getSale(t, bun._id))?.note).toBeUndefined()
  })

  it('moving the only item to a new date deletes the old session and creates one', async () => {
    const t = makeT()
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const rec = await a.as.mutation(api.saleSessions.record, {
      sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }],
    })
    const [tea] = await itemsOf(t, rec.sessionId)
    await a.as.mutation(api.sales.updateItem, {
      saleId: tea!._id, productName: 'Tea', amount: 60, saleDate: YESTERDAY,
    })
    expect(await getSession(t, rec.sessionId)).toBeNull()
    const moved = await getSale(t, tea!._id)
    expect(moved).toMatchObject({ amount: 60, saleDate: YESTERDAY })
    expect(await getSession(t, moved!.sessionId)).toMatchObject({
      totalAmount: 60, itemCount: 1, sessionDate: YESTERDAY, userId: a.userId,
    })
  })

  it('splitting from a multi-item session merges into an existing session on the target date', async () => {
    const { t, a, sessionId, tea } = await setup()
    const other = await a.as.mutation(api.saleSessions.record, {
      sessionDate: YESTERDAY, items: [{ productName: 'Milk', amount: 100 }],
    })
    await a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: 'Tea', amount: 55, saleDate: YESTERDAY,
    })
    expect(await getSession(t, sessionId)).toMatchObject({ totalAmount: 20, itemCount: 1 })
    expect(await getSession(t, other.sessionId)).toMatchObject({ totalAmount: 155, itemCount: 2 })
    expect(await getSale(t, tea._id)).toMatchObject({ sessionId: other.sessionId, saleDate: YESTERDAY, amount: 55 })
  })

  it('an unchanged saleDate does not move the item', async () => {
    const { t, a, sessionId, tea } = await setup()
    await a.as.mutation(api.sales.updateItem, { saleId: tea._id, productName: 'Tea', amount: 50, saleDate: TODAY })
    expect((await getSale(t, tea._id))?.sessionId).toBe(sessionId)
    expect(await getSession(t, sessionId)).toMatchObject({ totalAmount: 70, itemCount: 2 })
  })

  it('validates changed fields', async () => {
    const { t, a, tea } = await setup()
    const base = { saleId: tea._id, productName: 'Tea', amount: 50 }
    const cases: [Record<string, unknown>, string][] = [
      [{ amount: 0 }, 'Amount must be greater than 0'],
      [{ amount: 2e9 }, 'Amount is too large'],
      [{ productName: ' ' }, 'Product name is required'],
      [{ productName: 'n'.repeat(81) }, 'Product name must be 80 characters or fewer'],
      [{ note: 'n'.repeat(101) }, 'Note must be 100 characters or fewer'],
      [{ saleDate: Date.parse(NOW) + 3 * DAY }, 'Sale date cannot be in the future'],
      [{ saleDate: Date.UTC(1990, 0, 1) }, 'Sale date is too far in the past'],
    ]
    for (const [override, message] of cases) {
      expect(await errorData(a.as.mutation(api.sales.updateItem, { ...base, ...override })))
        .toEqual({ code: 'VALIDATION', message })
    }
    expect(await getSale(t, tea._id)).toMatchObject({ productName: 'Tea', amount: 50, saleDate: TODAY })
  })

  it('legacy row with a 120-char name and over-long note: note-only edit succeeds', async () => {
    const { t, a, tea } = await setup()
    const longName = 'L'.repeat(120)
    await t.run((ctx) => ctx.db.patch('sales', tea._id, { productName: longName, note: 'z'.repeat(150), amount: 2e9 }))
    await a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: longName, amount: 2e9, note: 'new note',
    })
    expect(await getSale(t, tea._id)).toMatchObject({ productName: longName, note: 'new note', amount: 2e9 })

    // Unchanged legacy note is also accepted.
    await t.run((ctx) => ctx.db.patch('sales', tea._id, { note: 'z'.repeat(150) }))
    await a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: longName, amount: 2e9, note: 'z'.repeat(150),
    })

    // Changing the name now must satisfy the limit.
    expect(await errorData(a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: longName + 'x', amount: 2e9,
    }))).toEqual({ code: 'VALIDATION', message: 'Product name must be 80 characters or fewer' })
  })

  it("rejects a changed category owned by another user, but keeps an unchanged legacy one", async () => {
    const { t, a, tea } = await setup()
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const bCat = await addCategory(t, b.userId, 'B cat')
    expect(await errorData(a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: 'Tea', amount: 50, categoryId: bCat,
    }))).toEqual({ code: 'NOT_FOUND', message: 'Category not found' })

    await t.run((ctx) => ctx.db.patch('sales', tea._id, { categoryId: bCat }))
    await a.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: 'Tea', amount: 51, categoryId: bCat,
    })
    expect((await getSale(t, tea._id))?.amount).toBe(51)
  })

  it("cannot edit another user's sale", async () => {
    const { t, tea } = await setup()
    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await errorData(b.as.mutation(api.sales.updateItem, {
      saleId: tea._id, productName: 'Hacked', amount: 1,
    }))).toEqual({ code: 'NOT_FOUND', message: 'Sale not found' })
    expect((await getSale(t, tea._id))?.productName).toBe('Tea')
  })

  it('requires sign-in', async () => {
    const { t, tea } = await setup()
    expect(await errorData(t.mutation(api.sales.updateItem, { saleId: tea._id, productName: 'x', amount: 1 })))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  })
})

describe('sales.removeItem', () => {
  it('decrements the session, then deletes it with the last item', async () => {
    const { t, a, sessionId, tea, bun } = await setup()
    expect(await a.as.mutation(api.sales.removeItem, { saleId: tea._id })).toBeNull()
    expect(await getSale(t, tea._id)).toBeNull()
    expect(await getSession(t, sessionId)).toMatchObject({ totalAmount: 20, itemCount: 1 })

    await a.as.mutation(api.sales.removeItem, { saleId: bun._id })
    expect(await getSession(t, sessionId)).toBeNull()
  })

  it("cannot delete another user's sale", async () => {
    const { t, sessionId, tea } = await setup()
    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await errorData(b.as.mutation(api.sales.removeItem, { saleId: tea._id })))
      .toEqual({ code: 'NOT_FOUND', message: 'Sale not found' })
    expect(await getSale(t, tea._id)).not.toBeNull()
    expect((await getSession(t, sessionId))?.itemCount).toBe(2)
  })

  it('handles an orphan sale whose session is gone', async () => {
    const { t, a, sessionId, tea } = await setup()
    await t.run((ctx) => ctx.db.delete('saleSessions', sessionId))
    await a.as.mutation(api.sales.removeItem, { saleId: tea._id })
    expect(await getSale(t, tea._id)).toBeNull()
  })
})

describe('sales read queries', () => {
  it('listByCategoryId / getCountsByCategory / getForDateRange are scoped to the user', async () => {
    const t = makeT()
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const food = await addCategory(t, a.userId, 'Food')
    const toys = await addCategory(t, a.userId, 'Toys')
    const bCat = await addCategory(t, b.userId, 'B')

    await a.as.mutation(api.saleSessions.record, {
      sessionDate: YESTERDAY,
      items: [{ productName: 'Old food', amount: 1, categoryId: food }],
    })
    await a.as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [
        { productName: 'New food', amount: 2, categoryId: food },
        { productName: 'Toy', amount: 3, categoryId: toys },
        { productName: 'Plain', amount: 4 },
      ],
    })
    await b.as.mutation(api.saleSessions.record, {
      sessionDate: TODAY,
      items: [{ productName: 'B item', amount: 9, categoryId: bCat }],
    })

    const foodRows = await a.as.query(api.sales.listByCategoryId, { categoryId: food })
    expect(foodRows.map((r) => r.productName)).toEqual(['New food', 'Old food'])
    expect(await b.as.query(api.sales.listByCategoryId, { categoryId: food })).toEqual([])

    const counts = await a.as.query(api.sales.getCountsByCategory, {})
    expect(counts.sort((x, y) => y.count - x.count)).toEqual([
      { categoryId: food, count: 2 },
      { categoryId: toys, count: 1 },
    ])

    const today = await a.as.query(api.sales.getForDateRange, { startDate: TODAY, endDate: TODAY + DAY - 1 })
    expect(today.map((r) => r.productName).sort()).toEqual(['New food', 'Plain', 'Toy'])

    // Admin view-as, and FORBIDDEN for non-admins.
    const adminCounts = await signIn(t, IDENTITIES.ADMIN).query(api.sales.getCountsByCategory, { viewAsUserId: b.userId })
    expect(adminCounts).toEqual([{ categoryId: bCat, count: 1 }])
    expect(await errorData(b.as.query(api.sales.listByCategoryId, { categoryId: food, viewAsUserId: a.userId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await errorData(b.as.query(api.sales.getForDateRange, { startDate: 0, endDate: 1, viewAsUserId: a.userId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })

  it('return [] for a signed-in user without a row', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.B)
    const cat = await addCategory(t, userId)
    const as = signIn(t, IDENTITIES.A)
    expect(await as.query(api.sales.listByCategoryId, { categoryId: cat })).toEqual([])
    expect(await as.query(api.sales.getCountsByCategory, {})).toEqual([])
    expect(await as.query(api.sales.getForDateRange, { startDate: 0, endDate: TODAY })).toEqual([])
  })
})
