import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIME_ZONE,
  dateKeyInTimeZone,
  monthBounds,
  monthIndexInTimeZone,
  normalizeTimeZone,
  timeZoneOffsetMs,
  yearInTimeZone,
  zonedStartOfDayMs,
  zonedYearStartMs,
} from '../../convex/lib/time'

const KHI = 'Asia/Karachi'
const HOUR = 60 * 60 * 1000

describe('normalizeTimeZone', () => {
  it('trims valid zones', () => {
    expect(normalizeTimeZone('  Asia/Karachi ')).toBe(KHI)
  })

  it('falls back on empty / invalid / nullish', () => {
    expect(normalizeTimeZone('')).toBe('UTC')
    expect(normalizeTimeZone('   ')).toBe('UTC')
    expect(normalizeTimeZone(undefined)).toBe('UTC')
    expect(normalizeTimeZone(null)).toBe('UTC')
    expect(normalizeTimeZone('Not/AZone')).toBe('UTC')
    expect(normalizeTimeZone('Not/AZone', DEFAULT_TIME_ZONE)).toBe(KHI)
  })
})

describe('dateKeyInTimeZone / monthIndexInTimeZone / yearInTimeZone', () => {
  it('2026-03-10T19:30Z is 03-11 in Karachi, 03-10 in UTC', () => {
    const ms = Date.parse('2026-03-10T19:30:00Z')
    expect(dateKeyInTimeZone(ms, KHI)).toBe('2026-03-11')
    expect(dateKeyInTimeZone(ms, 'UTC')).toBe('2026-03-10')
  })

  it('2025-12-31T20:00Z is Jan 2026 in Karachi, Dec 2025 in UTC', () => {
    const ms = Date.parse('2025-12-31T20:00:00Z')
    expect(yearInTimeZone(ms, KHI)).toBe(2026)
    expect(monthIndexInTimeZone(ms, KHI)).toBe(0)
    expect(yearInTimeZone(ms, 'UTC')).toBe(2025)
    expect(monthIndexInTimeZone(ms, 'UTC')).toBe(11)
  })

  it('PKT midnight boundaries (23:59 / 00:00)', () => {
    const midnight = Date.parse('2026-03-10T19:00:00Z') // 2026-03-11 00:00 PKT
    expect(dateKeyInTimeZone(midnight - 60_000, KHI)).toBe('2026-03-10')
    expect(dateKeyInTimeZone(midnight, KHI)).toBe('2026-03-11')
  })

  it('invalid zone falls back to UTC instead of throwing', () => {
    const ms = Date.parse('2025-12-31T20:00:00Z')
    expect(dateKeyInTimeZone(ms, 'Not/AZone')).toBe('2025-12-31')
    expect(monthIndexInTimeZone(ms, 'Not/AZone')).toBe(11)
    expect(yearInTimeZone(ms, 'Not/AZone')).toBe(2025)
  })
})

describe('zoned boundaries', () => {
  it('offsets', () => {
    expect(timeZoneOffsetMs(Date.parse('2026-01-01T00:00:00Z'), KHI)).toBe(5 * HOUR)
    expect(timeZoneOffsetMs(Date.parse('2026-01-01T00:00:00Z'), 'UTC')).toBe(0)
    expect(timeZoneOffsetMs(Date.parse('2026-01-01T00:00:00Z'), 'Asia/Kathmandu')).toBe(5.75 * HOUR)
  })

  it('zonedYearStartMs', () => {
    expect(zonedYearStartMs(2026, KHI)).toBe(Date.parse('2025-12-31T19:00:00Z'))
    expect(zonedYearStartMs(2026, 'UTC')).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect(zonedYearStartMs(2026, 'America/New_York')).toBe(Date.parse('2026-01-01T05:00:00Z'))
  })

  it('zonedStartOfDayMs handles DST days', () => {
    expect(zonedStartOfDayMs('2026-03-11', KHI)).toBe(Date.parse('2026-03-10T19:00:00Z'))
    // US DST starts 2026-03-08 at 02:00 local; midnight is still EST (-5h).
    expect(zonedStartOfDayMs('2026-03-08', 'America/New_York')).toBe(Date.parse('2026-03-08T05:00:00Z'))
    // Day after DST start: midnight is EDT (-4h).
    expect(zonedStartOfDayMs('2026-03-09', 'America/New_York')).toBe(Date.parse('2026-03-09T04:00:00Z'))
  })

  it('round-trips: start of day maps back to the same key', () => {
    for (const tz of [KHI, 'UTC', 'America/New_York', 'Asia/Kathmandu']) {
      for (const key of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
        const start = zonedStartOfDayMs(key, tz)
        expect(dateKeyInTimeZone(start, tz)).toBe(key)
        expect(dateKeyInTimeZone(start - 1, tz)).not.toBe(key)
      }
    }
  })

  it('monthBounds gives [start, end) with end = next month start', () => {
    const dec = monthBounds('2025-12', KHI)
    expect(dec.start).toBe(Date.parse('2025-11-30T19:00:00Z'))
    expect(dec.end).toBe(zonedYearStartMs(2026, KHI))
  })
})

describe('zonedStartOfDayMs in zones where midnight does not exist (DST gap at 00:00)', () => {
  const firstInstant = (key: string, tz: string) => {
    const ms = zonedStartOfDayMs(key, tz)
    return { ms, key: dateKeyInTimeZone(ms, tz), before: dateKeyInTimeZone(ms - 1, tz) }
  }

  it('America/Santiago 2026-09-06 starts at 01:00 local (04:00Z)', () => {
    expect(new Date(zonedStartOfDayMs('2026-09-06', 'America/Santiago')).toISOString()).toBe('2026-09-06T04:00:00.000Z')
    // Neighbouring days are ordinary midnights.
    expect(new Date(zonedStartOfDayMs('2026-09-05', 'America/Santiago')).toISOString()).toBe('2026-09-05T04:00:00.000Z')
    expect(new Date(zonedStartOfDayMs('2026-09-07', 'America/Santiago')).toISOString()).toBe('2026-09-07T03:00:00.000Z')
  })

  it('Asia/Beirut 2026-03-29 and America/Havana 2026-03-08 start at 01:00 local', () => {
    expect(new Date(zonedStartOfDayMs('2026-03-29', 'Asia/Beirut')).toISOString()).toBe('2026-03-28T22:00:00.000Z')
    expect(new Date(zonedStartOfDayMs('2026-03-08', 'America/Havana')).toISOString()).toBe('2026-03-08T05:00:00.000Z')
  })

  it('always returns the first instant of the day (property over a year of days in gap zones)', () => {
    for (const tz of ['America/Santiago', 'Asia/Beirut', 'America/Havana', 'America/New_York', KHI, 'Australia/Lord_Howe']) {
      let ms = Date.UTC(2026, 0, 1)
      for (let i = 0; i < 366; i++, ms += 24 * HOUR) {
        const key = new Date(ms).toISOString().slice(0, 10)
        const r = firstInstant(key, tz)
        expect(r.key, `${tz} ${key}`).toBe(key)
        expect(r.before < key, `${tz} ${key}`).toBe(true)
      }
    }
  }, 30_000) // ~2,200 Intl-heavy checks; slow under parallel test load

  it('monthBounds / zonedYearStartMs use the same first-instant rule', () => {
    expect(monthBounds('2026-09', 'America/Santiago').end).toBe(zonedStartOfDayMs('2026-10-01', 'America/Santiago'))
    expect(zonedYearStartMs(2026, KHI)).toBe(Date.parse('2025-12-31T19:00:00Z'))
  })
})
