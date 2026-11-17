import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_CAP,
  forgetExpenseTitle,
  forgetSaleProduct,
  getEntryHistory,
  historyKey,
  recordExpenseTitle,
  recordSaleProducts,
  resetEntryHistoryMemory,
  restoreSaleProduct,
  subscribeEntryHistory,
  suggestExpenseTitles,
  suggestSaleProducts,
} from './entryHistory'

const A = 'user_a'
const B = 'user_b'

beforeEach(() => {
  window.localStorage.clear()
  resetEntryHistoryMemory()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const names = (list: { name: string }[]) => list.map((e) => e.name)

describe('entryHistory: recording', () => {
  it('records each item of a sale and dedupes case-insensitively on the trimmed name', () => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50, categoryId: 'c1' }], 1)
    recordSaleProducts(A, [{ name: '  chai ', amount: 60 }, { name: 'Sugar 1kg', amount: 180 }], 2)
    const { products } = getEntryHistory(A)
    expect(products).toHaveLength(2)
    const chai = products.find((p) => p.name.toLowerCase() === 'chai')
    expect(chai).toEqual({ name: 'chai', categoryId: 'c1', lastAmount: 60, uses: 2, lastUsedAt: 2 })
  })

  it('a new category replaces the remembered one', () => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50, categoryId: 'c1' }], 1)
    recordSaleProducts(A, [{ name: 'Chai', amount: 50, categoryId: 'c2' }], 2)
    expect(getEntryHistory(A).products[0]?.categoryId).toBe('c2')
  })

  it('ignores blank expense titles and dedupes titles', () => {
    recordExpenseTitle(A, '   ', 100, 1)
    recordExpenseTitle(A, 'Rent', 20000, 2)
    recordExpenseTitle(A, 'RENT', 21000, 3)
    const { expenses } = getEntryHistory(A)
    expect(expenses).toEqual([{ title: 'RENT', lastAmount: 21000, uses: 2, lastUsedAt: 3 }])
  })

  it('does nothing without a signed-in user', () => {
    recordSaleProducts(null, [{ name: 'Chai', amount: 50 }])
    recordExpenseTitle(undefined, 'Rent', 100)
    expect(window.localStorage.length).toBe(0)
    expect(getEntryHistory(null)).toEqual({ products: [], expenses: [] })
  })

  it('notifies subscribers on change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeEntryHistory(listener)
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns a stable snapshot until storage changes', () => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])
    const first = getEntryHistory(A)
    expect(getEntryHistory(A)).toBe(first)
    recordSaleProducts(A, [{ name: 'Milk', amount: 90 }])
    expect(getEntryHistory(A)).not.toBe(first)
  })
})

describe('entryHistory: per-user isolation', () => {
  it('keeps each account in its own key', () => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])
    recordSaleProducts(B, [{ name: 'Phone cover', amount: 300 }])
    expect(names(getEntryHistory(A).products)).toEqual(['Chai'])
    expect(names(getEntryHistory(B).products)).toEqual(['Phone cover'])
    expect(window.localStorage.getItem(historyKey(A))).toContain('Chai')
    expect(window.localStorage.getItem(historyKey(A))).not.toContain('Phone cover')
  })
})

describe('entryHistory: ranking', () => {
  beforeEach(() => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }], 1)
    recordSaleProducts(A, [{ name: 'Sugar 1kg', amount: 180 }], 2)
    recordSaleProducts(A, [{ name: 'Milk pack', amount: 90 }], 3)
    recordSaleProducts(A, [{ name: 'Doodh patti chai', amount: 70 }], 4)
    recordSaleProducts(A, [{ name: 'Chai patti', amount: 400 }], 5)
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }], 6) // Chai used twice
  })

  it('empty query → the 4 most recent', () => {
    expect(names(suggestSaleProducts(getEntryHistory(A).products, ''))).toEqual([
      'Chai', 'Chai patti', 'Doodh patti chai', 'Milk pack',
    ])
  })

  it('typing → starts-with first (by uses, then recency), then contains', () => {
    expect(names(suggestSaleProducts(getEntryHistory(A).products, 'CHA'))).toEqual([
      'Chai', 'Chai patti', 'Doodh patti chai',
    ])
    expect(names(suggestSaleProducts(getEntryHistory(A).products, 'patti'))).toEqual([
      'Chai patti', 'Doodh patti chai',
    ])
  })

  it('caps search results at 6', () => {
    for (let i = 0; i < 10; i++) recordSaleProducts(A, [{ name: `Item ${i}`, amount: i }], 100 + i)
    expect(suggestSaleProducts(getEntryHistory(A).products, 'item')).toHaveLength(6)
  })

  it('ranks expense titles the same way', () => {
    recordExpenseTitle(A, 'Electricity', 5000, 1)
    recordExpenseTitle(A, 'Rent', 20000, 2)
    recordExpenseTitle(A, 'Rickshaw', 200, 3)
    expect(suggestExpenseTitles(getEntryHistory(A).expenses, 'r').map((e) => e.title)).toEqual([
      'Rickshaw', 'Rent', 'Electricity',
    ])
  })
})

describe('entryHistory: cap and eviction', () => {
  it(`keeps at most ${HISTORY_CAP} entries, evicting the least recently used`, () => {
    const items = Array.from({ length: HISTORY_CAP }, (_, i) => ({ name: `P${i}`, amount: i }))
    items.forEach((item, i) => recordSaleProducts(A, [item], i + 1))
    recordSaleProducts(A, [{ name: 'P0', amount: 1 }], 1000) // refresh the oldest
    recordSaleProducts(A, [{ name: 'New', amount: 1 }], 1001)
    const list = names(getEntryHistory(A).products)
    expect(list).toHaveLength(HISTORY_CAP)
    expect(list).toContain('P0')
    expect(list).toContain('New')
    expect(list).not.toContain('P1')
  })
})

describe('entryHistory: corrupt or unavailable storage', () => {
  it('treats corrupt JSON as empty', () => {
    window.localStorage.setItem(historyKey(A), '{not json')
    expect(getEntryHistory(A)).toEqual({ products: [], expenses: [] })
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])
    expect(names(getEntryHistory(A).products)).toEqual(['Chai'])
  })

  it('drops entries with the wrong shape', () => {
    window.localStorage.setItem(historyKey(A), JSON.stringify({
      products: [
        { name: 'Good', lastAmount: 10, uses: 1, lastUsedAt: 1 },
        { name: 42, lastAmount: 10, uses: 1, lastUsedAt: 1 },
        { name: 'NoAmount', uses: 1, lastUsedAt: 1 },
        { name: 'BadCat', categoryId: 5, lastAmount: 1, uses: 1, lastUsedAt: 1 },
        'junk',
      ],
      expenses: 'nope',
    }))
    const h = getEntryHistory(A)
    expect(names(h.products)).toEqual(['Good'])
    expect(h.expenses).toEqual([])
  })

  it('falls back to memory when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(() => recordSaleProducts(A, [{ name: 'Chai', amount: 50 }])).not.toThrow()
    expect(names(getEntryHistory(A).products)).toEqual(['Chai'])
  })
})

describe('entryHistory: forget', () => {
  it('removes one entry and can be undone', () => {
    recordSaleProducts(A, [{ name: 'Chai', amount: 50 }, { name: 'Milk', amount: 90 }])
    const removed = forgetSaleProduct(A, ' CHAI ')
    expect(removed?.name).toBe('Chai')
    expect(names(getEntryHistory(A).products)).toEqual(['Milk'])
    if (removed) restoreSaleProduct(A, removed)
    expect(names(getEntryHistory(A).products).sort()).toEqual(['Chai', 'Milk'])
  })

  it('returns null for unknown names and other users', () => {
    recordExpenseTitle(A, 'Rent', 100)
    expect(forgetExpenseTitle(B, 'Rent')).toBeNull()
    expect(forgetExpenseTitle(A, 'Gas')).toBeNull()
    expect(forgetExpenseTitle(A, 'rent')?.title).toBe('Rent')
    expect(getEntryHistory(A).expenses).toEqual([])
  })
})
