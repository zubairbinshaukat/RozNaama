/**
 * Nameless khata records (customer optional), khata.entryDetail and
 * khata.setEntryCustomer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { KHATA_MESSAGES } from '../../convex/lib/errors'
import { IDENTITIES, makeT, signInAndUpsert, type TestT } from './setup'
import { fakeAllTimers } from './totalsFixtures'
import {
  NOW,
  TODAY,
  YESTERDAY,
  count,
  errorData,
  expectKhataConsistent,
  expectTotalsMatchSource,
  expensesTotal,
  salesByDay,
} from './khataFixtures'

const RID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const RID2 = 'b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f'
const T = '2026-11-17'
const Y = '2026-11-16'

beforeEach(() => {
  fakeAllTimers(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

async function setup(t: TestT) {
  const a = await signInAndUpsert(t, IDENTITIES.A)
  await a.as.mutation(api.settings.update, { khataEnabled: true })
  return a
}

function customers(t: TestT) {
  return t.run((ctx) => ctx.db.query('customers').collect())
}

function sessionItemNames(t: TestT, sessionId: Id<'saleSessions'>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).collect())
      .map((s) => s.productName),
  )
}

describe.each(['delivery', 'cash'] as const)('nameless records (%s)', (mode) => {
  it('udhaar + advance without a customer: no customer rows, khataTotals updated, sales per mode', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)

    const u = await as.mutation(api.khata.recordSale, {
      items: [{ productName: 'Suit', amount: 6000 }], sessionDate: YESTERDAY, receivedNow: 3000, recognition: mode,
    })
    const blank = await as.mutation(api.khata.recordSale, {
      customer: { name: '   ', phone: '0300' }, items: [{ productName: 'Cap', amount: 500 }],
      sessionDate: TODAY, receivedNow: 100, recognition: mode,
    })
    const adv = await as.mutation(api.khata.openAdvance, {
      amount: 1000, receivedAt: YESTERDAY, recognition: mode, total: 4000,
    })
    expect(await customers(t)).toEqual([])
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 3400, dueCount: 2, heldTotal: 1000, heldCount: 1 })

    if (mode === 'cash') {
      expect(await sessionItemNames(t, u.sessionId!)).toEqual(['Udhaar'])
      const advEntry = await as.query(api.khata.entryDetail, { entryId: adv.entryId })
      expect(advEntry!.payments).toHaveLength(1)
      expect(await sessionItemNames(t, advEntry!.payments[0]!.saleSessionId!)).toEqual(['Advance'])
    }

    await as.mutation(api.khata.receivePayment, { entryId: u.entryId, amount: 3000, receivedAt: TODAY })
    await as.mutation(api.khata.forgiveRemaining, { entryId: blank.entryId })
    const done = await as.mutation(api.khata.completeAdvance, {
      entryId: adv.entryId, finalTotal: 4000, receivedNow: 3000, deliveredAt: TODAY,
    })
    expect(done).toMatchObject({ status: 'settled', remaining: 0 })
    if (mode === 'delivery') {
      expect(await sessionItemNames(t, done.sessionId!)).toEqual(['Order'])
    }

    const kept = await as.mutation(api.khata.openAdvance, { amount: 200, receivedAt: TODAY, recognition: mode })
    await as.mutation(api.khata.cancelAdvance, { entryId: kept.entryId, refund: false, at: TODAY })
    const refunded = await as.mutation(api.khata.openAdvance, { amount: 300, receivedAt: TODAY, recognition: mode })
    await as.mutation(api.khata.cancelAdvance, { entryId: refunded.entryId, refund: true, at: TODAY })

    const expected = mode === 'delivery'
      ? { [Y]: 6000, [T]: 500 + 4000 + 200 }
      : { [Y]: 3000 + 1000, [T]: 3000 + 100 + 3000 + 200 + 300 }
    expect(await salesByDay(t, userId)).toEqual(expected)
    expect(await expensesTotal(t, userId)).toBe(mode === 'cash' ? 300 : 0)
    if (mode === 'cash') {
      const [expense] = await t.run((ctx) => ctx.db.query('expenses').collect())
      expect(expense!.note).toBe('Advance refund')
    } else {
      const keptEntry = await as.query(api.khata.entryDetail, { entryId: kept.entryId })
      expect(await sessionItemNames(t, keptEntry!.entry.saleSessionId!)).toEqual(['Advance kept'])
    }

    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    expect(await customers(t)).toEqual([])
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })
})

describe('nameless query rows', () => {
  it('listOpen / badgesForRange / entryDetail return null customer fields', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const u = await as.mutation(api.khata.recordSale, {
      items: [{ productName: 'Suit', amount: 600 }], sessionDate: TODAY, receivedNow: 100,
    })
    const named = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Ali', phone: '0300 1' }, items: [{ productName: 'Hat', amount: 50 }], sessionDate: TODAY, receivedNow: 0,
    })

    const page = await as.query(api.khata.listOpen, { segment: 'due', paginationOpts: { numItems: 10, cursor: null } })
    const row = page.page.find((r) => r._id === u.entryId)!
    expect(row).toMatchObject({ customerId: null, customerName: null, remaining: 500 })
    expect('customerPhone' in row).toBe(false)
    expect(page.page.find((r) => r._id === named.entryId)).toMatchObject({ customerName: 'Ali', customerPhone: '03001' })

    const badges = await as.query(api.khata.badgesForRange, { startDate: TODAY, endDate: TODAY })
    expect(badges.find((b) => b.entryId === u.entryId)).toMatchObject({ customerId: null, customerName: null })

    const detail = await as.query(api.khata.entryDetail, { entryId: u.entryId })
    expect(detail).toMatchObject({ customer: null, paymentsCapped: false, entry: { customerId: null, remaining: 500 } })
    expect(detail!.payments).toEqual([expect.objectContaining({ amount: 100, customerId: null })])

    const namedDetail = await as.query(api.khata.entryDetail, { entryId: named.entryId })
    expect(namedDetail!.customer).toMatchObject({ name: 'Ali' })
    expect(namedDetail!.entry.customerId).toBe(namedDetail!.customer!._id)
  })

  it('entryDetail ownership: other user / not upserted → null', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const u = await as.mutation(api.khata.recordSale, {
      items: [{ productName: 'Suit', amount: 600 }], sessionDate: TODAY, receivedNow: 100,
    })
    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await b.as.query(api.khata.entryDetail, { entryId: u.entryId })).toBeNull()
    expect(await errorData(b.as.query(api.khata.entryDetail, { entryId: u.entryId, viewAsUserId: (await t.run((ctx) => ctx.db.query('users').first()))!._id })))
      .toMatchObject({ code: 'FORBIDDEN' })
    expect(await t.withIdentity(IDENTITIES.NOT_ADMIN_ROLE).query(api.khata.entryDetail, { entryId: u.entryId })).toBeNull()
  })
})

describe('idempotent nameless creates', () => {
  it('recordSale / openAdvance without a customer replay the stored result', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const saleArgs = { items: [{ productName: 'Suit', amount: 600 }], sessionDate: TODAY, receivedNow: 100, clientRequestId: RID }
    const first = await as.mutation(api.khata.recordSale, saleArgs)
    expect(await as.mutation(api.khata.recordSale, saleArgs)).toEqual(first)
    expect(await as.mutation(api.khata.recordSale, { ...saleArgs, customer: { name: 'Ali' } })).toEqual(first)
    const advArgs = { amount: 300, receivedAt: TODAY, clientRequestId: RID2 }
    const adv = await as.mutation(api.khata.openAdvance, advArgs)
    expect(await as.mutation(api.khata.openAdvance, advArgs)).toEqual(adv)
    expect(await count(t, 'khataEntries')).toBe(2)
    expect(await count(t, 'khataPayments')).toBe(2)
    expect(await count(t, 'customers')).toBe(0)
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 500, dueCount: 1, heldTotal: 300, heldCount: 1 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })
})

describe('khata.setEntryCustomer', () => {
  it('attach / move / detach moves the open balance exactly; payments follow', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const u = await as.mutation(api.khata.recordSale, {
      items: [{ productName: 'Suit', amount: 6000 }], sessionDate: TODAY, receivedNow: 1000,
    })
    const adv = await as.mutation(api.khata.openAdvance, { amount: 700, receivedAt: TODAY })
    const byName = async (name: string) => (await customers(t)).find((c) => c.name === name)!

    // attach by name (find-or-create, phone kept)
    const attached = await as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: { name: 'Ali', phone: '0300' } })
    const ali = await byName('Ali')
    expect(attached).toEqual({ customerId: ali._id })
    expect(ali).toMatchObject({ dueTotal: 5000, heldTotal: 0, openCount: 1, phone: '0300' })
    await expectKhataConsistent(t, userId)

    // attach the advance to Ali by id
    vi.setSystemTime(Date.parse(NOW) + 60_000)
    await as.mutation(api.khata.setEntryCustomer, { entryId: adv.entryId, customer: { id: ali._id } })
    expect(await byName('Ali')).toMatchObject({ dueTotal: 5000, heldTotal: 700, openCount: 2, lastActivityAt: Date.parse(NOW) + 60_000 })
    await expectKhataConsistent(t, userId)

    // move the udhaar to Bilal; Ali keeps only the advance and his lastActivityAt
    vi.setSystemTime(Date.parse(NOW) + 120_000)
    const moved = await as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: { name: 'Bilal' } })
    const bilal = await byName('Bilal')
    expect(moved).toEqual({ customerId: bilal._id })
    expect(bilal).toMatchObject({ dueTotal: 5000, openCount: 1, lastActivityAt: Date.parse(NOW) + 120_000 })
    expect(await byName('Ali')).toMatchObject({ dueTotal: 0, heldTotal: 700, openCount: 1, lastActivityAt: Date.parse(NOW) + 60_000 })
    const payments = await t.run((ctx) => ctx.db.query('khataPayments').withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', u.entryId)).collect())
    expect(payments.map((p) => p.customerId)).toEqual([bilal._id])
    await expectKhataConsistent(t, userId)

    // same customer again: no-op
    expect(await as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: { name: ' bilal ' } }))
      .toEqual({ customerId: bilal._id })

    // detach (null and blank name)
    expect(await as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: null })).toEqual({ customerId: null })
    expect(await as.mutation(api.khata.setEntryCustomer, { entryId: adv.entryId, customer: { name: '  ' } })).toEqual({ customerId: null })
    for (const c of await customers(t)) expect(c).toMatchObject({ dueTotal: 0, heldTotal: 0, openCount: 0 })
    const detail = await as.query(api.khata.entryDetail, { entryId: u.entryId })
    expect(detail).toMatchObject({ customer: null, entry: { customerId: null } })
    expect(detail!.payments[0]!.customerId).toBeNull()

    // khataTotals never moved
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 5000, dueCount: 1, heldTotal: 700, heldCount: 1 })
    await expectKhataConsistent(t, userId)
    await expectTotalsMatchSource(t, userId)
  })

  it('closed records can be (re)assigned (history only); archived customers are un-archived; ownership enforced', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const u = await as.mutation(api.khata.recordSale, {
      items: [{ productName: 'Suit', amount: 600 }], sessionDate: TODAY, receivedNow: 100,
    })
    await as.mutation(api.khata.forgiveRemaining, { entryId: u.entryId })
    await as.mutation(api.khata.openAdvance, { customer: { name: 'Zara' }, amount: 5, receivedAt: TODAY })
    const zara = (await customers(t))[0]!
    const cancelled = (await as.query(api.khata.customerDetail, { customerId: zara._id }))!.entries[0]!
    await as.mutation(api.khata.cancelAdvance, { entryId: cancelled._id, refund: true, at: TODAY })
    await as.mutation(api.khata.archiveCustomer, { customerId: zara._id })

    await as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: { id: zara._id } })
    const after = (await customers(t))[0]!
    expect(after.archivedAt).toBeUndefined()
    expect(after).toMatchObject({ dueTotal: 0, heldTotal: 0, openCount: 0 })
    expect((await as.query(api.khata.customerDetail, { customerId: zara._id }))!.entries).toHaveLength(2)
    await expectKhataConsistent(t, userId)

    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await errorData(b.as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: null })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.ENTRY_NOT_FOUND })
    const bEntry = await b.as.mutation(api.khata.recordSale, {
      items: [{ productName: 'x', amount: 10 }], sessionDate: TODAY, receivedNow: 0,
    })
    expect(await errorData(b.as.mutation(api.khata.setEntryCustomer, { entryId: bEntry.entryId, customer: { id: zara._id } })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.CUSTOMER_NOT_FOUND })
    expect(await errorData(as.mutation(api.khata.setEntryCustomer, { entryId: u.entryId, customer: { name: 'x'.repeat(41) } })))
      .toMatchObject({ code: 'VALIDATION' })
  })

  it('archive is blocked by a named open record but nameless records never block anyone', async () => {
    const t = makeT()
    const { as } = await setup(t)
    await as.mutation(api.khata.recordSale, { items: [{ productName: 'x', amount: 10 }], sessionDate: TODAY, receivedNow: 0 })
    const s = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Sara' }, items: [{ productName: 'x', amount: 10 }], sessionDate: TODAY, receivedNow: 0,
    })
    const sara = (await customers(t))[0]!
    expect(await errorData(as.mutation(api.khata.archiveCustomer, { customerId: sara._id })))
      .toEqual({ code: 'VALIDATION', message: 'Sara still has Baqi PKR 10' })
    await as.mutation(api.khata.setEntryCustomer, { entryId: s.entryId, customer: null })
    await as.mutation(api.khata.archiveCustomer, { customerId: sara._id })
  })
})
