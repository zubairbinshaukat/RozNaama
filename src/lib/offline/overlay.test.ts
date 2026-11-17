import { describe, expect, it } from 'vitest'
import {
  applyPendingToDailyTotals,
  applyPendingToFeed,
  applyPendingToStats,
  applyPendingToYearlyTotals,
  isPendingId,
  pendingEntryIdOf,
} from './overlay'
import { toDayGroups } from '@/lib/dayGroups'
import { statsRangesForDay } from '@/lib/period'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { DashboardStats } from '@/hooks/useSales'
import type { Id } from '../../../convex/_generated/dataModel'
import { expenseEntry, saleEntry } from './testUtils'

const day = (key: string) => new Date(`${key}T00:00:00+05:00`).getTime()

function feedDay(date: string, over: Partial<DayFeedEntry> = {}): DayFeedEntry {
  return { date, salesTotal: 0, expenseTotal: 0, saleCount: 0, expenseCount: 0, sessions: [], expenses: [], ...over }
}

const sale = (id: string, date: string, amounts: number[], createdAt = 10) =>
  saleEntry(id, {
    dayKey: date,
    createdAt,
    args: { items: amounts.map((amount, i) => ({ productName: `P${i}`, amount })), sessionDate: day(date) },
  })
const expense = (id: string, date: string, amount: number) =>
  expenseEntry(id, { dayKey: date, args: { amount, expenseDate: day(date) } })

const ZERO_STATS: DashboardStats = {
  todayTotal: 0, todaySalesTotal: 0, todayNetTotal: 0, todayCount: 0, todayExpenseTotal: 0, todayExpenseCount: 0,
  weekTotal: 0, weekCount: 0, monthTotal: 0, monthCount: 0,
  allTimeTotal: 0, allTimeCount: 0, allTimeSalesTotal: 0, allTimeExpenseTotal: 0, topCategoryName: 'Tea',
}

describe('pending ids', () => {
  it('recognises synthetic ids and maps them back to the entry id', () => {
    expect(isPendingId('pending:abc')).toBe(true)
    expect(isPendingId('k57abc')).toBe(false)
    expect(isPendingId(undefined)).toBe(false)
    expect(pendingEntryIdOf('pending:abc')).toBe('abc')
    expect(pendingEntryIdOf('pending:abc:2')).toBe('abc')
    expect(pendingEntryIdOf('k57abc')).toBeNull()
  })
})

describe('applyPendingToFeed', () => {
  const opts = { startKey: null, endKey: null, isDone: true }

  it('appends pending rows to their day and adjusts the day totals', () => {
    const live = [feedDay('2026-03-12', { salesTotal: 100, saleCount: 1, expenseTotal: 10, expenseCount: 1 })]
    const out = applyPendingToFeed(live, [sale('s1', '2026-03-12', [50, 25]), expense('e1', '2026-03-12', 30)], opts)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ salesTotal: 175, saleCount: 3, expenseTotal: 40, expenseCount: 2 })
    const g = toDayGroups(out)[0]!
    expect(g.net).toBe(135)
    expect(g.items.map((i) => i._id)).toEqual(['pending:s1:0', 'pending:s1:1'])
    expect(g.expenses.map((e) => e._id)).toEqual(['pending:e1'])
    expect(g.items.every((i) => isPendingId(i._id) && isPendingId(i.sessionId))).toBe(true)
  })

  it('creates a missing day in date order', () => {
    const live = [feedDay('2026-03-12'), feedDay('2026-03-09')]
    const out = applyPendingToFeed(live, [sale('s1', '2026-03-10', [5])], opts)
    expect(out.map((d) => d.date)).toEqual(['2026-03-12', '2026-03-10', '2026-03-09'])
  })

  it('respects the range and never adds days older than the loaded window', () => {
    const live = [feedDay('2026-03-12'), feedDay('2026-03-10')]
    const pending = [sale('old', '2026-03-01', [5]), sale('out', '2026-04-01', [5]), sale('new', '2026-03-11', [5])]
    const out = applyPendingToFeed(live, pending, { startKey: null, endKey: '2026-03-31', isDone: false })
    expect(out.map((d) => d.date)).toEqual(['2026-03-12', '2026-03-11', '2026-03-10'])
  })

  it('an exhausted empty feed shows pending days; a still-loading empty feed does not', () => {
    const p = [sale('s1', '2026-03-12', [5])]
    expect(applyPendingToFeed([], p, { startKey: '2026-03-12', endKey: '2026-03-12', isDone: true })).toHaveLength(1)
    expect(applyPendingToFeed([], p, { startKey: '2026-03-12', endKey: '2026-03-12', isDone: false })).toHaveLength(0)
  })

  it('is idempotent and returns the same array when nothing applies', () => {
    const live = [feedDay('2026-03-12')]
    expect(applyPendingToFeed(live, [], opts)).toBe(live)
    const once = applyPendingToFeed(live, [sale('s1', '2026-03-12', [5])], opts)
    const twice = applyPendingToFeed(once, [sale('s1', '2026-03-12', [5])], opts)
    expect(twice[0]?.salesTotal).toBe(5)
  })

  it('drops the pending row once the entry is gone (live row arrived)', () => {
    const live = [feedDay('2026-03-12', {
      salesTotal: 5,
      saleCount: 1,
      sessions: [{
        _id: 'ss1' as Id<'saleSessions'>, _creationTime: 1, userId: 'u' as Id<'users'>, totalAmount: 5, itemCount: 1,
        sessionDate: day('2026-03-12'), createdAt: 1,
        items: [{
          _id: 's1' as Id<'sales'>, _creationTime: 1, userId: 'u' as Id<'users'>, sessionId: 'ss1' as Id<'saleSessions'>,
          productName: 'P0', amount: 5, saleDate: day('2026-03-12'), createdAt: 1,
        }],
      }],
    })]
    const out = applyPendingToFeed(live, [], opts)
    expect(out[0]?.salesTotal).toBe(5)
    expect(toDayGroups(out)[0]!.items.some((i) => isPendingId(i._id))).toBe(false)
  })
})

describe('applyPendingToStats', () => {
  const ranges = statsRangesForDay(day('2026-03-12')) // Thu; week Mon 9 – Sun 15; month March

  it('adds each entry to the periods it falls in', () => {
    const out = applyPendingToStats(ZERO_STATS, ranges, [
      sale('today', '2026-03-12', [100, 50]),
      expense('todayExp', '2026-03-12', 30),
      sale('week', '2026-03-10', [20]),
      sale('month', '2026-03-02', [7]),
      expense('older', '2026-02-20', 5),
    ])
    expect(out).toMatchObject({
      todayTotal: 150, todaySalesTotal: 150, todayNetTotal: 120, todayCount: 2,
      todayExpenseTotal: 30, todayExpenseCount: 1,
      weekTotal: 140, weekCount: 3,
      monthTotal: 147, monthCount: 4,
      allTimeTotal: 142, allTimeCount: 4, allTimeSalesTotal: 177, allTimeExpenseTotal: 35,
      topCategoryName: 'Tea',
    })
  })

  it('returns the input when nothing is pending', () => {
    expect(applyPendingToStats(ZERO_STATS, ranges, [])).toBe(ZERO_STATS)
  })
})

describe('chart overlays', () => {
  it('adds nets to daily totals by day key', () => {
    const totals = [{ date: '2026-03-11', total: 10 }, { date: '2026-03-12', total: 0 }]
    expect(applyPendingToDailyTotals(totals, [sale('a', '2026-03-12', [40]), expense('b', '2026-03-12', 15)])).toEqual([
      { date: '2026-03-11', total: 10 },
      { date: '2026-03-12', total: 25 },
    ])
  })

  it('adds to the right month of the right year', () => {
    const rows = Array.from({ length: 12 }, (_, monthIndex) => ({ monthIndex, salesTotal: 0, netTotal: 0 }))
    const out = applyPendingToYearlyTotals(rows, 2026, [sale('a', '2026-03-12', [40]), expense('b', '2026-03-01', 15), sale('c', '2025-03-12', [9])])
    expect(out[2]).toEqual({ monthIndex: 2, salesTotal: 40, netTotal: 25 })
    expect(rows[2]).toEqual({ monthIndex: 2, salesTotal: 0, netTotal: 0 })
  })
})
