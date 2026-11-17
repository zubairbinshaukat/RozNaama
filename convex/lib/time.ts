/**
 * Time-zone helpers shared by queries, totals and tests.
 * All functions are pure and never throw on a bad zone: invalid zones fall
 * back to UTC behaviour (matching the legacy query code).
 */

/** Default bucket zone for users without a stored zone. */
export const DEFAULT_TIME_ZONE = 'Asia/Karachi'

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Trim and validate an IANA zone. Empty or invalid → `fallback`
 * (default 'UTC', which is what the legacy queries used for `''`).
 */
export function normalizeTimeZone(timeZone: string | null | undefined, fallback = 'UTC'): string {
  const trimmed = (timeZone ?? '').trim()
  if (trimmed.length === 0) return fallback
  return isValidTimeZone(trimmed) ? trimmed : fallback
}

/** YYYY-MM-DD in the given IANA zone (matches browser local keys when zones align). */
export function dateKeyInTimeZone(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone })
  } catch {
    return new Date(ms).toISOString().split('T')[0]!
  }
}

/** 0-based month (0 = Jan) of the instant in the given zone. */
export function monthIndexInTimeZone(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      month: '2-digit',
    }).formatToParts(new Date(ms))
    const monthPart = parts.find((part) => part.type === 'month')?.value
    const month = Number(monthPart)
    if (Number.isFinite(month) && month >= 1 && month <= 12) return month - 1
  } catch {
    // Fall through to UTC fallback below.
  }
  return new Date(ms).getUTCMonth()
}

/** Calendar year of the instant in the given zone. */
export function yearInTimeZone(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
    }).formatToParts(new Date(ms))
    const yearPart = parts.find((part) => part.type === 'year')?.value
    const year = Number(yearPart)
    if (Number.isFinite(year)) return year
  } catch {
    // Fall through to UTC fallback below.
  }
  return new Date(ms).getUTCFullYear()
}

/**
 * Offset (ms) of `timeZone` from UTC at instant `ms`:
 * wall-clock-as-UTC − actual UTC. Karachi → +5h. Invalid zone → 0.
 */
export function timeZoneOffsetMs(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(ms))
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN)
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    const wholeSecond = ms - (((ms % 1000) + 1000) % 1000)
    const offset = asUtc - wholeSecond
    return Number.isFinite(offset) ? offset : 0
  } catch {
    return 0
  }
}

const DAY_START_SEARCH_MS = 36 * 60 * 60 * 1000
/** Largest |ms| a JS Date can hold. */
const MAX_DATE_MS = 8.64e15

/**
 * UTC instant (ms) where the calendar date y/m(0-based)/d starts in
 * `timeZone`: the first instant whose local date is that day. That is local
 * midnight, except in zones where a DST jump skips 00:00 (e.g.
 * America/Santiago, Asia/Beirut), where the day starts at 01:00.
 */
export function zonedMidnightMs(year: number, monthIndex: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, monthIndex, day)
  const first = guess - timeZoneOffsetMs(guess, timeZone)
  const second = guess - timeZoneOffsetMs(first, timeZone)
  if (!Number.isFinite(second) || Math.abs(guess) > MAX_DATE_MS - DAY_START_SEARCH_MS) return second

  // Fast path: `second` is local midnight of the wanted day (every day without a gap at 00:00).
  const target = new Date(guess).toISOString().slice(0, 10)
  const keyAt = (ms: number) => dateKeyInTimeZone(ms, timeZone)
  if (keyAt(second) === target && keyAt(second - 1) < target) return second

  // Midnight does not exist (or the zone is odd): binary search for the first
  // instant whose local date is ≥ target. Local dates never go backwards
  // across a day boundary, so the predicate is monotonic in this window.
  let lo = second - DAY_START_SEARCH_MS
  let hi = second + DAY_START_SEARCH_MS
  if (!(keyAt(lo) < target && keyAt(hi) >= target)) return second
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (keyAt(mid) >= target) hi = mid
    else lo = mid
  }
  return hi
}

/** UTC instant (ms) of 00:00 on 1 January `year` in `timeZone`. */
export function zonedYearStartMs(year: number, timeZone: string): number {
  return zonedMidnightMs(year, 0, 1, timeZone)
}

/** UTC instant (ms) of 00:00 on `dayKey` ('YYYY-MM-DD') in `timeZone`. */
export function zonedStartOfDayMs(dayKey: string, timeZone: string): number {
  const [y, m, d] = dayKey.split('-').map(Number)
  return zonedMidnightMs(y ?? NaN, (m ?? NaN) - 1, d ?? NaN, timeZone)
}

/**
 * Bounds of month `monthKey` ('YYYY-MM') in `timeZone`:
 * `[start, end)` as UTC ms (end = start of next month).
 */
export function monthBounds(monthKey: string, timeZone: string): { start: number; end: number } {
  const [y, m] = monthKey.split('-').map(Number)
  const year = y ?? NaN
  const monthIndex = (m ?? NaN) - 1
  return {
    start: zonedMidnightMs(year, monthIndex, 1, timeZone),
    end:   zonedMidnightMs(year, monthIndex + 1, 1, timeZone),
  }
}
