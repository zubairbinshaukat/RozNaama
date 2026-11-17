import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_CARDS_KEY, WATCHLIST_MAX, initialsOf, lastActiveLabel, readHiddenCards, readWatchlist, recordWhenLabel,
  sortLoadedUsers, watchlistKey, writeHiddenCards, writeWatchlist,
} from './admin'

describe('recordWhenLabel / initialsOf', () => {
  const now = Date.parse('2026-11-17T17:00:00+05:00')
  it('says "2:14 PM today", "Yesterday, …", or the date', () => {
    expect(recordWhenLabel(Date.parse('2026-11-17T14:14:00+05:00'), now)).toBe('2:14 PM today')
    expect(recordWhenLabel(Date.parse('2026-11-16T09:05:00+05:00'), now)).toBe('Yesterday, 9:05 AM')
    expect(recordWhenLabel(Date.parse('2026-11-10T09:05:00+05:00'), now)).toBe('Tue, 10 Nov')
    expect(recordWhenLabel(Date.parse('2025-11-10T09:05:00+05:00'), now)).toBe('Mon, 10 Nov 2025')
  })
  it('makes up to two initials', () => {
    expect(initialsOf('Ali Raza Khan')).toBe('AK')
    expect(initialsOf('  sana ')).toBe('S')
    expect(initialsOf('')).toBe('?')
  })
})

describe('watchlist storage', () => {
  it('is per Clerk user, de-duplicated, capped, and survives corrupt data', () => {
    expect(readWatchlist('c1')).toEqual([])
    writeWatchlist('c1', ['a', 'b', 'a'])
    expect(readWatchlist('c1')).toEqual(['a', 'b'])
    expect(readWatchlist('c2')).toEqual([])
    writeWatchlist('c2', Array.from({ length: 30 }, (_, i) => `id${i}`))
    expect(readWatchlist('c2')).toHaveLength(WATCHLIST_MAX)
    localStorage.setItem(watchlistKey('c1'), JSON.stringify(['ok', 3, null, '']))
    expect(readWatchlist('c1')).toEqual(['ok'])
    localStorage.setItem(watchlistKey('c1'), '{bad')
    expect(readWatchlist('c1')).toEqual([])
  })
})

afterEach(() => localStorage.clear())

describe('lastActiveLabel', () => {
  const now = Date.parse('2026-11-17T12:00:00+05:00')
  it('says Never / Today / Yesterday / N days ago / the date', () => {
    expect(lastActiveLabel(null, now)).toBe('Never')
    expect(lastActiveLabel(Date.parse('2026-11-17T00:30:00+05:00'), now)).toBe('Today')
    expect(lastActiveLabel(Date.parse('2026-11-16T23:30:00+05:00'), now)).toBe('Yesterday')
    expect(lastActiveLabel(Date.parse('2026-11-14T10:00:00+05:00'), now)).toBe('3 days ago')
    expect(lastActiveLabel(Date.parse('2026-09-01T10:00:00+05:00'), now)).toBe('Tue, 1 Sep 2026')
  })
})

describe('hidden card preferences', () => {
  it('round-trips and drops unknown / corrupt entries', () => {
    expect(readHiddenCards()).toEqual([])
    writeHiddenCards(['users', 'userCharts'])
    expect(readHiddenCards()).toEqual(['users', 'userCharts'])
    localStorage.setItem(ADMIN_CARDS_KEY, JSON.stringify(['users', 'nope', 3, 'users']))
    expect(readHiddenCards()).toEqual(['users'])
    localStorage.setItem(ADMIN_CARDS_KEY, '{bad json')
    expect(readHiddenCards()).toEqual([])
  })
})

describe('sortLoadedUsers', () => {
  const rows = [
    { name: 'A', lastActivityAt: 5, allTimeSales: 1 },
    { name: 'B', lastActivityAt: null, allTimeSales: 9 },
    { name: 'C', lastActivityAt: 7, allTimeSales: 3 },
  ]
  it('orders by recent activity (never last) and all-time sales; keeps server order otherwise', () => {
    expect(sortLoadedUsers(rows, 'recent').map((r) => r.name)).toEqual(['C', 'A', 'B'])
    expect(sortLoadedUsers(rows, 'allTime').map((r) => r.name)).toEqual(['B', 'C', 'A'])
    expect(sortLoadedUsers(rows, 'name').map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })
})
