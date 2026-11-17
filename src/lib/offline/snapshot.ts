/**
 * Instant-open snapshot (OFFLINE-PLAN §1): the signed-in user's own dashboard
 * data, saved to IndexedDB from LIVE query results and read on the next open
 * (stale-while-revalidate) and while offline.
 *
 * Rules: written only for the Clerk-confirmed owner, never in admin view-as,
 * never from snapshot data, debounced 1 s + idle, capped at ~512 KB. A record
 * whose owner differs from the current user is never returned.
 */
import { getDB } from '@/lib/db'
import { getClientTimeZone, toLocalDateKey } from '@/lib/utils'
import type { StatsRanges } from '@/lib/period'
import type { DailyTotal, DashboardStats, YearlyMonthlyTotal } from '@/hooks/useSales'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { Category } from '@/hooks/useCategories'
import {
  SNAPSHOT_VERSION,
  snapshotKeyFor,
  type FeedSlot,
  type KeyedSlot,
  type SnapshotRecord,
  type StatsSlot,
} from './snapshotTypes'

export { readLastUserHint, type LastUserHint } from '@/lib/userHints'
export type { SnapshotRecord } from './snapshotTypes'

export const SNAPSHOT_MAX_BYTES = 512 * 1024
export const SNAPSHOT_DEBOUNCE_MS = 1000
export const SNAPSHOT_FEED_MAX_DAYS = 31
export const SNAPSHOT_CAPS = { stats: 8, feeds: 6, dailyTotals: 6, yearlyTotals: 4 } as const

// ── keys ────────────────────────────────────────────────────────────────────

export function statsKey(r: StatsRanges, tz: string = getClientTimeZone()): string {
  return `${tz}|${r.todayStart}-${r.todayEnd}|${r.weekStart}-${r.weekEnd}|${r.monthStart}-${r.monthEnd}`
}

export function feedKey(startDate: number | null, endDate: number | null, tz: string = getClientTimeZone()): string {
  return `${tz}|${startDate ?? ''}-${endDate ?? ''}`
}

export function rangeKey(parts: readonly (string | number)[], tz: string = getClientTimeZone()): string {
  return `${tz}|${parts.join('-')}`
}

// ── pure record operations ─────────────────────────────────────────────────

export function emptySnapshot(owner: string, now: number, tz: string = getClientTimeZone()): SnapshotRecord {
  return {
    key: snapshotKeyFor(owner),
    v: SNAPSHOT_VERSION,
    owner,
    savedAt: now,
    tz,
    todayKey: toLocalDateKey(now),
    stats: [],
    feeds: [],
    categories: null,
    availableYears: null,
    dailyTotals: [],
    yearlyTotals: [],
  }
}

export type SnapshotPatch =
  | { kind: 'stats'; ranges: StatsRanges; value: DashboardStats }
  | { kind: 'feed'; startDate: number | null; endDate: number | null; entries: readonly DayFeedEntry[]; isDone: boolean }
  | { kind: 'categories'; value: readonly Category[] }
  | { kind: 'availableYears'; value: readonly number[] }
  | { kind: 'dailyTotals'; key: string; value: readonly DailyTotal[] }
  | { kind: 'yearlyTotals'; key: string; value: readonly YearlyMonthlyTotal[] }

function upsert<T extends { key: string }>(list: readonly T[], slot: T, cap: number): T[] {
  return [slot, ...list.filter((s) => s.key !== slot.key)].slice(0, cap)
}

/** Newest days first, at most SNAPSHOT_FEED_MAX_DAYS (trimming clears `isDone`). */
function trimFeed(entries: readonly DayFeedEntry[], isDone: boolean): { value: DayFeedEntry[]; isDone: boolean } {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  if (sorted.length <= SNAPSHOT_FEED_MAX_DAYS) return { value: sorted, isDone }
  return { value: sorted.slice(0, SNAPSHOT_FEED_MAX_DAYS), isDone: false }
}

export function applySnapshotPatch(record: SnapshotRecord, patch: SnapshotPatch, now: number): SnapshotRecord {
  const base = { ...record, savedAt: now, todayKey: toLocalDateKey(now), tz: getClientTimeZone() }
  switch (patch.kind) {
    case 'stats': {
      const slot: StatsSlot = { key: statsKey(patch.ranges, base.tz), ranges: patch.ranges, value: patch.value, savedAt: now }
      return { ...base, stats: upsert(record.stats, slot, SNAPSHOT_CAPS.stats) }
    }
    case 'feed': {
      const { value, isDone } = trimFeed(patch.entries, patch.isDone)
      const slot: FeedSlot = {
        key: feedKey(patch.startDate, patch.endDate, base.tz),
        startDate: patch.startDate,
        endDate: patch.endDate,
        value,
        isDone,
        savedAt: now,
      }
      return { ...base, feeds: upsert(record.feeds, slot, SNAPSHOT_CAPS.feeds) }
    }
    case 'categories':
      return { ...base, categories: [...patch.value] }
    case 'availableYears':
      return { ...base, availableYears: [...patch.value] }
    case 'dailyTotals': {
      const slot: KeyedSlot<DailyTotal[]> = { key: patch.key, value: [...patch.value], savedAt: now }
      return { ...base, dailyTotals: upsert(record.dailyTotals, slot, SNAPSHOT_CAPS.dailyTotals) }
    }
    case 'yearlyTotals': {
      const slot: KeyedSlot<YearlyMonthlyTotal[]> = { key: patch.key, value: [...patch.value], savedAt: now }
      return { ...base, yearlyTotals: upsert(record.yearlyTotals, slot, SNAPSHOT_CAPS.yearlyTotals) }
    }
  }
}

export function snapshotSize(record: SnapshotRecord): number {
  const json = JSON.stringify(record)
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length * 2
}

/**
 * The record trimmed to fit `maxBytes` (oldest cached slots dropped first,
 * then the last feed shortened), or null when even the core does not fit.
 */
export function fitSnapshot(record: SnapshotRecord, maxBytes: number = SNAPSHOT_MAX_BYTES): SnapshotRecord | null {
  let r = record
  if (snapshotSize(r) <= maxBytes) return r
  const shrinkers: Array<() => boolean> = [
    () => { if (r.feeds.length <= 1) return false; r = { ...r, feeds: r.feeds.slice(0, -1) }; return true },
    () => { if (r.dailyTotals.length === 0) return false; r = { ...r, dailyTotals: r.dailyTotals.slice(0, -1) }; return true },
    () => { if (r.yearlyTotals.length === 0) return false; r = { ...r, yearlyTotals: r.yearlyTotals.slice(0, -1) }; return true },
    () => { if (r.stats.length <= 1) return false; r = { ...r, stats: r.stats.slice(0, -1) }; return true },
    () => {
      const feed = r.feeds[0]
      if (!feed || feed.value.length === 0) return false
      const keep = Math.floor(feed.value.length / 2)
      r = { ...r, feeds: keep === 0 ? [] : [{ ...feed, value: feed.value.slice(0, keep), isDone: false }] }
      return true
    },
  ]
  for (const shrink of shrinkers) {
    while (snapshotSize(r) > maxBytes) {
      if (!shrink()) break
    }
    if (snapshotSize(r) <= maxBytes) return r
  }
  return null
}

/** A stored record for `owner` this build understands, else null. */
export function parseSnapshot(raw: unknown, owner: string): SnapshotRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<SnapshotRecord>
  if (r.v !== SNAPSHOT_VERSION || r.owner !== owner || r.key !== snapshotKeyFor(owner)) return null
  if (typeof r.savedAt !== 'number' || typeof r.todayKey !== 'string') return null
  if (!Array.isArray(r.stats) || !Array.isArray(r.feeds) || !Array.isArray(r.dailyTotals) || !Array.isArray(r.yearlyTotals)) {
    return null
  }
  return r as SnapshotRecord
}

export type SnapshotAccess = {
  /** Current user id (Clerk when loaded, else the last-user hint). */
  owner:        string | null
  /** 'clerk' = confirmed by a loaded Clerk session; 'hint' = rn-last-user while Clerk is unavailable. */
  ownerSource:  'clerk' | 'hint' | 'none'
  viewingOther: boolean
  /** Live queries are running (not snapshot-only mode). */
  dataReady:    boolean
}

/** Writes need a Clerk-confirmed owner, own data, and live queries. */
export function canWriteSnapshot(a: SnapshotAccess): a is SnapshotAccess & { owner: string } {
  return a.owner !== null && a.ownerSource === 'clerk' && !a.viewingOther && a.dataReady
}

/** The record if it may be shown for `a` (same owner, not view-as), else null. */
export function readableSnapshot(record: SnapshotRecord | null, a: SnapshotAccess): SnapshotRecord | null {
  if (!record || a.viewingOther || a.owner === null || record.owner !== a.owner) return null
  return record
}

export function isStaleDay(record: SnapshotRecord, now: number = Date.now()): boolean {
  return record.todayKey !== toLocalDateKey(now)
}

// ── lookups used by the data hooks ─────────────────────────────────────────

export function statsFromSnapshot(record: SnapshotRecord, ranges: StatsRanges): StatsSlot | null {
  const key = statsKey(ranges)
  return record.stats.find((s) => s.key === key) ?? null
}

/**
 * Newest stats saved for the "current" period (todayStart = that save's day),
 * for the stale-day view: the caller shows today's fields as "—" and only
 * trusts week/month when the period is unchanged.
 */
export function latestCurrentStats(record: SnapshotRecord): StatsSlot | null {
  for (const s of record.stats) {
    if (toLocalDateKey(s.ranges.todayStart) === toLocalDateKey(s.savedAt)) return s
  }
  return null
}

const HIGH = '￿'

/**
 * Snapshot feed days for [startDate, endDate] (null = unbounded): the exact
 * cached range, or a cached range whose loaded days fully cover the request
 * (filtered by date). `complete` = every day of the range is present.
 */
export function feedFromSnapshot(
  record: SnapshotRecord,
  startDate: number | null,
  endDate: number | null,
): { entries: DayFeedEntry[]; complete: boolean; savedAt: number } | null {
  const exact = record.feeds.find((f) => f.key === feedKey(startDate, endDate))
  if (exact) return { entries: exact.value, complete: exact.isDone, savedAt: exact.savedAt }
  const reqStart = startDate === null ? '' : toLocalDateKey(startDate)
  const reqEnd = endDate === null ? HIGH : toLocalDateKey(endDate)
  for (const f of record.feeds) {
    const oldest = f.value.length > 0 ? f.value[f.value.length - 1]!.date : null
    const covStart = f.isDone ? (f.startDate === null ? '' : toLocalDateKey(f.startDate)) : oldest
    if (covStart === null) continue
    const covEnd = f.endDate === null ? HIGH : toLocalDateKey(f.endDate)
    if (covStart <= reqStart && reqEnd <= covEnd) {
      return {
        entries: f.value.filter((e) => e.date >= reqStart && e.date <= reqEnd),
        complete: true,
        savedAt: f.savedAt,
      }
    }
  }
  return null
}

export function keyedFromSnapshot<T>(slots: readonly KeyedSlot<T>[], key: string): KeyedSlot<T> | null {
  return slots.find((s) => s.key === key) ?? null
}

// ── persistence + in-memory store ──────────────────────────────────────────

export interface SnapshotIO {
  read(owner: string): Promise<SnapshotRecord | null>
  write(record: SnapshotRecord): Promise<void>
  remove(owner: string): Promise<void>
}

export const idbSnapshotIO: SnapshotIO = {
  async read(owner) {
    const db = await getDB()
    return parseSnapshot(await db.get('snapshots', snapshotKeyFor(owner)), owner)
  },
  async write(record) {
    const db = await getDB()
    await db.put('snapshots', record)
  },
  async remove(owner) {
    const db = await getDB()
    await db.delete('snapshots', snapshotKeyFor(owner))
  },
}

export type SnapshotStoreState = {
  owner:  string | null
  record: SnapshotRecord | null
  /** The IndexedDB read for `owner` finished (record may still be null). */
  loaded: boolean
}

export type SnapshotStoreOptions = {
  io:          SnapshotIO
  now?:        () => number
  debounceMs?: number
  maxBytes?:   number
  /** Runs the write when the browser is idle (default requestIdleCallback → setTimeout). */
  idle?:       (fn: () => void) => void
}

function patchIdentity(p: SnapshotPatch): [string, string] {
  switch (p.kind) {
    case 'stats': return [`stats:${statsKey(p.ranges)}`, JSON.stringify(p.value)]
    case 'feed': return [`feed:${feedKey(p.startDate, p.endDate)}`, JSON.stringify([p.isDone, p.entries])]
    case 'categories': return ['categories', JSON.stringify(p.value)]
    case 'availableYears': return ['availableYears', JSON.stringify(p.value)]
    case 'dailyTotals': return [`daily:${p.key}`, JSON.stringify(p.value)]
    case 'yearlyTotals': return [`yearly:${p.key}`, JSON.stringify(p.value)]
  }
}

function defaultIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout: 2000 })
  else setTimeout(fn, 0)
}

export function createSnapshotStore(options: SnapshotStoreOptions) {
  const { io, now = () => Date.now(), debounceMs = SNAPSHOT_DEBOUNCE_MS, maxBytes = SNAPSHOT_MAX_BYTES, idle = defaultIdle } = options
  let state: SnapshotStoreState = { owner: null, record: null, loaded: false }
  /** Latest record including unflushed patches (published on flush). */
  let working: SnapshotRecord | null = null
  let loadPromise: Promise<SnapshotRecord | null> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Last payload per slot, so unchanged live results don't rewrite the record. */
  const lastPayload = new Map<string, string>()
  const listeners = new Set<() => void>()

  const publish = (next: SnapshotStoreState) => {
    state = next
    for (const l of [...listeners]) l()
  }

  const switchOwner = (owner: string | null) => {
    if (state.owner === owner) return
    if (timer) { clearTimeout(timer); timer = null }
    working = null
    loadPromise = null
    lastPayload.clear()
    publish({ owner, record: null, loaded: owner === null })
  }

  function load(owner: string): Promise<SnapshotRecord | null> {
    switchOwner(owner)
    if (loadPromise) return loadPromise
    const p = io.read(owner).catch(() => null).then((record) => {
      if (state.owner !== owner) return null
      // Live patches made while reading are fresher: keep them.
      if (working) {
        if (!state.loaded) publish({ ...state, loaded: true })
        return working
      }
      working = record
      publish({ owner, record, loaded: true })
      return record
    })
    loadPromise = p
    return p
  }

  async function flush(): Promise<void> {
    const record = working
    if (!record) return
    const fitted = fitSnapshot(record, maxBytes)
    if (!fitted || state.owner !== record.owner) return
    publish({ owner: record.owner, record: fitted, loaded: true })
    try {
      await io.write(fitted)
    } catch {
      // Storage full / unavailable: the in-memory copy still serves this page.
    }
  }

  function patch(owner: string, p: SnapshotPatch): void {
    switchOwner(owner)
    const [slot, payload] = patchIdentity(p)
    if (lastPayload.get(slot) === payload) return
    lastPayload.set(slot, payload)
    const base = working ?? state.record ?? emptySnapshot(owner, now())
    working = applySnapshotPatch(base, p, now())
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      idle(() => { void flush() })
    }, debounceMs)
  }

  async function clear(owner: string): Promise<void> {
    if (state.owner === owner) {
      if (timer) { clearTimeout(timer); timer = null }
      working = null
      loadPromise = null
      lastPayload.clear()
      publish({ owner, record: null, loaded: true })
    }
    try {
      await io.remove(owner)
    } catch { /* ignore */ }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load,
    patch,
    clear,
    /** Write pending patches now (tests, pagehide). */
    flushNow: async () => {
      if (timer) { clearTimeout(timer); timer = null }
      await flush()
    },
  }
}

export type SnapshotStore = ReturnType<typeof createSnapshotStore>

/** The app-wide snapshot store (IndexedDB). */
export const snapshotStore: SnapshotStore = createSnapshotStore({ io: idbSnapshotIO })

/**
 * Start reading `userId`'s snapshot before React renders (main.tsx). Resolves
 * with the record, or null after `timeoutMs` (the read continues and the
 * SnapshotProvider picks it up when it lands).
 */
export function preloadSnapshot(userId: string | null | undefined, timeoutMs = 300): Promise<SnapshotRecord | null> {
  if (!userId) return Promise.resolve(null)
  const read = snapshotStore.load(userId)
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs)
    void read.then((r) => { clearTimeout(t); resolve(r) })
  })
}

/** Remove a user's snapshot (call only on a confirmed online sign-out). */
export function clearSnapshot(userId: string): Promise<void> {
  return snapshotStore.clear(userId)
}
