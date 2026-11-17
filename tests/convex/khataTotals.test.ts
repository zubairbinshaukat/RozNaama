/**
 * Scripted khata scenarios under all 4 recognition-mode combinations:
 * sales effects match the spec, the summary tables equal a from-source
 * recompute (and survive a rebuild unchanged), and khata balances verify.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import { IDENTITIES, makeT, signInAndUpsert } from './setup'
import { fakeAllTimers, readDays, rebuildNow } from './totalsFixtures'
import {
  NOW,
  TODAY,
  YESTERDAY,
  expectKhataConsistent,
  expectTotalsMatchSource,
  expensesTotal,
  salesByDay,
} from './khataFixtures'

const T = '2026-11-17'
const Y = '2026-11-16'

beforeEach(() => {
  fakeAllTimers(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

type Mode = 'delivery' | 'cash'
const COMBOS: [Mode, Mode][] = [
  ['delivery', 'delivery'],
  ['delivery', 'cash'],
  ['cash', 'delivery'],
  ['cash', 'cash'],
]

function expectedSales(advance: Mode, udhaar: Mode): Record<string, number> {
  const out: Record<string, number> = { [T]: 100 } // a normal sale
  const add = (k: string, n: number) => {
    out[k] = (out[k] ?? 0) + n
  }
  // U1: 6000 on Y, 3000 received, +1000 +2000 today. U2: 1000 today, 0 received, forgiven.
  if (udhaar === 'delivery') {
    add(Y, 6000)
    add(T, 1000)
  } else {
    add(Y, 3000)
    add(T, 3000)
  }
  // A1: 5000 on Y, +1000 today, completed today at 11000 with 3000 received, +2000 today.
  // A2: 800 on Y, refunded today. A3: 600 on Y, kept today.
  if (advance === 'delivery') {
    add(T, 11000 + 600)
  } else {
    add(Y, 5000 + 800 + 600)
    add(T, 1000 + 3000 + 2000)
  }
  return out
}

describe.each(COMBOS)('advance=%s, udhaar=%s', (advance, udhaar) => {
  it('scripted scenario: sales per spec, summary == recompute, khata verifies, rebuild is a no-op', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.settings.update, { khataEnabled: true, advanceRecognition: advance, udhaarRecognition: udhaar })
    const cat = await as.mutation(api.categories.create, { name: 'Cloth', color: '#6366F1' })

    await as.mutation(api.saleSessions.record, { sessionDate: TODAY, items: [{ productName: 'Tea', amount: 100 }] })
    await as.mutation(api.expenses.record, { amount: 40, expenseDate: TODAY })

    // Udhaar
    const u1 = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Ali', phone: '0300 1234567' },
      items: [{ productName: 'Suit', amount: 4000, categoryId: cat }, { productName: 'Lace', amount: 2000, categoryId: cat }],
      sessionDate: YESTERDAY,
      receivedNow: 3000,
    })
    expect(u1.remaining).toBe(3000)
    await as.mutation(api.khata.receivePayment, { entryId: u1.entryId, amount: 1000, receivedAt: TODAY })
    expect(await as.mutation(api.khata.receivePayment, { entryId: u1.entryId, amount: 2000, receivedAt: TODAY }))
      .toMatchObject({ status: 'settled', remaining: 0 })
    const u2 = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Bilal' }, items: [{ productName: 'Shoes', amount: 1000 }], sessionDate: TODAY, receivedNow: 0,
    })
    await as.mutation(api.khata.forgiveRemaining, { entryId: u2.entryId })

    // Advances
    const a1 = await as.mutation(api.khata.openAdvance, {
      customer: { name: 'Sara' }, amount: 5000, receivedAt: YESTERDAY, itemLabel: 'Dress', total: 10000,
    })
    await as.mutation(api.khata.receivePayment, { entryId: a1.entryId, amount: 1000, receivedAt: TODAY })
    expect(await as.mutation(api.khata.completeAdvance, {
      entryId: a1.entryId, finalTotal: 11000, receivedNow: 3000, deliveredAt: TODAY, categoryId: cat,
    })).toMatchObject({ status: 'due', remaining: 2000 })
    await as.mutation(api.khata.receivePayment, { entryId: a1.entryId, amount: 2000, receivedAt: TODAY })
    const a2 = await as.mutation(api.khata.openAdvance, { customer: { name: 'Sara' }, amount: 800, receivedAt: YESTERDAY })
    await as.mutation(api.khata.cancelAdvance, { entryId: a2.entryId, refund: true, at: TODAY })
    const a3 = await as.mutation(api.khata.openAdvance, { customer: { name: 'Zara' }, amount: 600, receivedAt: YESTERDAY })
    await as.mutation(api.khata.cancelAdvance, { entryId: a3.entryId, refund: false, at: TODAY })

    // Added by mistake: payment removed, then the whole record.
    const u3 = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Ali' }, items: [{ productName: 'Cap', amount: 500 }], sessionDate: TODAY, receivedNow: 200,
    })
    const p = await as.mutation(api.khata.receivePayment, { entryId: u3.entryId, amount: 100, receivedAt: TODAY })
    await as.mutation(api.khata.removePayment, { paymentId: p.paymentId })
    await as.mutation(api.khata.removeEntry, { entryId: u3.entryId })

    // Open balances: everything settled / cancelled.
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 })
    expect(await salesByDay(t, userId)).toEqual(expectedSales(advance, udhaar))
    expect(await expensesTotal(t, userId)).toBe(40 + (advance === 'cash' ? 800 : 0))

    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
    const verify = await t.query(internal.totals.verifyUserTotals, { userId, monthKey: '2026-11' })
    expect(verify.mismatches).toEqual([])
    expect(verify.ok).toBe(true)

    const before = await readDays(t, userId)
    await rebuildNow(t, userId)
    expect(await readDays(t, userId)).toEqual(before)
    await expectTotalsMatchSource(t, userId)
  })

  it('open balances: one due + one booked, then a mode switch affects new entries only', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.settings.update, { khataEnabled: true, advanceRecognition: advance, udhaarRecognition: udhaar })
    const u = await as.mutation(api.khata.recordSale, {
      customer: { name: 'Ali' }, items: [{ productName: 'Suit', amount: 6000 }], sessionDate: TODAY, receivedNow: 1000,
    })
    const a = await as.mutation(api.khata.openAdvance, { customer: { name: 'Ali' }, amount: 700, receivedAt: TODAY })
    expect(await as.query(api.khata.getTotals, {})).toEqual({ dueTotal: 5000, dueCount: 1, heldTotal: 700, heldCount: 1 })

    const flip = (m: Mode): Mode => (m === 'cash' ? 'delivery' : 'cash')
    await as.mutation(api.settings.update, { advanceRecognition: flip(advance), udhaarRecognition: flip(udhaar) })
    const salesBefore = await salesByDay(t, userId)
    await as.mutation(api.khata.receivePayment, { entryId: u.entryId, amount: 1000, receivedAt: TODAY })
    await as.mutation(api.khata.receivePayment, { entryId: a.entryId, amount: 300, receivedAt: TODAY })
    // Old entries keep their frozen recognition: cash ones add sales, delivery ones don't.
    const added = (udhaar === 'cash' ? 1000 : 0) + (advance === 'cash' ? 300 : 0)
    expect((await salesByDay(t, userId))[T] ?? 0).toBe((salesBefore[T] ?? 0) + added)

    const customer = (await as.query(api.khata.searchCustomers, {}))[0]!
    expect(customer).toMatchObject({ dueTotal: 4000, heldTotal: 1000, openCount: 2 })
    await expectTotalsMatchSource(t, userId)
    await expectKhataConsistent(t, userId)
  })
})
