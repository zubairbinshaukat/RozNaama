/**
 * H1: a legacy sale whose `sessionId` points at ANOTHER user's session must
 * never let its owner patch or delete that session (or the other user's totals).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { IDENTITIES, freezeNow, makeT, signInAndUpsert, type TestT } from './setup'
import { KHI, readDays, readUserTotals } from './totalsFixtures'

afterEach(() => vi.useRealTimers())

const day = (key: string) => zonedStartOfDayMs(key, KHI)

async function poisonedSetup() {
  freezeNow('2026-11-17T12:00:00Z')
  const t = makeT()
  const a = await signInAndUpsert(t, IDENTITIES.A)
  const b = await signInAndUpsert(t, IDENTITIES.B)
  const bSession = await b.as.mutation(api.saleSessions.record, {
    sessionDate: day('2026-11-10'),
    items: [{ productName: 'b1', amount: 100 }, { productName: 'b2', amount: 50 }],
  })
  // A's legacy sale points at B's session.
  const saleId = await t.run((ctx) => ctx.db.insert('sales', {
    userId: a.userId, sessionId: bSession.sessionId, productName: 'poison', amount: 40,
    saleDate: day('2026-11-10'), createdAt: 0,
  }))
  const bBefore = await snapshotB(t, b.userId, bSession.sessionId)
  return { t, a, b, bSessionId: bSession.sessionId, saleId, bBefore }
}

async function snapshotB(t: TestT, bId: Id<'users'>, sessionId: Id<'saleSessions'>) {
  const totals = await readUserTotals(t, bId)
  return {
    session: await t.run((ctx) => ctx.db.get('saleSessions', sessionId)),
    days:    await readDays(t, bId),
    sums:    totals && [totals.salesTotal, totals.itemCount],
  }
}

describe("H1: foreign parent session is never touched", () => {
  it('removeItem deletes A\'s sale but leaves B\'s session and totals alone', async () => {
    const { t, a, b, bSessionId, saleId, bBefore } = await poisonedSetup()
    await a.as.mutation(api.sales.removeItem, { saleId })
    expect(await t.run((ctx) => ctx.db.get('sales', saleId))).toBeNull()
    expect(await snapshotB(t, b.userId, bSessionId)).toEqual(bBefore)
    expect(bBefore.session).toMatchObject({ itemCount: 2, totalAmount: 150 })
  })

  it('same-date amount edit updates A\'s sale only', async () => {
    const { t, a, b, bSessionId, saleId, bBefore } = await poisonedSetup()
    await a.as.mutation(api.sales.updateItem, { saleId, productName: 'poison', amount: 99 })
    expect((await t.run((ctx) => ctx.db.get('sales', saleId)))?.amount).toBe(99)
    expect(await snapshotB(t, b.userId, bSessionId)).toEqual(bBefore)
  })

  it('date move detaches nothing from B and joins / creates only A\'s own session', async () => {
    const { t, a, b, bSessionId, saleId, bBefore } = await poisonedSetup()
    // B also has a session on the target date: A must not join it.
    const bTarget = await b.as.mutation(api.saleSessions.record, {
      sessionDate: day('2026-11-12'), items: [{ productName: 'b3', amount: 7 }],
    })
    const bTargetBefore = await t.run((ctx) => ctx.db.get('saleSessions', bTarget.sessionId))
    const bDaysBefore = await readDays(t, b.userId)

    await a.as.mutation(api.sales.updateItem, {
      saleId, productName: 'poison', amount: 40, saleDate: day('2026-11-12'),
    })

    const sale = await t.run((ctx) => ctx.db.get('sales', saleId))
    expect(sale?.sessionId).not.toBe(bTarget.sessionId)
    const newSession = await t.run((ctx) => ctx.db.get('saleSessions', sale!.sessionId))
    expect(newSession).toMatchObject({ userId: a.userId, itemCount: 1, totalAmount: 40, sessionDate: day('2026-11-12') })
    expect(await t.run((ctx) => ctx.db.get('saleSessions', bSessionId))).toEqual(bBefore.session)
    expect(await t.run((ctx) => ctx.db.get('saleSessions', bTarget.sessionId))).toEqual(bTargetBefore)
    expect(await readDays(t, b.userId)).toEqual(bDaysBefore)
    expect(await readDays(t, a.userId)).toEqual({
      '2026-11-12': { salesTotal: 40, itemCount: 1, sessionCount: 1, expenseTotal: 0, expenseCount: 0 },
    })
  })

  it('own sessions still update normally (control)', async () => {
    freezeNow('2026-11-17T12:00:00Z')
    const t = makeT()
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const { sessionId } = await a.as.mutation(api.saleSessions.record, {
      sessionDate: day('2026-11-10'),
      items: [{ productName: 'x', amount: 10 }, { productName: 'y', amount: 5 }],
    })
    const sales = await t.run((ctx) => ctx.db.query('sales').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).collect())
    await a.as.mutation(api.sales.updateItem, { saleId: sales[0]!._id, productName: 'x', amount: 12 })
    expect(await t.run((ctx) => ctx.db.get('saleSessions', sessionId))).toMatchObject({ totalAmount: 17, itemCount: 2 })
    await a.as.mutation(api.sales.removeItem, { saleId: sales[1]!._id })
    expect(await t.run((ctx) => ctx.db.get('saleSessions', sessionId))).toMatchObject({ totalAmount: 12, itemCount: 1 })
  })
})
