import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { CLIENT_REQUEST_ID_RE, CLIENT_REQUEST_RETENTION_MS } from '../../convex/lib/limits'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { IDENTITIES, makeT, signInAndUpsert, type TestT } from './setup'
import {
  DAY,
  KHI,
  diffDays,
  fakeAllTimers,
  readCategoryStats,
  readDays,
  readUserTotals,
  recomputeCategoryStats,
  recomputeDays,
  seedCategory,
  sumDays,
} from './totalsFixtures'

const NOW = '2026-11-17T12:00:00Z'
const TODAY = zonedStartOfDayMs('2026-11-17', KHI)
const RID = '0f8fad5b-d9cb-469f-a165-70867728950e' // crypto.randomUUID() shape
const RID2 = 'b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f'

async function errorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

function count(t: TestT, table: 'clientRequests' | 'saleSessions' | 'sales' | 'expenses') {
  return t.run(async (ctx) => (await ctx.db.query(table).collect()).length)
}

async function expectTotalsMatchSource(t: TestT, userId: Id<'users'>) {
  const expected = await recomputeDays(t, userId, KHI)
  expect(diffDays(await readDays(t, userId), expected)).toEqual([])
  const totals = await readUserTotals(t, userId)
  const sums = sumDays(expected)
  expect(totals).not.toBeNull()
  expect(totals!.salesTotal).toBeCloseTo(sums.salesTotal, 6)
  expect(totals!.expenseTotal).toBeCloseTo(sums.expenseTotal, 6)
  expect(totals!.itemCount).toBe(sums.itemCount)
  expect(totals!.expenseCount).toBe(sums.expenseCount)
  expect(await readCategoryStats(t, userId)).toEqual(await recomputeCategoryStats(t, userId))
}

beforeEach(() => {
  fakeAllTimers(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('clientRequestId format', () => {
  it('accepts crypto.randomUUID() output and the 16/64-char bounds', () => {
    for (let i = 0; i < 20; i++) expect(CLIENT_REQUEST_ID_RE.test(crypto.randomUUID())).toBe(true)
    expect(CLIENT_REQUEST_ID_RE.test('a'.repeat(16))).toBe(true)
    expect(CLIENT_REQUEST_ID_RE.test('A_b-9'.repeat(12) + 'abcd')).toBe(true) // 64
  })

  it('rejects bad ids with VALIDATION and writes nothing', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const bad = ['', 'short', 'a'.repeat(15), 'a'.repeat(65), 'has space 1234567', 'emoji-😀-1234567890', `${RID}\n`, ' ' + RID]
    for (const clientRequestId of bad) {
      expect(await errorData(as.mutation(api.saleSessions.record, {
        sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId,
      }))).toEqual({ code: 'VALIDATION', message: 'clientRequestId is not valid' })
      expect(await errorData(as.mutation(api.expenses.record, {
        amount: 10, expenseDate: TODAY, clientRequestId,
      }))).toEqual({ code: 'VALIDATION', message: 'clientRequestId is not valid' })
    }
    expect(await count(t, 'saleSessions')).toBe(0)
    expect(await count(t, 'expenses')).toBe(0)
    expect(await count(t, 'clientRequests')).toBe(0)
  })
})

describe('saleSessions.record with clientRequestId', () => {
  it('replay returns the same result and keeps one session + one ledger row', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const args = {
      sessionDate: TODAY,
      items: [{ productName: 'Tea', amount: 50 }, { productName: 'Rusk', amount: 25.5 }],
      clientRequestId: RID,
    }
    const first = await as.mutation(api.saleSessions.record, args)
    const second = await as.mutation(api.saleSessions.record, args)
    // A replay with a different payload still returns the stored first result.
    const third = await as.mutation(api.saleSessions.record, { ...args, items: [{ productName: 'X', amount: 999 }] })

    expect(first).toMatchObject({ totalAmount: 75.5, itemCount: 2 })
    expect(Object.keys(second).sort()).toEqual(['itemCount', 'sessionId', 'totalAmount'])
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(await count(t, 'saleSessions')).toBe(1)
    expect(await count(t, 'sales')).toBe(2)

    const rows = await t.run((ctx) => ctx.db.query('clientRequests').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId, clientRequestId: RID, kind: 'sale', sessionId: first.sessionId,
      totalAmount: 75.5, itemCount: 2, createdAt: Date.parse(NOW),
    })
    expect(rows[0]!.expenseId).toBeUndefined()
  })

  it('replay does not re-apply even when the stored date is now outside the accepted window', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const args = { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId: RID }
    const first = await as.mutation(api.saleSessions.record, args)
    vi.setSystemTime(Date.parse(NOW) + 30 * DAY)
    expect(await as.mutation(api.saleSessions.record, { ...args, sessionDate: Date.parse(NOW) + 400 * DAY }))
      .toEqual(first)
    expect(await count(t, 'saleSessions')).toBe(1)
  })

  it('totals hooks run once: summaries equal a recompute after many replays', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const food = await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    const ids = Array.from({ length: 6 }, () => crypto.randomUUID())
    for (let round = 0; round < 3; round++) {
      for (const [i, clientRequestId] of ids.entries()) {
        if (i % 2 === 0) {
          await as.mutation(api.saleSessions.record, {
            sessionDate: TODAY - i * DAY,
            items: [{ productName: 'a', amount: 10 + i, categoryId: food }, { productName: 'b', amount: 1 }],
            clientRequestId,
          })
        } else {
          await as.mutation(api.expenses.record, { amount: 5 + i, expenseDate: TODAY - i * DAY, clientRequestId })
        }
      }
    }
    // Legacy (no id) writes mixed in still count every time.
    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'c', amount: 7 }] })
    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'c', amount: 7 }] })

    expect(await count(t, 'saleSessions')).toBe(5)
    expect(await count(t, 'expenses')).toBe(3)
    expect(await count(t, 'clientRequests')).toBe(6)
    await expectTotalsMatchSource(t, userId)
    const totals = await readUserTotals(t, userId)
    expect(totals!.salesTotal).toBe((10 + 1) + (12 + 1) + (14 + 1) + 7 + 7)
    expect(totals!.expenseTotal).toBe(6 + 8 + 10)
    expect((await readCategoryStats(t, userId))[food]).toEqual({ saleCount: 3, totalAmount: 36 })
  })

  it('delete then replay does not recreate the session', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const args = {
      sessionDate: TODAY,
      items: [{ productName: 'Tea', amount: 50 }, { productName: 'Rusk', amount: 20 }],
      clientRequestId: RID,
    }
    const first = await as.mutation(api.saleSessions.record, args)
    const sales = await t.run((ctx) => ctx.db.query('sales').collect())
    for (const sale of sales) await as.mutation(api.sales.removeItem, { saleId: sale._id })
    expect(await count(t, 'saleSessions')).toBe(0)

    expect(await as.mutation(api.saleSessions.record, args)).toEqual(first)
    expect(await count(t, 'saleSessions')).toBe(0)
    expect(await count(t, 'sales')).toBe(0)
    expect(await count(t, 'clientRequests')).toBe(1)
    await expectTotalsMatchSource(t, userId)
    expect(await readDays(t, userId)).toEqual({})
  })

  it('concurrent replays of one id apply once', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const args = { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId: RID }
    const results = await Promise.all(Array.from({ length: 5 }, () => as.mutation(api.saleSessions.record, args)))
    for (const r of results) expect(r).toEqual(results[0])
    expect(await count(t, 'saleSessions')).toBe(1)
    expect(await count(t, 'clientRequests')).toBe(1)
    await expectTotalsMatchSource(t, userId)
  })

  it('a failed first attempt leaves no ledger row; the retry with the same id applies', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const base = { sessionDate: TODAY, clientRequestId: RID }

    expect(await errorData(as.mutation(api.saleSessions.record, { ...base, items: [{ productName: 'Tea', amount: 0 }] })))
      .toMatchObject({ code: 'VALIDATION' })
    const goneCategory = await seedCategory(t, userId, 'Gone')
    await t.run((ctx) => ctx.db.delete('categories', goneCategory))
    expect(await errorData(as.mutation(api.saleSessions.record, {
      ...base, items: [{ productName: 'Tea', amount: 50 }, { productName: 'Bun', amount: 5, categoryId: goneCategory }],
    }))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await count(t, 'clientRequests')).toBe(0)
    expect(await count(t, 'saleSessions')).toBe(0)
    expect(await count(t, 'sales')).toBe(0)

    const ok = await as.mutation(api.saleSessions.record, { ...base, items: [{ productName: 'Tea', amount: 50 }] })
    expect(ok).toMatchObject({ totalAmount: 50, itemCount: 1 })
    expect(await count(t, 'clientRequests')).toBe(1)
    await expectTotalsMatchSource(t, userId)
  })

  it('the same id from two users is independent', async () => {
    const t = makeT()
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const args = { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId: RID }
    const ra = await a.as.mutation(api.saleSessions.record, args)
    const rb = await b.as.mutation(api.saleSessions.record, { ...args, items: [{ productName: 'Tea', amount: 70 }] })
    expect(rb.sessionId).not.toBe(ra.sessionId)
    expect(rb.totalAmount).toBe(70)
    expect(await a.as.mutation(api.saleSessions.record, args)).toEqual(ra)
    expect(await b.as.mutation(api.saleSessions.record, args)).toEqual(rb)
    expect(await count(t, 'saleSessions')).toBe(2)
    expect(await count(t, 'clientRequests')).toBe(2)
    await expectTotalsMatchSource(t, a.userId)
    await expectTotalsMatchSource(t, b.userId)
  })

  it('reusing a sale id for an expense (and vice versa) is VALIDATION and writes nothing', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId: RID })
    await as.mutation(api.expenses.record, { amount: 10, expenseDate: TODAY, clientRequestId: RID2 })
    const msg = { code: 'VALIDATION', message: 'clientRequestId was already used for a different entry' }
    expect(await errorData(as.mutation(api.expenses.record, { amount: 10, expenseDate: TODAY, clientRequestId: RID })))
      .toEqual(msg)
    expect(await errorData(as.mutation(api.saleSessions.record, {
      sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }], clientRequestId: RID2,
    }))).toEqual(msg)
    expect(await count(t, 'saleSessions')).toBe(1)
    expect(await count(t, 'expenses')).toBe(1)
    expect(await count(t, 'clientRequests')).toBe(2)
  })
})

describe('expenses.record with clientRequestId', () => {
  it('replay returns { expenseId, amount } of the first call and writes nothing', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const args = { amount: 120, expenseDate: TODAY, note: ' rent ', clientRequestId: RID }
    const first = await as.mutation(api.expenses.record, args)
    const second = await as.mutation(api.expenses.record, { ...args, amount: 1 })
    expect(Object.keys(second).sort()).toEqual(['amount', 'expenseId'])
    expect(second).toEqual(first)
    expect(await count(t, 'expenses')).toBe(1)
    const rows = await t.run((ctx) => ctx.db.query('clientRequests').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'expense', expenseId: first.expenseId, totalAmount: 120, itemCount: 1 })
    expect(rows[0]!.sessionId).toBeUndefined()
    await expectTotalsMatchSource(t, userId)
  })

  it('delete then replay does not recreate the expense', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const args = { amount: 120, expenseDate: TODAY, clientRequestId: RID }
    const first = await as.mutation(api.expenses.record, args)
    await as.mutation(api.expenses.removeItem, { expenseId: first.expenseId })
    expect(await as.mutation(api.expenses.record, args)).toEqual(first)
    expect(await count(t, 'expenses')).toBe(0)
    await expectTotalsMatchSource(t, userId)
  })

  it('a failed first attempt leaves no ledger row', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await errorData(as.mutation(api.expenses.record, { amount: -1, expenseDate: TODAY, clientRequestId: RID })))
      .toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(as.mutation(api.expenses.record, { amount: 5, expenseDate: TODAY + 10 * DAY, clientRequestId: RID })))
      .toMatchObject({ code: 'VALIDATION' })
    expect(await count(t, 'clientRequests')).toBe(0)
    expect(await count(t, 'expenses')).toBe(0)
    await as.mutation(api.expenses.record, { amount: 5, expenseDate: TODAY, clientRequestId: RID })
    expect(await count(t, 'expenses')).toBe(1)
  })
})

describe('legacy path (no clientRequestId)', () => {
  it('identical calls create separate entries and never touch the ledger', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const sale = { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }] }
    const s1 = await as.mutation(api.saleSessions.record, sale)
    const s2 = await as.mutation(api.saleSessions.record, sale)
    const e1 = await as.mutation(api.expenses.record, { amount: 10, expenseDate: TODAY })
    const e2 = await as.mutation(api.expenses.record, { amount: 10, expenseDate: TODAY })
    expect(s1.sessionId).not.toBe(s2.sessionId)
    expect(e1.expenseId).not.toBe(e2.expenseId)
    expect(Object.keys(s1).sort()).toEqual(['itemCount', 'sessionId', 'totalAmount'])
    expect(Object.keys(e1).sort()).toEqual(['amount', 'expenseId'])
    expect(await count(t, 'saleSessions')).toBe(2)
    expect(await count(t, 'expenses')).toBe(2)
    expect(await count(t, 'clientRequests')).toBe(0)
    await expectTotalsMatchSource(t, userId)
  })
})

describe('pruneClientRequests', () => {
  it('deletes rows older than 180 days in self-rescheduling batches and keeps newer rows', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const now = Date.parse(NOW)
    const sessionId = await t.run((ctx) =>
      ctx.db.insert('saleSessions', { userId, totalAmount: 1, itemCount: 1, sessionDate: TODAY, createdAt: 0 }),
    )
    const ages = [400, 300, 200, 181, 180.5, 179, 10, 0]
    await t.run(async (ctx) => {
      for (const [i, age] of ages.entries()) {
        await ctx.db.insert('clientRequests', {
          userId, clientRequestId: `req-${String(i).padStart(12, '0')}`, kind: 'sale', sessionId,
          totalAmount: 1, itemCount: 1, createdAt: now - age * DAY,
        })
      }
    })

    const first = await t.mutation(internal.clientRequests.pruneClientRequests, { batchSize: 2 })
    expect(first).toMatchObject({ deleted: 2, rescheduled: true })
    // Fake timers may tick a few ms between calls.
    expect(Math.abs(first.cutoff - (now - CLIENT_REQUEST_RETENTION_MS))).toBeLessThan(1000)
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const left = await t.run((ctx) => ctx.db.query('clientRequests').collect())
    expect(left.map((r) => Math.round((now - r.createdAt) / DAY)).sort((a, b) => b - a)).toEqual([179, 10, 0])

    // Nothing old left: a run is a no-op and does not reschedule.
    expect(await t.mutation(internal.clientRequests.pruneClientRequests, {}))
      .toMatchObject({ deleted: 0, rescheduled: false })
  })
})
