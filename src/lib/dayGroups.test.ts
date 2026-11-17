import { describe, expect, it } from 'vitest'
import { dateKeyToLocalMs, toDayGroups } from './dayGroups'
import { toLocalDateKey } from './utils'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { Id } from '../../convex/_generated/dataModel'

type Session = DayFeedEntry['sessions'][number]
type Sale = Session['items'][number]
type Expense = DayFeedEntry['expenses'][number]

const USER = 'u1' as Id<'users'>

function sale(id: string, sessionId: string, amount: number, createdAt: number): Sale {
  return {
    _id: id as Id<'sales'>,
    _creationTime: createdAt,
    userId: USER,
    sessionId: sessionId as Id<'saleSessions'>,
    productName: `Item ${id}`,
    amount,
    saleDate: createdAt,
    createdAt,
  }
}

function session(id: string, items: Sale[], createdAt: number): Session {
  return {
    _id: id as Id<'saleSessions'>,
    _creationTime: createdAt,
    userId: USER,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    itemCount: items.length,
    sessionDate: createdAt,
    createdAt,
    items,
  }
}

function expense(id: string, amount: number, createdAt: number): Expense {
  return {
    _id: id as Id<'expenses'>,
    _creationTime: createdAt,
    userId: USER,
    amount,
    expenseDate: createdAt,
    createdAt,
  }
}

function entry(date: string, overrides: Partial<DayFeedEntry> = {}): DayFeedEntry {
  return {
    date,
    salesTotal: 0,
    expenseTotal: 0,
    saleCount: 0,
    expenseCount: 0,
    sessions: [],
    expenses: [],
    ...overrides,
  }
}

describe('dateKeyToLocalMs', () => {
  it('returns local midnight for a day key', () => {
    const ms = dateKeyToLocalMs('2026-03-12')
    const d = new Date(ms)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 2, 12, 0, 0])
    expect(toLocalDateKey(ms)).toBe('2026-03-12')
  })

  it('returns NaN for malformed keys', () => {
    expect(Number.isNaN(dateKeyToLocalMs('2026-3-12'))).toBe(true)
    expect(Number.isNaN(dateKeyToLocalMs(''))).toBe(true)
  })
})

describe('toDayGroups', () => {
  it('uses server totals and counts, not sums of the loaded items', () => {
    const s = session('s1', [sale('a', 's1', 100, 1)], 1)
    const [g] = toDayGroups([
      entry('2026-03-12', {
        salesTotal: 999, expenseTotal: 50, saleCount: 7, expenseCount: 3,
        sessions: [s], expenses: [expense('e1', 10, 2)],
      }),
    ])
    expect(g.salesTotal).toBe(999)
    expect(g.expenseTotal).toBe(50)
    expect(g.saleCount).toBe(7)
    expect(g.expenseCount).toBe(3)
    expect(g.net).toBe(949)
    expect(g.items).toHaveLength(1)
    expect(g.expenses).toHaveLength(1)
  })

  it('handles an expense-only day', () => {
    const [g] = toDayGroups([
      entry('2026-03-11', { expenseTotal: 300, expenseCount: 1, expenses: [expense('e1', 300, 5)] }),
    ])
    expect(g.items).toEqual([])
    expect(g.saleCount).toBe(0)
    expect(g.salesTotal).toBe(0)
    expect(g.net).toBe(-300)
    expect(g.expenses.map((e) => e._id)).toEqual(['e1'])
  })

  it('reports a negative net when expenses exceed sales', () => {
    const [g] = toDayGroups([entry('2026-03-10', { salesTotal: 200, expenseTotal: 500, saleCount: 1, expenseCount: 2 })])
    expect(g.net).toBe(-300)
  })

  it('sorts days newest first and items/expenses oldest first, flattening sessions', () => {
    const later = session('s2', [sale('c', 's2', 30, 30), sale('b', 's2', 20, 20)], 20)
    const earlier = session('s1', [sale('a', 's1', 10, 10)], 10)
    const groups = toDayGroups([
      entry('2026-03-09'),
      entry('2026-03-12', {
        sessions: [later, earlier],
        expenses: [expense('e2', 5, 50), expense('e1', 5, 40)],
      }),
      entry('2026-03-10'),
    ])
    expect(groups.map((g) => g.dateKey)).toEqual(['2026-03-12', '2026-03-10', '2026-03-09'])
    expect(groups[0].items.map((i) => i._id)).toEqual(['a', 'b', 'c'])
    expect(groups[0].expenses.map((e) => e._id)).toEqual(['e1', 'e2'])
  })

  it('keeps a day repeated across pages only once', () => {
    const groups = toDayGroups([
      entry('2026-03-12', { salesTotal: 10 }),
      entry('2026-03-12', { salesTotal: 10 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].salesTotal).toBe(10)
  })

  it('labels today as "Today"', () => {
    const [g] = toDayGroups([entry(toLocalDateKey(Date.now()))])
    expect(g.dateLabel).toBe('Today')
  })

  it('does not mutate the input entries', () => {
    const items = [sale('b', 's1', 1, 2), sale('a', 's1', 1, 1)]
    const e = entry('2026-03-12', { sessions: [session('s1', items, 1)] })
    toDayGroups([e])
    expect(e.sessions[0].items.map((i) => i._id)).toEqual(['b', 'a'])
  })
})
