import type { DailyTotal, DashboardStats, YearlyMonthlyTotal } from '@/hooks/useSales'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { Category } from '@/hooks/useCategories'
import type { StatsRanges } from '@/lib/period'

export const SNAPSHOT_VERSION = 1

/** One cached query result, keyed by its args. Newest first in its list. */
export type KeyedSlot<T> = { key: string; value: T; savedAt: number }

export type StatsSlot = KeyedSlot<DashboardStats> & { ranges: StatsRanges }

/** First loaded page(s) of a day feed. `startDate`/`endDate` null = all time. */
export type FeedSlot = KeyedSlot<DayFeedEntry[]> & {
  startDate: number | null
  endDate:   number | null
  /** The live feed was exhausted: `value` holds every day of the range. */
  isDone:    boolean
}

/**
 * Instant-open snapshot of the signed-in user's own dashboard data
 * (IndexedDB `snapshots`, key `${owner}:dashboard`).
 */
export type SnapshotRecord = {
  key:            string
  v:              typeof SNAPSHOT_VERSION
  owner:          string
  savedAt:        number
  tz:             string
  /** Local day (YYYY-MM-DD) when last saved; differs from today → "stale day". */
  todayKey:       string
  stats:          StatsSlot[]
  feeds:          FeedSlot[]
  categories:     Category[] | null
  availableYears: number[] | null
  dailyTotals:    KeyedSlot<DailyTotal[]>[]
  yearlyTotals:   KeyedSlot<YearlyMonthlyTotal[]>[]
}

export const snapshotKeyFor = (owner: string) => `${owner}:dashboard`
