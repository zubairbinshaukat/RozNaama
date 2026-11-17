import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError, v } from 'convex/values'
import { validate } from 'convex-helpers/validators'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { expenseDoc, paginated } from '../../convex/lib/returnValidators'
import { freezeNow, IDENTITIES, makeT, signIn, signInAndUpsert, type TestT } from './setup'

const NOW = '2026-03-10T12:00:00Z'
const HOUR = 60 * 60 * 1000

const recordReturns = v.object({ expenseId: v.id('expenses'), amount: v.number() })
const listReturns = v.array(expenseDoc)
const pageReturns = paginated(expenseDoc)

async function convexErrorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

const validation = (message: string) => ({ code: 'VALIDATION', message })

async function expenseCount(t: TestT): Promise<number> {
  return (await t.run((ctx) => ctx.db.query('expenses').collect())).length
}

let now = 0
beforeEach(() => {
  now = freezeNow(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('expenses auth', () => {
  it('rejects signed-out callers on every function', async () => {
    const t = makeT()
    const unauth = { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    expect(await convexErrorData(t.mutation(api.expenses.record, { amount: 10, expenseDate: now })))
      .toEqual(unauth)
    expect(await convexErrorData(t.query(api.expenses.getForRange, { startDate: 0, endDate: now })))
      .toEqual(unauth)
    expect(await convexErrorData(t.query(api.expenses.getPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    }))).toEqual(unauth)
    expect(await convexErrorData(t.query(api.expenses.getForRangePaginated, {
      startDate: 0, endDate: now, paginationOpts: { numItems: 10, cursor: null },
    }))).toEqual(unauth)
  })

  it('signed in without a user row: writes throw USER_NOT_FOUND, reads return empty', async () => {
    const t = makeT()
    const as = signIn(t, IDENTITIES.A)
    expect(await convexErrorData(as.mutation(api.expenses.record, { amount: 10, expenseDate: now })))
      .toEqual({ code: 'USER_NOT_FOUND', message: 'User not found — please sign in again' })

    const range = await as.query(api.expenses.getForRange, { startDate: 0, endDate: now })
    expect(range).toEqual([])
    const page = await as.query(api.expenses.getPaginated, { paginationOpts: { numItems: 5, cursor: null } })
    expect(page).toEqual({ page: [], isDone: true, continueCursor: '' })
    expect(validate(pageReturns, page)).toBe(true)
    const rangePage = await as.query(api.expenses.getForRangePaginated, {
      startDate: 0, endDate: now, paginationOpts: { numItems: 5, cursor: null },
    })
    expect(rangePage).toEqual({ page: [], isDone: true, continueCursor: '' })
  })
})

describe('expenses.record', () => {
  it('inserts a trimmed expense and returns { expenseId, amount }', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const result = await as.mutation(api.expenses.record, { amount: 250, expenseDate: now, note: '  Bijli bill  ' })
    expect(validate(recordReturns, result, { throw: true })).toBe(true)
    expect(result.amount).toBe(250)

    const row = await t.run((ctx) => ctx.db.get('expenses', result.expenseId))
    expect(row).toMatchObject({ userId, amount: 250, note: 'Bijli bill', expenseDate: now, createdAt: now })

    const blank = await as.mutation(api.expenses.record, { amount: 1, expenseDate: now, note: '   ' })
    const blankRow = await t.run((ctx) => ctx.db.get('expenses', blank.expenseId))
    expect(blankRow?.note).toBeUndefined()
  })

  it.each([
    ['zero', 0, 'Expense amount must be greater than 0'],
    ['negative', -5, 'Expense amount must be greater than 0'],
    ['NaN', Number.NaN, 'Expense amount must be a valid number'],
    ['Infinity', Number.POSITIVE_INFINITY, 'Expense amount must be a valid number'],
    ['too large', 1e9 + 1, 'Expense amount is too large'],
  ])('rejects %s amount', async (_label, amount, message) => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await convexErrorData(as.mutation(api.expenses.record, { amount, expenseDate: now })))
      .toEqual(validation(message))
    expect(await expenseCount(t)).toBe(0)
  })

  it('accepts the maximum amount (1e9)', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect((await as.mutation(api.expenses.record, { amount: 1e9, expenseDate: now })).amount).toBe(1e9)
  })

  it.each([
    ['NaN', () => Number.NaN, 'Expense date is not valid'],
    ['future (> now + 36h)', () => now + 37 * HOUR, 'Expense date cannot be in the future'],
    ['too old (< 2000-01-01)', () => Date.UTC(1999, 11, 31), 'Expense date is too far in the past'],
  ])('rejects %s date', async (_label, date, message) => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await convexErrorData(as.mutation(api.expenses.record, { amount: 10, expenseDate: date() })))
      .toEqual(validation(message))
    expect(await expenseCount(t)).toBe(0)
  })

  it('accepts dates within the 36h future slack and from 2000-01-01', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.expenses.record, { amount: 10, expenseDate: now + 35 * HOUR })
    await as.mutation(api.expenses.record, { amount: 10, expenseDate: Date.UTC(2000, 0, 1) })
    expect(await expenseCount(t)).toBe(2)
  })

  it('rejects a note longer than 100 characters (after trimming)', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await convexErrorData(as.mutation(api.expenses.record, {
      amount: 10, expenseDate: now, note: 'n'.repeat(101),
    }))).toEqual(validation('Note must be 100 characters or fewer'))
    await as.mutation(api.expenses.record, { amount: 10, expenseDate: now, note: ` ${'n'.repeat(100)} ` })
    expect(await expenseCount(t)).toBe(1)
  })
})

describe('expenses.updateItem / removeItem', () => {
  async function seed(t: TestT) {
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const { expenseId } = await a.as.mutation(api.expenses.record, { amount: 100, expenseDate: now, note: 'Tea' })
    return { a, b, expenseId }
  }

  it('updates amount and note, returning null', async () => {
    const t = makeT()
    const { a, expenseId } = await seed(t)
    const result = await a.as.mutation(api.expenses.updateItem, { expenseId, amount: 150, note: '  Chai  ' })
    expect(result).toBeNull()
    expect(await t.run((ctx) => ctx.db.get('expenses', expenseId))).toMatchObject({ amount: 150, note: 'Chai' })

    await a.as.mutation(api.expenses.updateItem, { expenseId, amount: 150 })
    expect((await t.run((ctx) => ctx.db.get('expenses', expenseId)))?.note).toBeUndefined()
  })

  it('validates a changed amount / note', async () => {
    const t = makeT()
    const { a, expenseId } = await seed(t)
    expect(await convexErrorData(a.as.mutation(api.expenses.updateItem, { expenseId, amount: 0 })))
      .toEqual(validation('Expense amount must be greater than 0'))
    expect(await convexErrorData(a.as.mutation(api.expenses.updateItem, { expenseId, amount: Number.NaN })))
      .toEqual(validation('Expense amount must be a valid number'))
    expect(await convexErrorData(a.as.mutation(api.expenses.updateItem, { expenseId, amount: 2e9 })))
      .toEqual(validation('Expense amount is too large'))
    expect(await convexErrorData(a.as.mutation(api.expenses.updateItem, {
      expenseId, amount: 100, note: 'x'.repeat(101),
    }))).toEqual(validation('Note must be 100 characters or fewer'))
    expect(await t.run((ctx) => ctx.db.get('expenses', expenseId))).toMatchObject({ amount: 100, note: 'Tea' })
  })

  it('does not revalidate unchanged legacy fields', async () => {
    const t = makeT()
    const { a } = await seed(t)
    const longNote = 'L'.repeat(150)
    const legacyId = await t.run((ctx) => ctx.db.insert('expenses', {
      userId: a.userId, amount: 0, note: longNote, expenseDate: Date.UTC(1990, 0, 1), createdAt: 0,
    }))
    // Same (invalid) amount, same long note → allowed.
    await a.as.mutation(api.expenses.updateItem, { expenseId: legacyId, amount: 0, note: longNote })
    // Change amount only, keep long note → allowed.
    await a.as.mutation(api.expenses.updateItem, { expenseId: legacyId, amount: 50, note: longNote })
    expect(await t.run((ctx) => ctx.db.get('expenses', legacyId))).toMatchObject({ amount: 50, note: longNote })
    // Legacy rows are still readable via the returns validators.
    const rows = await a.as.query(api.expenses.getForRange, { startDate: 0, endDate: now })
    expect(validate(listReturns, rows, { throw: true })).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('removes the expense', async () => {
    const t = makeT()
    const { a, expenseId } = await seed(t)
    expect(await a.as.mutation(api.expenses.removeItem, { expenseId })).toBeNull()
    expect(await t.run((ctx) => ctx.db.get('expenses', expenseId))).toBeNull()
    expect(await convexErrorData(a.as.mutation(api.expenses.removeItem, { expenseId })))
      .toEqual({ code: 'NOT_FOUND', message: 'Expense not found' })
  })

  it("cannot update, delete or read another user's expense", async () => {
    const t = makeT()
    const { b, expenseId } = await seed(t)
    const notFound = { code: 'NOT_FOUND', message: 'Expense not found' }
    expect(await convexErrorData(b.as.mutation(api.expenses.updateItem, { expenseId, amount: 1 })))
      .toEqual(notFound)
    expect(await convexErrorData(b.as.mutation(api.expenses.removeItem, { expenseId })))
      .toEqual(notFound)
    expect(await t.run((ctx) => ctx.db.get('expenses', expenseId))).toMatchObject({ amount: 100, note: 'Tea' })

    expect(await b.as.query(api.expenses.getForRange, { startDate: 0, endDate: now + HOUR })).toEqual([])
    const page = await b.as.query(api.expenses.getPaginated, { paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page).toEqual([])
  })
})

describe('expenses reads', () => {
  async function seedDays(t: TestT): Promise<{ userId: Id<'users'>; as: ReturnType<typeof signIn>; dates: number[] }> {
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const dates = [1, 2, 3, 4, 5].map((d) => Date.UTC(2026, 2, d))
    for (const [i, date] of dates.entries()) {
      await as.mutation(api.expenses.record, { amount: (i + 1) * 10, expenseDate: date })
    }
    return { as, userId, dates }
  }

  it('getForRange is inclusive of both bounds', async () => {
    const t = makeT()
    const { as, dates } = await seedDays(t)
    const rows = await as.query(api.expenses.getForRange, { startDate: dates[1], endDate: dates[3] })
    expect(validate(listReturns, rows, { throw: true })).toBe(true)
    expect(rows.map((r) => r.amount)).toEqual([20, 30, 40])
  })

  it('getPaginated pages newest first with a valid pagination shape', async () => {
    const t = makeT()
    const { as } = await seedDays(t)
    const first = await as.query(api.expenses.getPaginated, { paginationOpts: { numItems: 2, cursor: null } })
    expect(validate(pageReturns, first, { throw: true })).toBe(true)
    expect(first.page.map((r) => r.amount)).toEqual([50, 40])
    expect(first.isDone).toBe(false)

    const second = await as.query(api.expenses.getPaginated, {
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    })
    expect(validate(pageReturns, second, { throw: true })).toBe(true)
    expect(second.page.map((r) => r.amount)).toEqual([30, 20, 10])
    expect(second.isDone).toBe(true)
  })

  it('getForRangePaginated pages newest first within the range', async () => {
    const t = makeT()
    const { as, dates } = await seedDays(t)
    const result = await as.query(api.expenses.getForRangePaginated, {
      startDate: dates[0], endDate: dates[2], paginationOpts: { numItems: 10, cursor: null },
    })
    expect(validate(pageReturns, result, { throw: true })).toBe(true)
    expect(result.page.map((r) => r.amount)).toEqual([30, 20, 10])
    expect(result.isDone).toBe(true)
  })

  it('admins can view another user via viewAsUserId; non-admins get FORBIDDEN', async () => {
    const t = makeT()
    const { userId, dates } = await seedDays(t)
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)
    const admin = signIn(t, IDENTITIES.ADMIN)

    const rows = await admin.query(api.expenses.getForRange, {
      startDate: dates[0], endDate: dates[4], viewAsUserId: userId,
    })
    expect(rows).toHaveLength(5)
    const page = await admin.query(api.expenses.getPaginated, {
      paginationOpts: { numItems: 3, cursor: null }, viewAsUserId: userId,
    })
    expect(page.page).toHaveLength(3)
    const rangePage = await admin.query(api.expenses.getForRangePaginated, {
      startDate: dates[0], endDate: dates[4], paginationOpts: { numItems: 10, cursor: null }, viewAsUserId: userId,
    })
    expect(rangePage.page).toHaveLength(5)

    const forbidden = { code: 'FORBIDDEN', message: 'Forbidden' }
    expect(await convexErrorData(asB.query(api.expenses.getForRange, {
      startDate: dates[0], endDate: dates[4], viewAsUserId: userId,
    }))).toEqual(forbidden)
    expect(await convexErrorData(asB.query(api.expenses.getPaginated, {
      paginationOpts: { numItems: 3, cursor: null }, viewAsUserId: userId,
    }))).toEqual(forbidden)
    expect(await convexErrorData(asB.query(api.expenses.getForRangePaginated, {
      startDate: dates[0], endDate: dates[4], paginationOpts: { numItems: 3, cursor: null }, viewAsUserId: userId,
    }))).toEqual(forbidden)
  })
})
