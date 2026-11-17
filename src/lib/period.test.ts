import { describe, expect, it } from 'vitest'
import {
  bestDayOf,
  canGoNext,
  canGoPrev,
  CURRENT_SELECTION,
  dayLabel,
  dayRange,
  daysInMonth,
  focusDayIn,
  isCurrentPeriod,
  MIN_PERIOD_DAY_MS,
  monthLabel,
  monthNameText,
  monthRange,
  periodStart,
  recentWeeks,
  resolveSelection,
  selectPeriod,
  shiftPeriod,
  statsRangesForDay,
  weekLabel,
  weekRange,
  weekRangeText,
  yearLabel,
} from './period'

// Frontend tests run in Asia/Karachi (see tests/frontend/setup.ts).
const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
const endOf = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
/** Tuesday 17 Nov 2026, mid-afternoon. */
const NOW = day(2026, 11, 17, 15)

describe('week boundaries (Monday–Sunday)', () => {
  it('a Tuesday belongs to the week starting the Monday before', () => {
    expect(weekRange(NOW)).toEqual({ start: day(2026, 11, 16), end: endOf(2026, 11, 22) })
  })

  it('Sunday is the last day of its week, Monday the first of the next', () => {
    expect(weekRange(day(2026, 11, 22, 23)).start).toBe(day(2026, 11, 16))
    expect(weekRange(day(2026, 11, 23)).start).toBe(day(2026, 11, 23))
  })

  it('a week can cross the year boundary', () => {
    expect(weekRange(day(2026, 1, 1))).toEqual({ start: day(2025, 12, 29), end: endOf(2026, 1, 4) })
    expect(shiftPeriod('week', day(2026, 1, 5), -1)).toBe(day(2025, 12, 29))
    expect(shiftPeriod('week', day(2025, 12, 29), 1)).toBe(day(2026, 1, 5))
  })

  it('lists recent weeks newest first', () => {
    expect(recentWeeks(3, NOW)).toEqual([day(2026, 11, 16), day(2026, 11, 9), day(2026, 11, 2)])
  })
})

describe('month and day boundaries', () => {
  it('month ranges are whole local days', () => {
    expect(monthRange(NOW)).toEqual({ start: day(2026, 11, 1), end: endOf(2026, 11, 30) })
    expect(monthRange(day(2028, 2, 10)).end).toBe(endOf(2028, 2, 29))
    expect(daysInMonth(day(2026, 2, 1))).toBe(28)
  })

  it('steps months across the year boundary', () => {
    expect(shiftPeriod('month', day(2026, 1, 20), -1)).toBe(day(2025, 12, 1))
    expect(shiftPeriod('month', day(2025, 12, 31), 1)).toBe(day(2026, 1, 1))
  })

  it('day ranges run 00:00:00.000 → 23:59:59.999', () => {
    expect(dayRange(NOW)).toEqual({ start: day(2026, 11, 17), end: endOf(2026, 11, 17) })
    expect(shiftPeriod('day', day(2026, 1, 1), -1)).toBe(day(2025, 12, 31))
  })
})

describe('next / previous', () => {
  it('next is disabled on the current period only', () => {
    expect(canGoNext('day', NOW, NOW)).toBe(false)
    expect(canGoNext('day', day(2026, 11, 16), NOW)).toBe(true)
    expect(canGoNext('week', day(2026, 11, 22), NOW)).toBe(false)
    expect(canGoNext('week', day(2026, 11, 15), NOW)).toBe(true)
    expect(canGoNext('month', day(2026, 11, 1), NOW)).toBe(false)
    expect(canGoNext('month', day(2026, 10, 31), NOW)).toBe(true)
  })

  it('knows the current period', () => {
    expect(isCurrentPeriod('week', day(2026, 11, 16), NOW)).toBe(true)
    expect(isCurrentPeriod('month', day(2026, 10, 1), NOW)).toBe(false)
  })

  it('previous stops at the earliest selectable period', () => {
    expect(canGoPrev('day', MIN_PERIOD_DAY_MS)).toBe(false)
    expect(canGoPrev('day', shiftPeriod('day', MIN_PERIOD_DAY_MS, 1))).toBe(true)
    expect(canGoPrev('month', day(2000, 1, 15))).toBe(false)
    expect(canGoPrev('week', NOW)).toBe(true)
  })
})

describe('labels', () => {
  it('days: Today, Yesterday, then the date (with a year outside this year)', () => {
    expect(dayLabel(NOW, NOW)).toBe('Today')
    expect(dayLabel(day(2026, 11, 16), NOW)).toBe('Yesterday')
    expect(dayLabel(day(2026, 11, 15), NOW)).toBe('Sun, 15 Nov')
    expect(dayLabel(day(2025, 12, 31), NOW)).toBe('Wed, 31 Dec 2025')
  })

  it('weeks: This week, Last week, then the date range', () => {
    expect(weekLabel(NOW, NOW)).toBe('This week')
    expect(weekLabel(day(2026, 11, 9), NOW)).toBe('Last week')
    expect(weekLabel(day(2026, 11, 2), NOW)).toBe('2–8 Nov')
    expect(weekRangeText(NOW, NOW)).toBe('16–22 Nov')
    expect(weekRangeText(day(2026, 10, 26), NOW)).toBe('26 Oct – 1 Nov')
    expect(weekRangeText(day(2025, 12, 1), NOW)).toBe('1–7 Dec 2025')
    expect(weekRangeText(day(2026, 1, 1), NOW)).toBe('29 Dec 2025 – 4 Jan 2026')
  })

  it('months and years', () => {
    expect(monthLabel(NOW, NOW)).toBe('This month')
    expect(monthLabel(day(2026, 10, 1), NOW)).toBe('October')
    expect(monthLabel(day(2025, 10, 1), NOW)).toBe('October 2025')
    expect(monthNameText(NOW)).toBe('November 2026')
    expect(yearLabel(2026, NOW)).toBe('This year')
    expect(yearLabel(2025, NOW)).toBe('2025')
  })
})

describe('selection', () => {
  it('starts on the current periods', () => {
    expect(resolveSelection(CURRENT_SELECTION, NOW)).toEqual({
      daily: day(2026, 11, 17),
      weekly: day(2026, 11, 16),
      monthly: day(2026, 11, 1),
      yearly: 2026,
    })
  })

  it('stores past periods by their start and the current one as null', () => {
    const past = selectPeriod(CURRENT_SELECTION, 'weekly', day(2026, 11, 12, 9), NOW)
    expect(past.weekly).toBe(day(2026, 11, 9))
    expect(selectPeriod(past, 'weekly', NOW, NOW).weekly).toBeNull()
    expect(selectPeriod(CURRENT_SELECTION, 'monthly', day(2026, 10, 20), NOW).monthly).toBe(day(2026, 10, 1))
    expect(selectPeriod(CURRENT_SELECTION, 'yearly', 2025, NOW).yearly).toBe(2025)
    expect(selectPeriod(CURRENT_SELECTION, 'yearly', 2026, NOW).yearly).toBeNull()
  })

  it('keeps the other views untouched', () => {
    const s = selectPeriod(CURRENT_SELECTION, 'daily', day(2026, 11, 10), NOW)
    expect(s).toEqual({ ...CURRENT_SELECTION, daily: day(2026, 11, 10) })
  })
})

describe('stats ranges', () => {
  it('are whole days around the focus day and stay within the 93-day fast path', () => {
    const r = statsRangesForDay(day(2026, 10, 31))
    expect(r).toEqual({
      todayStart: day(2026, 10, 31), todayEnd: endOf(2026, 10, 31),
      weekStart:  day(2026, 10, 26), weekEnd:  endOf(2026, 11, 1),
      monthStart: day(2026, 10, 1),  monthEnd: endOf(2026, 10, 31),
    })
    const span = (Math.max(r.todayEnd, r.weekEnd, r.monthEnd) - Math.min(r.todayStart, r.weekStart, r.monthStart)) / 86_400_000
    expect(span).toBeLessThanOrEqual(93)
  })

  it('focus on today inside the current period, else the last day', () => {
    expect(focusDayIn(monthRange(NOW), NOW)).toBe(day(2026, 11, 17))
    expect(focusDayIn(monthRange(day(2026, 10, 5)), NOW)).toBe(day(2026, 10, 31))
    expect(focusDayIn(weekRange(day(2026, 11, 9)), NOW)).toBe(day(2026, 11, 15))
  })
})

describe('bestDayOf', () => {
  it('picks the highest positive day', () => {
    const totals = [
      { date: '2026-11-16', total: 500 },
      { date: '2026-11-18', total: 1200 },
      { date: '2026-11-19', total: -300 },
    ]
    expect(bestDayOf(totals, 'weekday')).toEqual({ label: 'Wed', total: 1200 })
    expect(bestDayOf(totals, 'date')).toEqual({ label: '18 Nov', total: 1200 })
  })

  it('is null when no day made money', () => {
    expect(bestDayOf([{ date: '2026-11-16', total: -10 }], 'weekday')).toBeNull()
    expect(bestDayOf([], 'date')).toBeNull()
  })
})

it('periodStart normalises any time inside the period', () => {
  expect(periodStart('day', NOW)).toBe(day(2026, 11, 17))
  expect(periodStart('month', NOW)).toBe(day(2026, 11, 1))
})
