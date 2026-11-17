import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { KHATA_MESSAGES } from '../../convex/lib/errors'
import { MAX_KHATA_PAYMENTS_PER_ENTRY } from '../../convex/lib/limits'
import { IDENTITIES, makeIdentity, makeT, signIn, signInAndUpsert, type TestT } from './setup'
import { fakeAllTimers } from './totalsFixtures'
import {
  DAY,
  TODAY,
  YESTERDAY,
  NOW,
  count,
  errorData,
  expectKhataConsistent,
  expectTotalsMatchSource,
  expensesTotal,
  salesByDay,
} from './khataFixtures'

const RID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const RID2 = 'b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f'
const RID3 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const TODAY_KEY = '2026-11-17'
const YESTERDAY_KEY = '2026-11-16'

/**
 * Admin under either admin check (Clerk role, or verified email listed in
 * ADMIN_EMAILS): the env var is stubbed in beforeEach.
 */
const KHATA_ADMIN = makeIdentity('user_khata_admin', 'khata-admin@example.com', 'Khata Admin', {
  emailVerified:   true,
  public_metadata: { role: 'Admin' },
})

beforeEach(() => {
  fakeAllTimers(NOW)
  vi.stubEnv('ADMIN_EMAILS', 'khata-admin@example.com')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type As = Awaited<ReturnType<typeof signInAndUpsert>>['as']

async function setup(t: TestT, opts: { enabled?: boolean } = {}) {
  const a = await signInAndUpsert(t, IDENTITIES.A)
  if (opts.enabled ?? true) await a.as.mutation(api.settings.update, { khataEnabled: true })
  return a
}

function udhaar(as: As, over: Partial<Parameters<typeof recordSaleArgs>[0]> = {}) {
  return as.mutation(api.khata.recordSale, recordSaleArgs(over))
}

function recordSaleArgs(over: {
  name?: string
  phone?: string
  items?: { productName: string; amount: number; categoryId?: Id<'categories'> }[]
  receivedNow?: number
  sessionDate?: number
  recognition?: 'delivery' | 'cash'
  clientRequestId?: string
} = {}) {
  return {
    customer:    { name: over.name ?? 'Ali', ...(over.phone !== undefined ? { phone: over.phone } : {}) },
    items:       over.items ?? [{ productName: 'Suit', amount: 6000 }],
    sessionDate: over.sessionDate ?? TODAY,
    receivedNow: over.receivedNow ?? 3000,
    ...(over.recognition ? { recognition: over.recognition } : {}),
    ...(over.clientRequestId ? { clientRequestId: over.clientRequestId } : {}),
  }
}

function getEntry(t: TestT, id: Id<'khataEntries'>) {
  return t.run(async (ctx) => (await ctx.db.get('khataEntries', id))!)
}

function salesOfSession(t: TestT, sessionId: Id<'saleSessions'>) {
  return t.run((ctx) =>
    ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).collect(),
  )
}

// ─── Settings ───────────────────────────────────────────────────────────────

describe('settings', () => {
  it('get returns defaults without a row (and before upsert); never writes', async () => {
    const t = makeT()
    const defaults = { khataEnabled: false, advanceRecognition: 'delivery', udhaarRecognition: 'delivery', updatedAt: 0 }
    expect(await signIn(t, IDENTITIES.A).query(api.settings.get, {})).toEqual(defaults)
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await as.query(api.settings.get, {})).toEqual(defaults)
    expect(await count(t, 'shopSettings')).toBe(0)
  })

  it('update upserts; omitted fields keep their value', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.settings.update, { khataEnabled: true })
    await as.mutation(api.settings.update, { udhaarRecognition: 'cash' })
    const settings = await as.query(api.settings.get, {})
    expect(settings).toMatchObject({ khataEnabled: true, advanceRecognition: 'delivery', udhaarRecognition: 'cash' })
    expect(Math.abs(settings.updatedAt - Date.parse(NOW))).toBeLessThan(1000)
    expect(await count(t, 'shopSettings')).toBe(1)
  })

  it('view-as reads the target settings; B cannot', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    await as.mutation(api.settings.update, { advanceRecognition: 'cash' })
    const admin = await signInAndUpsert(t, KHATA_ADMIN)
    expect(await admin.as.query(api.settings.get, { viewAsUserId: userId })).toMatchObject({
      khataEnabled: true, advanceRecognition: 'cash',
    })
    expect(await admin.as.query(api.settings.get, {})).toMatchObject({ khataEnabled: false })
    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await errorData(b.as.query(api.settings.get, { viewAsUserId: userId }))).toMatchObject({ code: 'FORBIDDEN' })
  })
})

// ─── Feature off / no data ──────────────────────────────────────────────────

describe('feature off: invisible', () => {
  it('khata queries return empty / zero for shops without data', async () => {
    const t = makeT()
    const { as } = await setup(t, { enabled: false })
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    expect(await as.query(api.khata.listOpen, { segment: 'due', paginationOpts: { numItems: 10, cursor: null } }))
      .toMatchObject({ page: [], isDone: true })
    expect(await as.query(api.khata.searchCustomers, {})).toEqual([])
    expect(await as.query(api.khata.receivedInRange, { startDate: 0, endDate: TODAY + DAY }))
      .toEqual({ total: 0, count: 0, capped: false })
    expect(await as.query(api.khata.badgesForRange, { startDate: 0, endDate: TODAY + DAY })).toEqual([])
    // Not yet upserted: still empty, never throws.
    const fresh = signIn(t, IDENTITIES.B)
    expect(await fresh.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    expect(await fresh.query(api.khata.searchCustomers, { search: 'a' })).toEqual([])
  })

  it('existing day feed / stats / daily totals are identical with khata tables empty, on/off, or used by another shop', async () => {
    const t = makeT()
    const { as } = await setup(t, { enabled: false })
    const cat = await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50, categoryId: cat }] })
    await as.mutation(api.saleSessions.record, { sessionDate: YESTERDAY, items: [{ productName: 'Bun', amount: 20 }] })
    await as.mutation(api.expenses.record, { amount: 10, expenseDate: TODAY })

    const snapshot = async () => ({
      feed: await as.query(api.saleSessions.getDayFeed, {
        paginationOpts: { numItems: 10, cursor: null }, timeZone: 'Asia/Karachi',
      }),
      stats: await as.query(api.saleSessions.getStats, {
        todayStart: TODAY, todayEnd: TODAY + DAY - 1, weekStart: TODAY - 6 * DAY, weekEnd: TODAY + DAY - 1,
        monthStart: TODAY - 16 * DAY, monthEnd: TODAY + DAY - 1, timeZone: 'Asia/Karachi',
      }),
      daily: await as.query(api.saleSessions.getDailyTotals, {
        startDate: TODAY - 6 * DAY, endDate: TODAY + DAY - 1, timeZone: 'Asia/Karachi',
      }),
      counts: await as.query(api.sales.getCountsByCategory, {}),
    })
    const before = await snapshot()

    // Another shop uses khata heavily.
    const b = await signInAndUpsert(t, IDENTITIES.B)
    await b.as.mutation(api.settings.update, { khataEnabled: true })
    await b.as.mutation(api.khata.recordSale, recordSaleArgs())
    await b.as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 500, receivedAt: TODAY })
    expect(await snapshot()).toEqual(before)

    // Turning khata on and off again changes nothing for existing data.
    await as.mutation(api.settings.update, { khataEnabled: true })
    await as.mutation(api.settings.update, { khataEnabled: false })
    expect(await snapshot()).toEqual(before)
  })
})

// ─── recordSale (Udhaar) ────────────────────────────────────────────────────

describe('khata.recordSale', () => {
  it('delivery (default): full sale on sale day + payment row; status due', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const res = await udhaar(as, { phone: '0300-123 4567' })
    expect(res.remaining).toBe(3000)
    expect(res.sessionId).toBeDefined()
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 6000 })

    const entry = await getEntry(t, res.entryId)
    expect(entry).toMatchObject({
      kind: 'udhaar', status: 'due', recognition: 'delivery', total: 6000, paid: 3000,
      itemLabel: 'Suit', openedAt: TODAY, deliveredAt: TODAY, saleSessionId: res.sessionId,
    })
    expect(entry.items).toBeUndefined()
    const payments = await t.run((ctx) => ctx.db.query('khataPayments').collect())
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ kind: 'payment', amount: 3000, receivedAt: TODAY })
    expect(payments[0]!.saleSessionId).toBeUndefined()
    const links = await t.run((ctx) => ctx.db.query('khataSessionLinks').collect())
    expect(links).toEqual([expect.objectContaining({ role: 'delivery', saleSessionId: res.sessionId, entryId: res.entryId, sessionDate: TODAY })])

    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 3000, dueCount: 1, heldTotal: 0, heldCount: 0 })
    const [customer] = await as.query(api.khata.searchCustomers, {})
    expect(customer).toMatchObject({ name: 'Ali', normalizedName: 'ali', phone: '03001234567', dueTotal: 3000, openCount: 1 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('cash: only the received amount is a sale ("Ali · Udhaar"); items stored on the entry; 0 received → no sale', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const cat = await as.mutation(api.categories.create, { name: 'Cloth', color: '#6366F1' })
    const res = await udhaar(as, {
      recognition: 'cash',
      items: [{ productName: 'Suit', amount: 4000, categoryId: cat }, { productName: 'Lace', amount: 2000, categoryId: cat }],
    })
    expect(res.remaining).toBe(3000)
    const sales = await salesOfSession(t, res.sessionId!)
    expect(sales).toEqual([expect.objectContaining({ productName: 'Ali · Udhaar', amount: 3000, categoryId: cat })])
    expect(await getEntry(t, res.entryId)).toMatchObject({
      recognition: 'cash', categoryId: cat, itemLabel: 'Suit +1',
      items: [{ productName: 'Suit', amount: 4000, categoryId: cat }, { productName: 'Lace', amount: 2000, categoryId: cat }],
    })
    expect((await t.run((ctx) => ctx.db.query('khataSessionLinks').collect()))[0]).toMatchObject({ role: 'payment' })

    const zero = await udhaar(as, { recognition: 'cash', receivedNow: 0, name: 'Bilal' })
    expect(zero.sessionId).toBeUndefined()
    expect(zero.remaining).toBe(6000)
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 3000 })
    expect(await as.query(api.khata.getTotals, {})).toMatchObject({ dueTotal: 9000, dueCount: 2 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('uses the shop setting when recognition is omitted', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    await as.mutation(api.settings.update, { udhaarRecognition: 'cash' })
    const res = await udhaar(as)
    expect((await getEntry(t, res.entryId)).recognition).toBe('cash')
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 3000 })
  })

  it('rejects bad amounts with VALIDATION and writes nothing', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const fully = { code: 'VALIDATION', message: KHATA_MESSAGES.FULLY_PAID }
    expect(await errorData(udhaar(as, { receivedNow: 6000 }))).toEqual(fully)
    expect(await errorData(udhaar(as, { receivedNow: 7000 }))).toEqual(fully)
    expect(await errorData(udhaar(as, { receivedNow: -1 }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { receivedNow: Number.NaN }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { receivedNow: 10.123 }))).toEqual({
      code: 'VALIDATION', message: 'Received amount can have at most 2 decimals',
    })
    expect(await errorData(udhaar(as, { items: [{ productName: 'X', amount: 0 }] }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { items: [{ productName: 'X', amount: 99.999 }] }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { items: [] }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { name: '   ' }))).toEqual({ code: 'VALIDATION', message: 'Customer name is required' })
    expect(await errorData(udhaar(as, { name: 'x'.repeat(41) }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(udhaar(as, { phone: '0300-abc' }))).toEqual({
      code: 'VALIDATION', message: 'Phone number can only have digits and +',
    })
    expect(await errorData(udhaar(as, { sessionDate: Date.parse(NOW) + 3 * DAY }))).toMatchObject({ code: 'VALIDATION' })
    for (const table of ['customers', 'khataEntries', 'khataPayments', 'saleSessions', 'khataTotals'] as const) {
      expect(await count(t, table)).toBe(0)
    }
  })

  it('2-decimal amounts are compared in paisa', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const res = await udhaar(as, { items: [{ productName: 'a', amount: 0.1 }, { productName: 'b', amount: 0.2 }], receivedNow: 0.29 })
    expect(res.remaining).toBe(0.01)
    expect(await errorData(udhaar(as, { items: [{ productName: 'a', amount: 0.1 }, { productName: 'b', amount: 0.2 }], receivedNow: 0.3 })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.FULLY_PAID })
  })

  it('find-or-create by exact normalized name; phone added only when missing', async () => {
    const t = makeT()
    const { as } = await setup(t)
    await udhaar(as, { name: '  Ali   Khan ' })
    await udhaar(as, { name: 'ali khan', phone: '+923001234567' })
    await udhaar(as, { name: 'ALI KHAN', phone: '0311' })
    await udhaar(as, { name: 'Ali Raza' })
    const customers = await t.run((ctx) => ctx.db.query('customers').collect())
    expect(customers).toHaveLength(2)
    expect(customers.find((c) => c.normalizedName === 'ali khan')).toMatchObject({
      name: 'Ali Khan', phone: '+923001234567', openCount: 3, dueTotal: 9000,
    })
  })

  it("another user's customer / category is NOT_FOUND", async () => {
    const t = makeT()
    const a = await setup(t)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    await udhaar(a.as)
    const [aliId] = (await a.as.query(api.khata.searchCustomers, {})).map((c) => c._id)
    const aCat = await a.as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    expect(await errorData(b.as.mutation(api.khata.recordSale, { ...recordSaleArgs(), customer: { id: aliId! } })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.CUSTOMER_NOT_FOUND })
    expect(await errorData(b.as.mutation(api.khata.recordSale, recordSaleArgs({ items: [{ productName: 'x', amount: 10, categoryId: aCat }], receivedNow: 1 }))))
      .toMatchObject({ code: 'NOT_FOUND' })
    expect(await count(t, 'khataEntries')).toBe(1)
  })
})

// ─── Advances ───────────────────────────────────────────────────────────────

describe('advances', () => {
  it('openAdvance (delivery): payment only, held; payments while booked; overpay vs total', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await as.mutation(api.khata.openAdvance, {
      customer: { name: 'Sara' }, amount: 5000, receivedAt: TODAY, total: 11000, itemLabel: 'Wedding dress',
      dueDate: TODAY + 30 * DAY, note: 'red',
    })
    expect(await salesByDay(t, userId)).toEqual({})
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 5000, heldCount: 1 })

    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 2000, receivedAt: TODAY }))
      .toMatchObject({ remaining: 4000, status: 'booked' })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 4000.01, receivedAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: 'More than Baqi (PKR 4,000)' })
    expect(await as.query(api.khata.getTotals, {})).toMatchObject({ heldTotal: 7000, heldCount: 1 })
    await expectKhataConsistent(t, userId)
  })

  it('advance without total: uncapped payments, remaining null', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const { entryId } = await as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 100, receivedAt: TODAY })
    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 1_000_000, receivedAt: TODAY }))
      .toMatchObject({ remaining: null, status: 'booked' })
  })

  it('openAdvance validation', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const base = { customer: { name: 'Sara' }, amount: 5000, receivedAt: TODAY }
    expect(await errorData(as.mutation(api.khata.openAdvance, { ...base, total: 4000 })))
      .toEqual({ code: 'VALIDATION', message: "Advance can't be more than the total (PKR 4,000)" })
    expect(await errorData(as.mutation(api.khata.openAdvance, { ...base, amount: 0 }))).toMatchObject({ code: 'VALIDATION' })
    expect(await errorData(as.mutation(api.khata.openAdvance, { ...base, dueDate: Date.parse(NOW) + 3 * 366 * DAY })))
      .toEqual({ code: 'VALIDATION', message: 'Due date can be at most 2 years ahead' })
    expect(await errorData(as.mutation(api.khata.openAdvance, { ...base, receivedAt: Date.parse(NOW) + 2 * DAY })))
      .toMatchObject({ code: 'VALIDATION' })
    expect(await count(t, 'khataEntries')).toBe(0)
    await as.mutation(api.khata.openAdvance, { ...base, dueDate: Date.parse(NOW) + 700 * DAY })
  })

  it('completeAdvance (delivery): one sale of the final bill on handover day', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await as.mutation(api.khata.openAdvance, {
      customer: { name: 'Sara' }, amount: 5000, receivedAt: YESTERDAY, itemLabel: 'Dress',
    })
    expect(await errorData(as.mutation(api.khata.completeAdvance, { entryId, finalTotal: 4000, receivedNow: 0, deliveredAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.BILL_BELOW_ADVANCE })
    expect(await errorData(as.mutation(api.khata.completeAdvance, { entryId, finalTotal: 11000, receivedNow: 7000, deliveredAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: 'More than Baqi (PKR 6,000)' })

    const res = await as.mutation(api.khata.completeAdvance, { entryId, finalTotal: 11000, receivedNow: 4000, deliveredAt: TODAY })
    expect(res).toMatchObject({ status: 'due', remaining: 2000 })
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 11000 })
    expect((await salesOfSession(t, res.sessionId!))[0]).toMatchObject({ productName: 'Dress', amount: 11000 })
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 2000, dueCount: 1, heldTotal: 0, heldCount: 0 })

    expect(await errorData(as.mutation(api.khata.completeAdvance, { entryId, finalTotal: 11000, receivedNow: 0, deliveredAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.NOT_BOOKED })
    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 2000, receivedAt: TODAY }))
      .toMatchObject({ remaining: 0, status: 'settled' })
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 11000 })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.ALREADY_PAID })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('completeAdvance (cash): advance and handover payments are the sales; fully paid → settled', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await as.mutation(api.khata.openAdvance, {
      customer: { name: 'Sara' }, amount: 5000, receivedAt: YESTERDAY, recognition: 'cash',
    })
    expect(await salesByDay(t, userId)).toEqual({ [YESTERDAY_KEY]: 5000 })
    const res = await as.mutation(api.khata.completeAdvance, { entryId, finalTotal: 11000, receivedNow: 6000, deliveredAt: TODAY })
    expect(res).toMatchObject({ status: 'settled', remaining: 0 })
    expect(await salesByDay(t, userId)).toEqual({ [YESTERDAY_KEY]: 5000, [TODAY_KEY]: 6000 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('cancelAdvance: refund / keep in both modes', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const open = (name: string, recognition: 'delivery' | 'cash') =>
      as.mutation(api.khata.openAdvance, { customer: { name }, amount: 1000, receivedAt: YESTERDAY, recognition })

    const dRefund = await open('A1', 'delivery')
    await as.mutation(api.khata.cancelAdvance, { entryId: dRefund.entryId, refund: true, at: TODAY })
    expect(await getEntry(t, dRefund.entryId)).toMatchObject({ status: 'cancelled', refunded: 1000 })
    expect(await salesByDay(t, userId)).toEqual({})
    expect(await expensesTotal(t, userId)).toBe(0)

    const cRefund = await open('A2', 'cash')
    await as.mutation(api.khata.cancelAdvance, { entryId: cRefund.entryId, refund: true, at: TODAY })
    expect(await salesByDay(t, userId)).toEqual({ [YESTERDAY_KEY]: 1000 })
    const expenses = await t.run((ctx) => ctx.db.query('expenses').collect())
    expect(expenses).toEqual([expect.objectContaining({ amount: 1000, note: 'Advance refund · A2', expenseDate: TODAY })])

    const dKeep = await open('A3', 'delivery')
    await as.mutation(api.khata.cancelAdvance, { entryId: dKeep.entryId, refund: false, at: TODAY })
    expect(await salesByDay(t, userId)).toEqual({ [YESTERDAY_KEY]: 1000, [TODAY_KEY]: 1000 })
    const kept = await getEntry(t, dKeep.entryId)
    expect((await salesOfSession(t, kept.saleSessionId!))[0]).toMatchObject({ productName: 'Advance kept · A3', amount: 1000 })

    const cKeep = await open('A4', 'cash')
    await as.mutation(api.khata.cancelAdvance, { entryId: cKeep.entryId, refund: false, at: TODAY })
    expect(await salesByDay(t, userId)).toEqual({ [YESTERDAY_KEY]: 2000, [TODAY_KEY]: 1000 })

    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    expect(await errorData(as.mutation(api.khata.cancelAdvance, { entryId: cKeep.entryId, refund: true, at: TODAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.NOT_BOOKED })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId: cKeep.entryId, amount: 5, receivedAt: TODAY })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.ENTRY_CANCELLED })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })
})

// ─── Payments, dates, caps ──────────────────────────────────────────────────

describe('receivePayment', () => {
  it('settles at 0, rejects overpay with the remaining, 0 / NaN / 3 decimals', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as)
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 3000.5, receivedAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: 'More than Baqi (PKR 3,000)' })
    for (const amount of [0, -5, Number.NaN, 1.005]) {
      expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount, receivedAt: TODAY })))
        .toMatchObject({ code: 'VALIDATION' })
    }
    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 1000.25, receivedAt: TODAY }))
      .toMatchObject({ remaining: 1999.75, status: 'due' })
    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 1999.75, receivedAt: TODAY }))
      .toMatchObject({ remaining: 0, status: 'settled' })
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    await expectKhataConsistent(t, userId)
  })

  it('past dates OK on/after the opening day; before it rejected; future via the 36h rule', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const { entryId } = await udhaar(as, { sessionDate: YESTERDAY - DAY })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: YESTERDAY - DAY - 1 })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.BEFORE_OPENED })
    await as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: YESTERDAY - DAY + 5 * 60 * 60 * 1000 })
    await as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: YESTERDAY })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: Date.parse(NOW) + 2 * DAY })))
      .toMatchObject({ code: 'VALIDATION' })
  })

  it(`at most ${MAX_KHATA_PAYMENTS_PER_ENTRY} payments per entry`, async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as, { items: [{ productName: 'x', amount: 1000 }], receivedNow: 0 })
    const entry = await getEntry(t, entryId)
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_KHATA_PAYMENTS_PER_ENTRY; i++) {
        await ctx.db.insert('khataPayments', {
          userId, entryId, customerId: entry.customerId, kind: 'payment', amount: 1, receivedAt: TODAY, createdAt: 0,
        })
      }
      await ctx.db.patch('khataEntries', entryId, { paid: MAX_KHATA_PAYMENTS_PER_ENTRY })
    })
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: TODAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.TOO_MANY_PAYMENTS })
  })

  it('concurrent payments cannot overpay (OCC on the entry)', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as)
    const results = await Promise.allSettled([
      as.mutation(api.khata.receivePayment, { entryId, amount: 2000, receivedAt: TODAY }),
      as.mutation(api.khata.receivePayment, { entryId, amount: 2000, receivedAt: TODAY }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((rejected.reason as { data: unknown }).data).toEqual({ code: 'VALIDATION', message: 'More than Baqi (PKR 1,000)' })
    expect((await getEntry(t, entryId)).paid).toBe(5000)
    await expectKhataConsistent(t, userId)
  })
})

describe('forgive / update / remove', () => {
  it('forgiveRemaining: due → settled, sales untouched', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as)
    expect(await as.mutation(api.khata.forgiveRemaining, { entryId })).toEqual({ forgiven: 3000 })
    expect(await getEntry(t, entryId)).toMatchObject({ status: 'settled', forgiven: 3000 })
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 6000 })
    expect(await errorData(as.mutation(api.khata.forgiveRemaining, { entryId })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.NOT_DUE })
    const adv = await as.mutation(api.khata.openAdvance, { customer: { name: 'S' }, amount: 1, receivedAt: TODAY })
    expect(await errorData(as.mutation(api.khata.forgiveRemaining, { entryId: adv.entryId })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.NOT_DUE })
    await expectKhataConsistent(t, userId)
  })

  it('updateEntry: single-item delivery sale follows the total; multi-item refused; floors', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const single = await udhaar(as)
    await as.mutation(api.khata.updateEntry, { entryId: single.entryId, total: 8000, itemLabel: 'Suit (2pc)', note: 'n' })
    expect(await salesOfSession(t, single.sessionId!)).toEqual([
      expect.objectContaining({ amount: 8000, productName: 'Suit (2pc)' }),
    ])
    expect(await getEntry(t, single.entryId)).toMatchObject({ total: 8000, status: 'due', note: 'n' })
    expect(await errorData(as.mutation(api.khata.updateEntry, { entryId: single.entryId, total: 2999 })))
      .toEqual({ code: 'VALIDATION', message: "Bill can't be less than paid (PKR 3,000)" })
    await as.mutation(api.khata.updateEntry, { entryId: single.entryId, total: 3000 })
    expect(await getEntry(t, single.entryId)).toMatchObject({ status: 'settled' })
    await as.mutation(api.khata.updateEntry, { entryId: single.entryId, total: 3500 })
    expect(await getEntry(t, single.entryId)).toMatchObject({ status: 'due', total: 3500 })

    const multi = await udhaar(as, { name: 'B', items: [{ productName: 'a', amount: 100 }, { productName: 'b', amount: 200 }], receivedNow: 0 })
    expect(await errorData(as.mutation(api.khata.updateEntry, { entryId: multi.entryId, total: 500 })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.EDIT_ITEMS_IN_SALE })
    await as.mutation(api.khata.updateEntry, { entryId: multi.entryId, itemLabel: 'Two things' })

    const adv = await as.mutation(api.khata.openAdvance, {
      customer: { name: 'S' }, amount: 500, receivedAt: TODAY, dueDate: TODAY + DAY,
    })
    expect(await errorData(as.mutation(api.khata.updateEntry, { entryId: adv.entryId, total: 400 })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.BILL_BELOW_ADVANCE })
    await as.mutation(api.khata.updateEntry, { entryId: adv.entryId, total: 900, dueDate: null })
    const advEntry = await getEntry(t, adv.entryId)
    expect(advEntry.total).toBe(900)
    expect(advEntry.dueDate).toBeUndefined()
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('removePayment: cash session removed; settled → due', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as, { recognition: 'cash' })
    const pay = await as.mutation(api.khata.receivePayment, { entryId, amount: 3000, receivedAt: TODAY })
    expect(pay.status).toBe('settled')
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 6000 })
    await as.mutation(api.khata.removePayment, { paymentId: pay.paymentId })
    expect(await getEntry(t, entryId)).toMatchObject({ status: 'due', paid: 3000 })
    expect(await salesByDay(t, userId)).toEqual({ [TODAY_KEY]: 3000 })
    expect(await count(t, 'khataSessionLinks')).toBe(1)
    expect(await errorData(as.mutation(api.khata.removePayment, { paymentId: pay.paymentId })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.PAYMENT_NOT_FOUND })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('removeEntry: deletes payments, sessions, links, refund expense; balances back to 0', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const keepSale = await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }] })
    const d = await udhaar(as)
    await as.mutation(api.khata.receivePayment, { entryId: d.entryId, amount: 1000, receivedAt: TODAY })
    const c = await udhaar(as, { name: 'C', recognition: 'cash' })
    await as.mutation(api.khata.receivePayment, { entryId: c.entryId, amount: 1000, receivedAt: TODAY })
    const adv = await as.mutation(api.khata.openAdvance, { customer: { name: 'S' }, amount: 700, receivedAt: TODAY, recognition: 'cash' })
    await as.mutation(api.khata.cancelAdvance, { entryId: adv.entryId, refund: true, at: TODAY })

    for (const entryId of [d.entryId, c.entryId, adv.entryId]) await as.mutation(api.khata.removeEntry, { entryId })
    for (const table of ['khataEntries', 'khataPayments', 'khataSessionLinks', 'expenses'] as const) {
      expect(await count(t, table)).toBe(0)
    }
    const sessions = await t.run((ctx) => ctx.db.query('saleSessions').collect())
    expect(sessions.map((s) => s._id)).toEqual([keepSale.sessionId])
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })
})

// ─── Customers ──────────────────────────────────────────────────────────────

describe('customers', () => {
  it('archive is blocked while open; archived hidden from search; reuse un-archives', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const { entryId } = await udhaar(as)
    const [ali] = await as.query(api.khata.searchCustomers, {})
    expect(await errorData(as.mutation(api.khata.archiveCustomer, { customerId: ali!._id })))
      .toEqual({ code: 'VALIDATION', message: 'Ali still has Baqi PKR 3,000' })
    const adv = await as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 1500, receivedAt: TODAY })
    const sara = (await as.query(api.khata.searchCustomers, { search: 'sa' }))[0]!
    expect(await errorData(as.mutation(api.khata.archiveCustomer, { customerId: sara._id })))
      .toEqual({ code: 'VALIDATION', message: 'Sara still has an advance of PKR 1,500' })
    await as.mutation(api.khata.cancelAdvance, { entryId: adv.entryId, refund: true, at: TODAY })

    await as.mutation(api.khata.forgiveRemaining, { entryId })
    await as.mutation(api.khata.archiveCustomer, { customerId: ali!._id })
    expect((await as.query(api.khata.searchCustomers, {})).map((c) => c.name)).toEqual(['Sara'])
    expect(await as.query(api.khata.searchCustomers, { search: 'ali' })).toEqual([])
    await udhaar(as, { name: 'ali' })
    expect((await as.query(api.khata.searchCustomers, { search: 'ali' })).map((c) => c.name)).toEqual(['Ali'])
  })

  it('updateCustomer: rename, collision refused, phone change / clear', async () => {
    const t = makeT()
    const { as } = await setup(t)
    await udhaar(as, { phone: '0300' })
    await udhaar(as, { name: 'Bilal' })
    const ali = (await as.query(api.khata.searchCustomers, { search: 'ali' }))[0]!
    expect(await errorData(as.mutation(api.khata.updateCustomer, { customerId: ali._id, name: ' BILAL ' })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.CUSTOMER_EXISTS })
    await as.mutation(api.khata.updateCustomer, { customerId: ali._id, name: 'Ali  Khan', phone: '+92 300 1' })
    expect((await as.query(api.khata.searchCustomers, { search: 'ali k' }))[0]).toMatchObject({
      name: 'Ali Khan', normalizedName: 'ali khan', phone: '+923001',
    })
    await as.mutation(api.khata.updateCustomer, { customerId: ali._id, phone: '' })
    expect((await as.query(api.khata.searchCustomers, { search: 'ali' }))[0]!.phone).toBeUndefined()
  })

  it('searchCustomers: prefix, recent first, limit ≤ 20', async () => {
    const t = makeT()
    const { as } = await setup(t)
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(Date.parse(NOW) + i * 1000)
      await udhaar(as, { name: `Cust ${String(i).padStart(2, '0')}`, items: [{ productName: 'x', amount: 10 }], receivedNow: 0 })
    }
    const recent = await as.query(api.khata.searchCustomers, { limit: 100 })
    expect(recent).toHaveLength(20)
    expect(recent[0]!.name).toBe('Cust 24')
    expect((await as.query(api.khata.searchCustomers, { search: 'cust 1', limit: 3 })).map((c) => c.name))
      .toEqual(['Cust 10', 'Cust 11', 'Cust 12'])
  })

  it('customerDetail: entries + payments; deleted category hidden lazily; other user → null', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const cat = await as.mutation(api.categories.create, { name: 'Cloth', color: '#6366F1' })
    const { entryId } = await udhaar(as, { recognition: 'cash', items: [{ productName: 'Suit', amount: 6000, categoryId: cat }] })
    await as.mutation(api.khata.receivePayment, { entryId, amount: 500, receivedAt: TODAY })
    const ali = (await as.query(api.khata.searchCustomers, {}))[0]!
    let detail = await as.query(api.khata.customerDetail, { customerId: ali._id })
    expect(detail!.entries).toHaveLength(1)
    expect(detail!.entries[0]).toMatchObject({ remaining: 2500, categoryId: cat, paymentsCapped: false })
    expect(detail!.entries[0]!.payments.map((p) => p.amount).sort()).toEqual([3000, 500].sort())

    await as.mutation(api.categories.remove, { categoryId: cat })
    detail = await as.query(api.khata.customerDetail, { customerId: ali._id })
    expect(detail!.entries[0]!.categoryId).toBeUndefined()

    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await b.as.query(api.khata.customerDetail, { customerId: ali._id })).toBeNull()
  })

  it('listOpen, receivedInRange, badgesForRange', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const d = await udhaar(as, { phone: '03001234567' })
    const c = await udhaar(as, { name: 'Cash', recognition: 'cash', sessionDate: YESTERDAY })
    const adv = await as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 700, receivedAt: TODAY })
    await as.mutation(api.khata.cancelAdvance, {
      entryId: (await as.mutation(api.khata.openAdvance, { customer: { name: 'Gone' }, amount: 50, receivedAt: TODAY })).entryId,
      refund: true, at: TODAY,
    })

    const due = await as.query(api.khata.listOpen, { segment: 'due', paginationOpts: { numItems: 10, cursor: null } })
    expect(due.page.map((r) => [r.customerName, r.remaining, r.customerPhone])).toEqual([
      ['Ali', 3000, '03001234567'], ['Cash', 3000, undefined],
    ])
    const booked = await as.query(api.khata.listOpen, { segment: 'booked', paginationOpts: { numItems: 10, cursor: null } })
    expect(booked.page.map((r) => [r._id, r.remaining])).toEqual([[adv.entryId, null]])

    expect(await as.query(api.khata.receivedInRange, { startDate: TODAY, endDate: TODAY + DAY - 1 }))
      .toEqual({ total: 3000 + 700 + 50, count: 3, capped: false })
    expect(await as.query(api.khata.receivedInRange, { startDate: YESTERDAY, endDate: TODAY + DAY - 1 }))
      .toEqual({ total: 6750, count: 4, capped: false })

    const badges = await as.query(api.khata.badgesForRange, { startDate: YESTERDAY, endDate: TODAY + DAY - 1 })
    expect(badges.map((b) => [b.saleSessionId, b.role, b.entryId, b.kind, b.remaining, b.customerName]).sort()).toEqual([
      [d.sessionId, 'delivery', d.entryId, 'udhaar', 3000, 'Ali'],
      [c.sessionId, 'payment', c.entryId, 'udhaar', 3000, 'Cash'],
    ].sort())
  })
})

// ─── Sale edit locks ────────────────────────────────────────────────────────

describe('sale-edit locks', () => {
  async function itemOf(t: TestT, sessionId: Id<'saleSessions'>) {
    return (await salesOfSession(t, sessionId))[0]!
  }

  it('payment link blocks every edit (message depends on the setting)', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { sessionId } = await udhaar(as, { recognition: 'cash' })
    const sale = await itemOf(t, sessionId!)
    const lock = { code: 'VALIDATION', message: KHATA_MESSAGES.PAYMENT_LOCK }
    const edit = (patch: Partial<{ productName: string; amount: number; saleDate: number; note: string }>) =>
      as.mutation(api.sales.updateItem, { saleId: sale._id, productName: sale.productName, amount: sale.amount, ...patch })
    expect(await errorData(edit({ amount: 10 }))).toEqual(lock)
    expect(await errorData(edit({ productName: 'Renamed' }))).toEqual(lock)
    expect(await errorData(edit({ note: 'x' }))).toEqual(lock)
    expect(await errorData(edit({ saleDate: YESTERDAY }))).toEqual(lock)
    expect(await errorData(as.mutation(api.sales.removeItem, { saleId: sale._id }))).toEqual(lock)

    await as.mutation(api.settings.update, { khataEnabled: false })
    expect(await errorData(edit({ amount: 10 }))).toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.KHATA_OFF_LOCK })
    expect(await errorData(as.mutation(api.sales.removeItem, { saleId: sale._id })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.KHATA_OFF_LOCK })
    expect(await itemOf(t, sessionId!)).toMatchObject({ amount: 3000, productName: 'Ali · Udhaar' })
    await expectTotalsMatchSource(t, userId)
  })

  it('delivery link: date change and last-item delete blocked; amount synced; below paid rejected', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const cat = await as.mutation(api.categories.create, { name: 'Cloth', color: '#6366F1' })
    const res = await udhaar(as, { items: [{ productName: 'Suit', amount: 4000 }, { productName: 'Lace', amount: 2000 }] })
    const [suit, lace] = (await salesOfSession(t, res.sessionId!)).sort((a, b) => b.amount - a.amount)
    const lock = { code: 'VALIDATION', message: KHATA_MESSAGES.DELIVERY_LOCK }
    const base = (s: typeof suit) => ({ saleId: s!._id, productName: s!.productName, amount: s!.amount })

    expect(await errorData(as.mutation(api.sales.updateItem, { ...base(suit), saleDate: YESTERDAY }))).toEqual(lock)

    // name / category / note allowed, total unchanged
    await as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', categoryId: cat, note: 'blue' })
    expect(await getEntry(t, res.entryId)).toMatchObject({ total: 6000, status: 'due' })

    // amount → entry.total follows
    await as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', categoryId: cat, amount: 5000 })
    expect(await getEntry(t, res.entryId)).toMatchObject({ total: 7000, paid: 3000 })
    expect(await as.query(api.khata.getTotals, {})).toMatchObject({ dueTotal: 4000 })

    // below paid → rejected, nothing changed
    expect(await errorData(as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', categoryId: cat, amount: 500 })))
      .toEqual({ code: 'VALIDATION', message: "Bill can't be less than paid (PKR 3,000)" })
    expect((await salesOfSession(t, res.sessionId!)).find((s) => s._id === suit!._id)!.amount).toBe(5000)

    // removing one of two items allowed (synced); the last one is blocked
    await as.mutation(api.sales.removeItem, { saleId: lace!._id })
    expect(await getEntry(t, res.entryId)).toMatchObject({ total: 5000 })
    expect(await errorData(as.mutation(api.sales.removeItem, { saleId: suit!._id }))).toEqual(lock)

    // exactly paid → settled; back up → due
    await as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', categoryId: cat, amount: 3000 })
    expect(await getEntry(t, res.entryId)).toMatchObject({ total: 3000, status: 'settled' })
    await as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', categoryId: cat, amount: 3100 })
    expect(await getEntry(t, res.entryId)).toMatchObject({ total: 3100, status: 'due' })

    await as.mutation(api.settings.update, { khataEnabled: false })
    expect(await errorData(as.mutation(api.sales.updateItem, { ...base(suit), productName: 'Suit 3pc', saleDate: YESTERDAY })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.KHATA_OFF_LOCK })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('"Advance kept" session: amount change blocked too', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const { entryId } = await as.mutation(api.khata.openAdvance, { customer: { name: 'S' }, amount: 900, receivedAt: TODAY })
    await as.mutation(api.khata.cancelAdvance, { entryId, refund: false, at: TODAY })
    const sale = await itemOf(t, (await getEntry(t, entryId)).saleSessionId!)
    expect(await errorData(as.mutation(api.sales.updateItem, { saleId: sale._id, productName: sale.productName, amount: 100 })))
      .toEqual({ code: 'VALIDATION', message: KHATA_MESSAGES.DELIVERY_LOCK })
    await as.mutation(api.sales.updateItem, { saleId: sale._id, productName: 'Kept', amount: 900 })
  })

  it('moving a normal sale to a day with a khata session never merges into it', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const k = await udhaar(as, { sessionDate: YESTERDAY })
    const normal = await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }] })
    const tea = await itemOf(t, normal.sessionId)
    await as.mutation(api.sales.updateItem, { saleId: tea._id, productName: 'Tea', amount: 50, saleDate: YESTERDAY })
    const khataSession = await t.run((ctx) => ctx.db.get('saleSessions', k.sessionId!))
    expect(khataSession).toMatchObject({ totalAmount: 6000, itemCount: 1 })
    const moved = await t.run((ctx) => ctx.db.get('sales', tea._id))
    expect(moved!.sessionId).not.toBe(k.sessionId)
    expect(await count(t, 'saleSessions')).toBe(2)
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('normal sales stay fully editable (guard is a no-op)', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    await udhaar(as)
    const s = await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 50 }] })
    const tea = await itemOf(t, s.sessionId)
    await as.mutation(api.sales.updateItem, { saleId: tea._id, productName: 'Chai', amount: 60, saleDate: YESTERDAY })
    const moved = await t.run((ctx) => ctx.db.get('sales', tea._id))
    await as.mutation(api.sales.removeItem, { saleId: moved!._id })
    await expectTotalsMatchSource(t, userId)
  })
})

// ─── Idempotency ────────────────────────────────────────────────────────────

describe('idempotent khata creates', () => {
  it('recordSale replay: same result, one entry / session / payment, aggregates once', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const args = recordSaleArgs({ clientRequestId: RID })
    const first = await as.mutation(api.khata.recordSale, args)
    const second = await as.mutation(api.khata.recordSale, { ...args, receivedNow: 1 })
    expect(second).toEqual(first)
    const [r1, r2] = await Promise.all([
      as.mutation(api.khata.recordSale, args), as.mutation(api.khata.recordSale, args),
    ])
    expect(r1).toEqual(first)
    expect(r2).toEqual(first)
    for (const [table, n] of [['khataEntries', 1], ['saleSessions', 1], ['khataPayments', 1], ['clientRequests', 1], ['customers', 1]] as const) {
      expect(await count(t, table)).toBe(n)
    }
    expect(await as.query(api.khata.getTotals, {})).toMatchObject({ dueTotal: 3000, dueCount: 1 })
    const [row] = await t.run((ctx) => ctx.db.query('clientRequests').collect())
    expect(row).toMatchObject({ kind: 'khataSale', khataEntryId: first.entryId, sessionId: first.sessionId, khataRemaining: 3000 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('cash recordSale with receivedNow 0 replays without a sessionId', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const args = recordSaleArgs({ clientRequestId: RID, recognition: 'cash', receivedNow: 0 })
    const first = await as.mutation(api.khata.recordSale, args)
    expect(first.sessionId).toBeUndefined()
    expect(await as.mutation(api.khata.recordSale, args)).toEqual(first)
  })

  it('openAdvance and receivePayment replay; stored result even after later changes', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const advArgs = { customer: { name: 'Sara' }, amount: 1000, receivedAt: TODAY, total: 5000, recognition: 'cash' as const, clientRequestId: RID }
    const adv = await as.mutation(api.khata.openAdvance, advArgs)
    expect(await as.mutation(api.khata.openAdvance, advArgs)).toEqual(adv)

    const payArgs = { entryId: adv.entryId, amount: 500, receivedAt: TODAY, clientRequestId: RID2 }
    const pay = await as.mutation(api.khata.receivePayment, payArgs)
    expect(pay).toMatchObject({ remaining: 3500, status: 'booked' })
    await as.mutation(api.khata.receivePayment, { entryId: adv.entryId, amount: 100, receivedAt: TODAY })
    expect(await as.mutation(api.khata.receivePayment, payArgs)).toEqual(pay)

    expect(await count(t, 'khataPayments')).toBe(3)
    expect(await count(t, 'saleSessions')).toBe(3)
    expect(await count(t, 'clientRequests')).toBe(2)
    expect(await as.query(api.khata.getTotals, {})).toMatchObject({ heldTotal: 1600, heldCount: 1 })

    // removed entry: replay does not recreate it
    await as.mutation(api.khata.removeEntry, { entryId: adv.entryId })
    expect(await as.mutation(api.khata.openAdvance, advArgs)).toEqual(adv)
    expect(await as.mutation(api.khata.receivePayment, payArgs)).toEqual(pay)
    expect(await count(t, 'khataEntries')).toBe(0)
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })

  it('cross-kind reuse is VALIDATION and writes nothing (incl. sale / expense ids)', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const sale = await udhaar(as, { clientRequestId: RID })
    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 5 }], clientRequestId: RID2 })
    await as.mutation(api.expenses.record, { amount: 5, expenseDate: TODAY, clientRequestId: RID3 })
    const before = {
      entries: await count(t, 'khataEntries'), sessions: await count(t, 'saleSessions'),
      payments: await count(t, 'khataPayments'), ledger: await count(t, 'clientRequests'),
    }
    const msg = { code: 'VALIDATION', message: 'clientRequestId was already used for a different entry' }
    for (const id of [RID, RID2, RID3]) {
      if (id !== RID) expect(await errorData(udhaar(as, { clientRequestId: id }))).toEqual(msg)
      expect(await errorData(as.mutation(api.khata.openAdvance, { customer: { name: 'S' }, amount: 1, receivedAt: TODAY, clientRequestId: id })))
        .toEqual(msg)
      expect(await errorData(as.mutation(api.khata.receivePayment, { entryId: sale.entryId, amount: 1, receivedAt: TODAY, clientRequestId: id })))
        .toEqual(msg)
    }
    expect(await errorData(as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'T', amount: 5 }], clientRequestId: RID })))
      .toEqual(msg)
    expect(await errorData(as.mutation(api.expenses.record, { amount: 5, expenseDate: TODAY, clientRequestId: RID }))).toEqual(msg)
    expect({
      entries: await count(t, 'khataEntries'), sessions: await count(t, 'saleSessions'),
      payments: await count(t, 'khataPayments'), ledger: await count(t, 'clientRequests'),
    }).toEqual(before)
  })

  it('a failed first attempt leaves no ledger row; the retry applies', async () => {
    const t = makeT()
    const { as } = await setup(t)
    const { entryId } = await udhaar(as)
    expect(await errorData(as.mutation(api.khata.receivePayment, { entryId, amount: 9999, receivedAt: TODAY, clientRequestId: RID })))
      .toMatchObject({ code: 'VALIDATION' })
    expect(await count(t, 'clientRequests')).toBe(0)
    expect(await as.mutation(api.khata.receivePayment, { entryId, amount: 3000, receivedAt: TODAY, clientRequestId: RID }))
      .toMatchObject({ remaining: 0, status: 'settled' })
    expect(await count(t, 'clientRequests')).toBe(1)
  })

  it('rejects a malformed clientRequestId before any write', async () => {
    const t = makeT()
    const { as } = await setup(t)
    expect(await errorData(udhaar(as, { clientRequestId: 'short' })))
      .toEqual({ code: 'VALIDATION', message: 'clientRequestId is not valid' })
    expect(await count(t, 'customers')).toBe(0)
  })
})

// ─── View-as ────────────────────────────────────────────────────────────────

describe('view-as is read-only', () => {
  it('admin reads khata queries of the target; mutations act only on own data', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as)
    const ali = (await as.query(api.khata.searchCustomers, {}))[0]!
    const admin = await signInAndUpsert(t, KHATA_ADMIN)
    const viewAsUserId = userId

    expect(await admin.as.query(api.khata.getTotals, { viewAsUserId })).toMatchObject({ dueTotal: 3000 })
    expect((await admin.as.query(api.khata.listOpen, { viewAsUserId, segment: 'due', paginationOpts: { numItems: 5, cursor: null } })).page)
      .toHaveLength(1)
    expect(await admin.as.query(api.khata.customerDetail, { viewAsUserId, customerId: ali._id })).not.toBeNull()
    expect(await admin.as.query(api.khata.searchCustomers, { viewAsUserId })).toHaveLength(1)
    expect(await admin.as.query(api.khata.badgesForRange, { viewAsUserId, startDate: TODAY, endDate: TODAY })).toHaveLength(1)
    expect(await admin.as.query(api.khata.receivedInRange, { viewAsUserId, startDate: TODAY, endDate: TODAY }))
      .toMatchObject({ total: 3000 })
    // Admin's own (empty) khata without view-as.
    expect(await admin.as.query(api.khata.getTotals, {})).toMatchObject({ dueTotal: 0 })

    // Mutations have no viewAsUserId and the target's ids are NOT_FOUND for the admin.
    await expect(admin.as.mutation(api.khata.receivePayment, {
      entryId, amount: 1, receivedAt: TODAY, viewAsUserId,
    } as never)).rejects.toThrow()
    expect(await errorData(admin.as.mutation(api.khata.receivePayment, { entryId, amount: 1, receivedAt: TODAY })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.ENTRY_NOT_FOUND })
    expect(await errorData(admin.as.mutation(api.khata.archiveCustomer, { customerId: ali._id })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.CUSTOMER_NOT_FOUND })
    expect((await getEntry(t, entryId)).paid).toBe(3000)

    const b = await signInAndUpsert(t, IDENTITIES.B)
    expect(await errorData(b.as.query(api.khata.getTotals, { viewAsUserId }))).toMatchObject({ code: 'FORBIDDEN' })
    expect(await errorData(b.as.mutation(api.khata.removeEntry, { entryId })))
      .toEqual({ code: 'NOT_FOUND', message: KHATA_MESSAGES.ENTRY_NOT_FOUND })
  })
})

// ─── Repair ─────────────────────────────────────────────────────────────────

describe('khata:verifyUser / rebuildUser', () => {
  it('detects and repairs drift in entries, customers and khataTotals', async () => {
    const t = makeT()
    const { as, userId } = await setup(t)
    const { entryId } = await udhaar(as)
    await as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 400, receivedAt: TODAY })
    await expectKhataConsistent(t, userId)

    await t.run(async (ctx) => {
      await ctx.db.patch('khataEntries', entryId, { paid: 1 })
      const c = await ctx.db.query('customers').first()
      await ctx.db.patch('customers', c!._id, { dueTotal: 42, openCount: 9 })
      const row = await ctx.db.query('khataTotals').first()
      await ctx.db.patch('khataTotals', row!._id, { heldTotal: 0 })
    })
    const bad = await t.query(internal.khata.verifyUser, { userId })
    expect(bad.ok).toBe(false)
    expect(bad.mismatches.length).toBeGreaterThanOrEqual(3)

    const fixed = await t.mutation(internal.khata.rebuildUser, { userId })
    expect(fixed).toMatchObject({ entriesFixed: 1, totalsFixed: true, capped: false })
    expect(fixed.customersFixed).toBeGreaterThanOrEqual(1)
    await expectKhataConsistent(t, userId)
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 3000, dueCount: 1, heldTotal: 400, heldCount: 1 })
  })
})
