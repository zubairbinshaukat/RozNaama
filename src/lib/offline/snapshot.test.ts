import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applySnapshotPatch,
  canWriteSnapshot,
  createSnapshotStore,
  emptySnapshot,
  feedFromSnapshot,
  fitSnapshot,
  isStaleDay,
  latestCurrentStats,
  parseSnapshot,
  readableSnapshot,
  snapshotSize,
  statsFromSnapshot,
  SNAPSHOT_FEED_MAX_DAYS,
  type SnapshotAccess,
  type SnapshotIO,
} from './snapshot'
import type { SnapshotRecord } from './snapshotTypes'
import { statsRangesForDay } from '@/lib/period'
import type { DashboardStats } from '@/hooks/useSales'
import type { DayFeedEntry } from '@/hooks/useDayFeed'

const day = (key: string) => new Date(`${key}T00:00:00+05:00`).getTime()
const endOf = (key: string) => day(key) + 86_400_000 - 1
const NOW = Date.parse('2026-03-12T10:00:00+05:00')

const STATS: DashboardStats = {
  todayTotal: 1, todaySalesTotal: 1, todayNetTotal: 1, todayCount: 1, todayExpenseTotal: 0, todayExpenseCount: 0,
  weekTotal: 1, weekCount: 1, monthTotal: 1, monthCount: 1,
  allTimeTotal: 1, allTimeCount: 1, allTimeSalesTotal: 1, allTimeExpenseTotal: 0, topCategoryName: null,
}

const feedDay = (date: string, note = ''): DayFeedEntry =>
  ({ date, salesTotal: 1, expenseTotal: 0, saleCount: 1, expenseCount: 0, sessions: [], expenses: [], ...(note ? { note } : {}) }) as DayFeedEntry

const access = (over: Partial<SnapshotAccess> = {}): SnapshotAccess =>
  ({ owner: 'user_a', ownerSource: 'clerk', viewingOther: false, dataReady: true, ...over })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('snapshot read / write rules', () => {
  it('writes only for a Clerk-confirmed owner, own data, with live queries', () => {
    expect(canWriteSnapshot(access())).toBe(true)
    expect(canWriteSnapshot(access({ viewingOther: true }))).toBe(false)
    expect(canWriteSnapshot(access({ ownerSource: 'hint' }))).toBe(false)
    expect(canWriteSnapshot(access({ owner: null, ownerSource: 'none' }))).toBe(false)
    expect(canWriteSnapshot(access({ dataReady: false }))).toBe(false)
  })

  it('never returns another owner’s snapshot, or any snapshot in view-as', () => {
    const rec = emptySnapshot('user_a', NOW)
    expect(readableSnapshot(rec, access())).toBe(rec)
    expect(readableSnapshot(rec, access({ owner: 'user_b' }))).toBeNull()
    expect(readableSnapshot(rec, access({ viewingOther: true }))).toBeNull()
    expect(parseSnapshot(rec, 'user_b')).toBeNull()
    expect(parseSnapshot({ ...rec, v: 2 }, 'user_a')).toBeNull()
    expect(parseSnapshot(rec, 'user_a')).toEqual(rec)
  })

  it('detects a stale day', () => {
    const rec = emptySnapshot('user_a', NOW)
    expect(isStaleDay(rec, NOW)).toBe(false)
    expect(isStaleDay(rec, NOW + 86_400_000)).toBe(true)
  })
})

describe('snapshot lookups', () => {
  it('stats by exact ranges, and the latest current-day stats for the stale view', () => {
    const ranges = statsRangesForDay(day('2026-03-12'))
    const rec = applySnapshotPatch(emptySnapshot('user_a', NOW), { kind: 'stats', ranges, value: STATS }, NOW)
    expect(statsFromSnapshot(rec, ranges)?.value).toEqual(STATS)
    expect(statsFromSnapshot(rec, statsRangesForDay(day('2026-03-13')))).toBeNull()
    expect(latestCurrentStats(rec)?.ranges).toEqual(ranges)
  })

  it('feed: exact range, a covering range filtered by date, or nothing', () => {
    const week = { s: day('2026-03-09'), e: endOf('2026-03-15') }
    let rec = emptySnapshot('user_a', NOW)
    rec = applySnapshotPatch(rec, {
      kind: 'feed', startDate: week.s, endDate: week.e, isDone: true,
      entries: [feedDay('2026-03-10'), feedDay('2026-03-12')],
    }, NOW)
    expect(feedFromSnapshot(rec, week.s, week.e)?.entries.map((d) => d.date)).toEqual(['2026-03-12', '2026-03-10'])
    const today = feedFromSnapshot(rec, day('2026-03-12'), endOf('2026-03-12'))
    expect(today).toMatchObject({ complete: true })
    expect(today?.entries.map((d) => d.date)).toEqual(['2026-03-12'])
    expect(feedFromSnapshot(rec, day('2026-03-11'), endOf('2026-03-11'))?.entries).toEqual([])
    expect(feedFromSnapshot(rec, day('2026-03-01'), endOf('2026-03-01'))).toBeNull()
  })

  it('an unfinished feed only covers days from its oldest loaded day', () => {
    const month = { s: day('2026-03-01'), e: endOf('2026-03-31') }
    const rec = applySnapshotPatch(emptySnapshot('user_a', NOW), {
      kind: 'feed', startDate: month.s, endDate: month.e, isDone: false,
      entries: [feedDay('2026-03-12'), feedDay('2026-03-08')],
    }, NOW)
    expect(feedFromSnapshot(rec, day('2026-03-09'), endOf('2026-03-15'))?.complete).toBe(true)
    expect(feedFromSnapshot(rec, day('2026-03-02'), endOf('2026-03-08'))).toBeNull()
    expect(feedFromSnapshot(rec, month.s, month.e)?.complete).toBe(false)
  })

  it('keeps at most SNAPSHOT_FEED_MAX_DAYS days per feed (then not done)', () => {
    const entries = Array.from({ length: 40 }, (_, i) => feedDay(`2026-01-${String(i + 1).padStart(2, '0')}`))
    const rec = applySnapshotPatch(emptySnapshot('user_a', NOW), { kind: 'feed', startDate: null, endDate: null, entries, isDone: true }, NOW)
    expect(rec.feeds[0]?.value).toHaveLength(SNAPSHOT_FEED_MAX_DAYS)
    expect(rec.feeds[0]?.isDone).toBe(false)
  })
})

describe('size cap', () => {
  it('drops older slots, then shortens the feed, to fit; null when the core cannot fit', () => {
    let rec: SnapshotRecord = emptySnapshot('user_a', NOW)
    for (let i = 0; i < 5; i++) {
      const big = Array.from({ length: 20 }, (_, d) => feedDay(`2026-02-${String(d + 1).padStart(2, '0')}`, 'x'.repeat(2000)))
      rec = applySnapshotPatch(rec, { kind: 'feed', startDate: i, endDate: i + 1, entries: big, isDone: true }, NOW)
    }
    const max = 60_000
    expect(snapshotSize(rec)).toBeGreaterThan(max)
    const fitted = fitSnapshot(rec, max)!
    expect(snapshotSize(fitted)).toBeLessThanOrEqual(max)
    expect(fitted.feeds.length).toBeLessThanOrEqual(1)

    const huge = { ...emptySnapshot('user_a', NOW), categories: [{ _id: 'c', userId: 'u', name: 'x'.repeat(10_000), color: '#fff', createdAt: 1 }] }
    expect(fitSnapshot(huge as unknown as SnapshotRecord, 1000)).toBeNull()
  })
})

describe('snapshot store', () => {
  function memoryIO(initial: SnapshotRecord | null = null) {
    const writes: SnapshotRecord[] = []
    let stored = initial
    const io: SnapshotIO = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (r) => { stored = r; writes.push(r) }),
      remove: vi.fn(async () => { stored = null }),
    }
    return { io, writes }
  }
  const immediate = (fn: () => void) => fn()

  it('debounces writes by 1s and skips unchanged payloads', async () => {
    const { io, writes } = memoryIO()
    const store = createSnapshotStore({ io, idle: immediate })
    await store.load('user_a')
    store.patch('user_a', { kind: 'categories', value: [] })
    store.patch('user_a', { kind: 'availableYears', value: [2026] })
    await vi.advanceTimersByTimeAsync(999)
    expect(writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ owner: 'user_a', categories: [], availableYears: [2026] })

    store.patch('user_a', { kind: 'availableYears', value: [2026] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(writes).toHaveLength(1)
    expect(store.getState().record?.availableYears).toEqual([2026])
  })

  it('merges patches into the record read from IndexedDB', async () => {
    const saved = applySnapshotPatch(emptySnapshot('user_a', NOW - 1000), { kind: 'availableYears', value: [2025] }, NOW - 1000)
    const { io, writes } = memoryIO(saved)
    const store = createSnapshotStore({ io, idle: immediate })
    expect(await store.load('user_a')).toEqual(saved)
    store.patch('user_a', { kind: 'categories', value: [] })
    await store.flushNow()
    expect(writes[0]).toMatchObject({ availableYears: [2025], categories: [] })
  })

  it('switching owner discards the previous owner’s data and pending writes', async () => {
    const { io, writes } = memoryIO()
    const store = createSnapshotStore({ io, idle: immediate })
    store.patch('user_a', { kind: 'availableYears', value: [2026] })
    await store.load('user_b')
    await vi.advanceTimersByTimeAsync(2000)
    expect(writes).toHaveLength(0)
    expect(store.getState()).toMatchObject({ owner: 'user_b', record: null })
  })

  it('clear removes the record', async () => {
    const { io } = memoryIO(emptySnapshot('user_a', NOW))
    const store = createSnapshotStore({ io, idle: immediate })
    await store.load('user_a')
    await store.clear('user_a')
    expect(store.getState().record).toBeNull()
    expect(io.remove).toHaveBeenCalledWith('user_a')
  })
})
