import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupSaleItemsByDay } from './saleGroups'
import type { SaleItem } from '@/hooks/useSales'
import type { Id } from '../../convex/_generated/dataModel'

let seq = 0
function sale(saleDate: Date, createdAt: number, amount = 100): SaleItem {
  seq += 1
  return {
    _id:         `sale${seq}` as Id<'sales'>,
    userId:      'user1' as Id<'users'>,
    sessionId:   `session${seq}` as Id<'saleSessions'>,
    productName: `Item ${seq}`,
    amount,
    saleDate:    saleDate.getTime(),
    createdAt,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 2, 12, 15, 0, 0)) // Thu, 12 Mar 2026 local
})

afterEach(() => {
  vi.useRealTimers()
})

describe('groupSaleItemsByDay', () => {
  it('returns an empty list for no items', () => {
    expect(groupSaleItemsByDay([])).toEqual([])
  })

  it('groups items by local calendar day, newest day first', () => {
    const items = [
      sale(new Date(2026, 2, 10, 9), 1),
      sale(new Date(2026, 2, 12, 10), 2),
      sale(new Date(2026, 2, 11, 23, 59), 3),
      sale(new Date(2026, 2, 12, 0, 0), 4),
    ]
    const groups = groupSaleItemsByDay(items)
    expect(groups.map((g) => g.dateKey)).toEqual(['2026-03-12', '2026-03-11', '2026-03-10'])
    expect(groups[0]!.items).toHaveLength(2)
    expect(groups[1]!.items).toHaveLength(1)
  })

  it('labels days with formatDate (Today / Yesterday / weekday)', () => {
    const groups = groupSaleItemsByDay([
      sale(new Date(2026, 2, 12, 10), 1),
      sale(new Date(2026, 2, 11, 10), 2),
      sale(new Date(2026, 2, 9, 10), 3),
    ])
    expect(groups[0]!.dateLabel).toBe('Today')
    expect(groups[1]!.dateLabel).toBe('Yesterday')
    expect(groups[2]!.dateLabel).not.toBe('Today')
    expect(groups[2]!.dateLabel).toContain('9')
  })

  it('orders items within a day by createdAt ascending', () => {
    const a = sale(new Date(2026, 2, 12, 8), 300)
    const b = sale(new Date(2026, 2, 12, 9), 100)
    const c = sale(new Date(2026, 2, 12, 7), 200)
    const [day] = groupSaleItemsByDay([a, b, c])
    expect(day!.items.map((i) => i._id)).toEqual([b._id, c._id, a._id])
  })

  it('merges a day split across paginated pages into one group', () => {
    // Server returns newest saleDate first; page 1 ends mid-day.
    const page1 = [
      sale(new Date(2026, 2, 12, 18), 50),
      sale(new Date(2026, 2, 11, 20), 40),
    ]
    const page2 = [
      sale(new Date(2026, 2, 11, 9), 30),
      sale(new Date(2026, 2, 10, 9), 20),
    ]
    const groups = groupSaleItemsByDay([...page1, ...page2])
    expect(groups.map((g) => g.dateKey)).toEqual(['2026-03-12', '2026-03-11', '2026-03-10'])
    const split = groups[1]!
    expect(split.items).toHaveLength(2)
    expect(split.items.map((i) => i.createdAt)).toEqual([30, 40])
  })

  it('does not mutate the input array order', () => {
    const items = [
      sale(new Date(2026, 2, 10, 9), 2),
      sale(new Date(2026, 2, 12, 9), 1),
    ]
    const ids = items.map((i) => i._id)
    groupSaleItemsByDay(items)
    expect(items.map((i) => i._id)).toEqual(ids)
  })
})
