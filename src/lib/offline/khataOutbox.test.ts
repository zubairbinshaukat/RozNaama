import { describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import type { Id } from '../../../convex/_generated/dataModel'
import { buildEntry } from '@/hooks/useSubmitEntry'
import { changePaymentAmount, dropEntryCategories, moveEntryToToday } from '@/hooks/useOutbox'
import { pendingEntryTitle } from '@/lib/pendingEntries'
import { classifyError, NOT_FOUND_MESSAGE } from './classify'
import { OutboxEngine } from './outboxEngine'
import { InMemoryOutboxStore } from './outboxStore'
import { applyPendingToDailyTotals, applyPendingToFeed, applyPendingToStats } from './overlay'
import { OWNER, saleEntry, settle } from './testUtils'
import {
  KHATA_OUTBOX_ENTRY_VERSION,
  OUTBOX_ENTRY_VERSION,
  entryDateMs,
  entrySalesTotal,
  parseOutboxEntry,
  type OutboxEntry,
  type StoredOutboxRecord,
} from './types'

const DAY = Date.parse('2026-03-12T00:00:00+05:00')
const ENTRY = 'k1' as Id<'khataEntries'>

function udhaar(recognition: 'delivery' | 'cash', receivedNow = 3000) {
  return buildEntry(OWNER, 'ks-1', {
    kind: 'khataSale',
    args: {
      customer: { name: 'Ali', phone: '0300 1234567' },
      customerName: 'Ali',
      items: [{ productName: 'Suit', amount: 6000, categoryId: 'cat1' as Id<'categories'> }],
      sessionDate: DAY,
      receivedNow,
      recognition,
    },
  }, 10)
}

function advance(recognition: 'delivery' | 'cash') {
  return buildEntry(OWNER, 'ka-1', {
    kind: 'khataAdvance',
    args: { customer: { id: 'c1' as Id<'customers'> }, customerName: 'Ali', amount: 5000, receivedAt: DAY, recognition, itemLabel: '' },
  }, 10)
}

function payment(recognition: 'delivery' | 'cash', entryKind: 'udhaar' | 'advance' = 'udhaar') {
  return buildEntry(OWNER, 'kp-1', {
    kind: 'khataPayment',
    args: { entryId: ENTRY, amount: 1000, receivedAt: DAY, customerName: 'Ali', entryKind, recognition },
  }, 10)
}

describe('khata outbox entries', () => {
  it('are version 2 (sales / expenses stay version 1) and parse back', () => {
    const e = udhaar('delivery')
    expect(e.v).toBe(KHATA_OUTBOX_ENTRY_VERSION)
    expect(saleEntry('s').v).toBe(OUTBOX_ENTRY_VERSION)
    for (const entry of [udhaar('cash'), advance('delivery'), payment('cash')]) {
      expect(parseOutboxEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry)
    }
  })

  it('send exactly the server args, always with recognition; display data stays local', () => {
    const e = udhaar('cash')
    expect(e.kind === 'khataSale' && e.args).toEqual({
      customer: { name: 'Ali', phone: '0300 1234567' },
      items: [{ productName: 'Suit', amount: 6000, categoryId: 'cat1' }],
      sessionDate: DAY,
      receivedNow: 3000,
      recognition: 'cash',
    })
    const a = advance('delivery')
    // Empty optional text is not sent.
    expect(a.kind === 'khataAdvance' && a.args).toEqual({ customer: { id: 'c1' }, amount: 5000, receivedAt: DAY, recognition: 'delivery' })
    const p = payment('delivery')
    expect(p.kind === 'khataPayment' && p.args).toEqual({ entryId: ENTRY, amount: 1000, receivedAt: DAY })
  })

  it('rejects unknown kinds / versions and malformed khata args', () => {
    const e = udhaar('delivery') as unknown as Record<string, unknown>
    expect(parseOutboxEntry({ ...e, kind: 'khataSomethingNew' })).toBeNull()
    expect(parseOutboxEntry({ ...e, v: 3 })).toBeNull()
    expect(parseOutboxEntry({ ...e, v: 1 })).toBeNull() // khata kinds are never v1
    expect(parseOutboxEntry({ ...e, khata: undefined })).toBeNull()
    expect(parseOutboxEntry({ ...e, args: { ...(e.args as object), recognition: 'later' } })).toBeNull()
  })

  it('a pre-khata build (accepts only v1) skips them: an engine keeps unknown records, never sends or deletes them', async () => {
    const store = new InMemoryOutboxStore()
    const unknown = { ...(udhaar('delivery') as unknown as StoredOutboxRecord), v: 99 }
    await store.put(unknown)
    const send = vi.fn()
    const engine = new OutboxEngine({ owner: OWNER, store, send, inFlight: new Map() })
    await engine.start()
    engine.setAuthReady(true)
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(engine.getState().skippedCount).toBe(1)
    expect(await store.get(unknown.id)).toBeTruthy()
    engine.dispose()
  })

  it('titles and dates', () => {
    expect(pendingEntryTitle(udhaar('delivery'))).toBe('Udhaar · Ali')
    expect(pendingEntryTitle(advance('cash'))).toBe('Advance · Ali')
    expect(pendingEntryTitle(payment('cash'))).toBe('Received · Ali')
    expect(entryDateMs(payment('cash'))).toBe(DAY)
  })
})

describe('overlay: countedAmount by recognition', () => {
  it('Udhaar sale: delivery counts the whole bill, cash only what was received', () => {
    expect(entrySalesTotal(udhaar('delivery'))).toBe(6000)
    expect(entrySalesTotal(udhaar('cash'))).toBe(3000)
    expect(entrySalesTotal(udhaar('cash', 0))).toBe(0)
  })

  it('advance and later payments count only in cash mode', () => {
    expect(entrySalesTotal(advance('delivery'))).toBe(0)
    expect(entrySalesTotal(advance('cash'))).toBe(5000)
    expect(entrySalesTotal(payment('delivery'))).toBe(0)
    expect(entrySalesTotal(payment('cash'))).toBe(1000)
  })

  it('day feed: delivery Udhaar shows the items; cash shows "Ali · Udhaar"; a delivery advance adds no row', () => {
    const opts = { startKey: null, endKey: null, isDone: true }
    const delivery = applyPendingToFeed([], [udhaar('delivery')], opts)
    expect(delivery[0]?.salesTotal).toBe(6000)
    expect(delivery[0]?.sessions[0]?.items[0]?.productName).toBe('Suit')
    const cash = applyPendingToFeed([], [udhaar('cash')], opts)
    expect(cash[0]?.salesTotal).toBe(3000)
    expect(cash[0]?.sessions[0]?.items[0]?.productName).toBe('Ali · Udhaar')
    expect(cash[0]?.sessions[0]?.items[0]?.categoryId).toBe('cat1')
    expect(applyPendingToFeed([], [advance('delivery')], opts)).toEqual([])
    const adv = applyPendingToFeed([], [advance('cash'), payment('cash', 'advance')], opts)
    expect(adv[0]?.salesTotal).toBe(6000)
    expect(adv[0]?.sessions.map((s) => s.items[0]?.productName)).toEqual(['Ali · Advance', 'Ali · Advance'])
  })

  it('stats and daily totals follow the same amounts', () => {
    const zero = {
      todayTotal: 0, todaySalesTotal: 0, todayNetTotal: 0, todayCount: 0, todayExpenseTotal: 0, todayExpenseCount: 0,
      weekTotal: 0, weekCount: 0, monthTotal: 0, monthCount: 0, allTimeTotal: 0, allTimeCount: 0,
      allTimeSalesTotal: 0, allTimeExpenseTotal: 0, topCategoryName: null,
    }
    const ranges = { todayStart: DAY, todayEnd: DAY + 86_399_999, weekStart: DAY, weekEnd: DAY + 86_399_999, monthStart: DAY, monthEnd: DAY + 86_399_999 }
    const pending: OutboxEntry[] = [udhaar('delivery'), advance('delivery'), payment('cash')]
    const s = applyPendingToStats(zero, ranges, pending)
    expect(s.todaySalesTotal).toBe(7000)
    expect(s.todayCount).toBe(2)
    expect(applyPendingToDailyTotals([{ date: '2026-03-12', total: 100 }], pending)).toEqual([{ date: '2026-03-12', total: 7100 }])
  })
})

describe('khata fixes and error classes', () => {
  it('change amount keeps the same id and rescales the cash overlay', () => {
    const p = payment('cash')
    const fixed = changePaymentAmount(p, 400)
    expect(fixed.id).toBe(p.id)
    expect(fixed.kind === 'khataPayment' && fixed.args.amount).toBe(400)
    expect(entrySalesTotal(fixed)).toBe(400)
    expect(entrySalesTotal(changePaymentAmount(payment('delivery'), 400))).toBe(0)
  })

  it('save for today / without category also work for khata kinds', () => {
    const moved = moveEntryToToday(payment('cash'), Date.parse('2026-03-20T09:00:00+05:00'))
    expect(moved.dayKey).toBe('2026-03-20')
    const dropped = dropEntryCategories(udhaar('delivery'))
    expect(dropped.kind === 'khataSale' && dropped.args.items[0]).toEqual({ productName: 'Suit', amount: 6000 })
  })

  it('"This record was cancelled" stays readable; a deleted category keeps the usual fix', () => {
    const cancelled = new ConvexError({ code: 'NOT_FOUND', message: 'This record was cancelled' })
    expect(classifyError(cancelled, 'khataPayment')).toEqual({ action: 'needsAttention', reason: 'notFound', message: 'This record was cancelled' })
    const category = new ConvexError({ code: 'NOT_FOUND', message: 'Category not found' })
    expect(classifyError(category, 'khataSale').message).toBe(NOT_FOUND_MESSAGE)
    expect(classifyError(cancelled, 'sale').message).toBe(NOT_FOUND_MESSAGE)
    const over = new ConvexError({ code: 'VALIDATION', message: 'More than Baqi (PKR 1,000)' })
    expect(classifyError(over, 'khataPayment')).toEqual({ action: 'needsAttention', reason: 'validation', message: 'More than Baqi (PKR 1,000)' })
  })
})
