import { useEffect, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  getClientTimeZone,
  toLocalDateKey,
} from '@/lib/utils'
import { useViewAsQueryPatch } from './viewAsPatch'
import { useLiveQueriesEnabled, usePendingOverlay, useSnapshotAccess, useSnapshotWriter } from './offlineData'
import type { StatsRanges } from '@/lib/period'
import { PERF_MARKS, perfMark } from '@/lib/perf'
import {
  keyedFromSnapshot,
  latestCurrentStats,
  rangeKey,
  statsFromSnapshot,
  type SnapshotPatch,
} from '@/lib/offline/snapshot'
import {
  applyPendingToDailyTotals,
  applyPendingToStats,
  applyPendingToYearlyTotals,
} from '@/lib/offline/overlay'
import type { Id } from '../../convex/_generated/dataModel'

export type SaleItem = {
  _id:         Id<'sales'>
  userId:      Id<'users'>
  sessionId:   Id<'saleSessions'>
  categoryId?: Id<'categories'>
  productName: string
  amount:      number
  note?:       string
  saleDate:    number
  createdAt:   number
}

export type SaleSession = {
  _id:         Id<'saleSessions'>
  userId:      Id<'users'>
  totalAmount: number
  itemCount:   number
  sessionDate: number
  createdAt:   number
  items:       SaleItem[]
}

export type DailyTotal = {
  date:  string
  total: number
}

export type YearlyMonthlyTotal = {
  monthIndex: number
  salesTotal: number
  netTotal: number
}

export type DashboardStats = {
  todayTotal:      number
  todaySalesTotal: number
  todayNetTotal:   number
  todayCount:      number
  todayExpenseTotal: number
  todayExpenseCount: number
  weekTotal:       number
  weekCount:       number
  monthTotal:      number
  monthCount:      number
  allTimeTotal:    number
  allTimeCount:    number
  allTimeSalesTotal: number
  allTimeExpenseTotal: number
  topCategoryName: string | null
}

export type CategorySalesCount = {
  categoryId: Id<'categories'>
  count:      number
}

/** Where a hook's data came from. */
export type DataSource = 'live' | 'snapshot' | 'none'

/** Number of sale line items per category (for manage categories UI) */
export function useSalesCountsByCategory(): CategorySalesCount[] | undefined {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  return useQuery(api.sales.getCountsByCategory, ready ? { ...va } : 'skip') as CategorySalesCount[] | undefined
}

/**
 * Daily totals (sales − expenses) for whole local days in [startDate, endDate]:
 * live, else the snapshot; pending outbox entries added to their days.
 */
function useDailyTotals(startDate: number, endDate: number): DailyTotal[] | undefined {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  const live = useQuery(api.saleSessions.getDailyTotals, ready ? {
    startDate,
    endDate,
    timeZone: getClientTimeZone(),
    ...va,
  } : 'skip') as DailyTotal[] | undefined
  const snap = useSnapshotAccess()
  const pending = usePendingOverlay()
  const key = rangeKey([startDate, endDate])

  const patch = useMemo(
    (): SnapshotPatch | null => (live !== undefined ? { kind: 'dailyTotals', key, value: live } : null),
    [live, key],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)

  const base = live ?? (snap.record ? keyedFromSnapshot(snap.record.dailyTotals, key)?.value : undefined)
  return useMemo(() => (base ? applyPendingToDailyTotals(base, pending) : undefined), [base, pending])
}

/** Daily totals for the Monday–Sunday week containing `weekMs`. */
export function useWeeklyTotals(weekMs: number): DailyTotal[] | undefined {
  const d = new Date(weekMs)
  return useDailyTotals(startOfWeek(d), endOfWeek(d))
}

/** Daily totals for the month containing `monthMs`. */
export function useMonthlyTotals(monthMs: number): DailyTotal[] | undefined {
  const d = new Date(monthMs)
  return useDailyTotals(startOfMonth(d), endOfMonth(d))
}

/** Get monthly totals for a specific year (for yearly chart). */
export function useYearlyMonthlyTotals(year: number): YearlyMonthlyTotal[] | undefined {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  const live = useQuery(api.saleSessions.getYearlyMonthlyTotals, ready ? {
    year,
    timeZone: getClientTimeZone(),
    ...va,
  } : 'skip') as YearlyMonthlyTotal[] | undefined
  const snap = useSnapshotAccess()
  const pending = usePendingOverlay()
  const key = rangeKey([year])

  const patch = useMemo(
    (): SnapshotPatch | null => (live !== undefined ? { kind: 'yearlyTotals', key, value: live } : null),
    [live, key],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)

  const base = live ?? (snap.record ? keyedFromSnapshot(snap.record.yearlyTotals, key)?.value : undefined)
  return useMemo(() => (base ? applyPendingToYearlyTotals(base, year, pending) : undefined), [base, year, pending])
}

/** Get available years for yearly chart picker (live, else the snapshot). */
export function useAvailableYears(): number[] | undefined {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  const live = useQuery(api.saleSessions.getAvailableYears, ready ? {
    timeZone: getClientTimeZone(),
    ...va,
  } : 'skip') as number[] | undefined
  const snap = useSnapshotAccess()
  const patch = useMemo(
    (): SnapshotPatch | null => (live !== undefined ? { kind: 'availableYears', value: live } : null),
    [live],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)
  return live ?? snap.record?.availableYears ?? undefined
}

function currentRanges(): StatsRanges {
  return {
    todayStart:  startOfDay(),
    todayEnd:    endOfDay(),
    weekStart:   startOfWeek(),
    weekEnd:     endOfWeek(),
    monthStart:  startOfMonth(),
    monthEnd:    endOfMonth(),
  }
}

export type DashboardStatsState = {
  /** Stats with pending outbox entries added; undefined while nothing is available. */
  stats:      DashboardStats | undefined
  source:     DataSource
  /** When the snapshot data was saved (source 'snapshot'), else null. */
  savedAt:    number | null
  /**
   * Snapshot from an earlier day shown for the current period: these fields
   * are NOT for the requested period — render them as "—" (+ "Last updated …").
   */
  staleToday: boolean
  staleWeek:  boolean
  staleMonth: boolean
}

/**
 * Dashboard stats with offline support: live, else the snapshot for the same
 * ranges, else (current period only) the newest snapshot of an earlier day
 * flagged `stale*`. Pending outbox entries are added for the periods they fall in.
 */
export function useDashboardStatsState(ranges?: StatsRanges): DashboardStatsState {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  const fallback = currentRanges()
  const r = ranges ?? fallback
  const { todayStart, todayEnd, weekStart, weekEnd, monthStart, monthEnd } = r
  const stableRanges = useMemo(
    (): StatsRanges => ({ todayStart, todayEnd, weekStart, weekEnd, monthStart, monthEnd }),
    [todayStart, todayEnd, weekStart, weekEnd, monthStart, monthEnd],
  )
  const live = useQuery(api.saleSessions.getStats, ready ? {
    ...stableRanges,
    timeZone: getClientTimeZone(),
    ...va,
  } : 'skip') as DashboardStats | undefined
  const snap = useSnapshotAccess()
  const pending = usePendingOverlay()

  const patch = useMemo(
    (): SnapshotPatch | null => (live !== undefined ? { kind: 'stats', ranges: stableRanges, value: live } : null),
    [live, stableRanges],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)

  const isCurrent = todayStart === fallback.todayStart
  const exact = live === undefined && snap.record ? statsFromSnapshot(snap.record, stableRanges) : null
  const stale = live === undefined && !exact && isCurrent && snap.record ? latestCurrentStats(snap.record) : null

  const source: DataSource = live !== undefined ? 'live' : exact || stale ? 'snapshot' : 'none'
  useEffect(() => {
    if (source === 'live') perfMark(PERF_MARKS.firstDataLive)
    else if (source === 'snapshot') perfMark(PERF_MARKS.firstDataSnapshot)
  }, [source])

  const base = live ?? exact?.value ?? stale?.value
  // Cheap; returns `base` itself when nothing is pending.
  const stats = base ? applyPendingToStats(base, stableRanges, pending) : undefined
  const staleSlot = stale && !exact ? stale : null
  return {
    stats,
    source,
    savedAt: live === undefined ? (exact ?? stale)?.savedAt ?? null : null,
    staleToday: staleSlot !== null && toLocalDateKey(staleSlot.ranges.todayStart) !== toLocalDateKey(todayStart),
    staleWeek:  staleSlot !== null && staleSlot.ranges.weekStart !== weekStart,
    staleMonth: staleSlot !== null && staleSlot.ranges.monthStart !== monthStart,
  }
}

/**
 * Dashboard summary stats. `ranges` picks the "today" / week / month windows
 * (whole local days — see `statsRangesForDay`); default = the current ones.
 * Live, else a snapshot of the same ranges; pending outbox entries included.
 * (A stale-day snapshot is not returned here — use `useDashboardStatsState`.)
 */
export function useDashboardStats(ranges?: StatsRanges): DashboardStats | undefined {
  const s = useDashboardStatsState(ranges)
  return s.staleToday || s.staleWeek || s.staleMonth ? undefined : s.stats
}

/** Record a new sale session atomically (direct; new UI should use `useSubmitEntry`). */
export function useRecordSales() {
  return useMutation(api.saleSessions.record)
}

/** Update a single sale item */
export function useUpdateSaleItem() {
  return useMutation(api.sales.updateItem)
}

/** Delete a single sale item */
export function useDeleteSaleItem() {
  return useMutation(api.sales.removeItem)
}
