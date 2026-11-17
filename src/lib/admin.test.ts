import { afterEach, describe, expect, it } from 'vitest'
import { ADMIN_CARDS_KEY, lastActiveLabel, readHiddenCards, sortLoadedUsers, writeHiddenCards } from './admin'

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
