import { useMemo } from 'react'
import { usePaginatedQuery } from 'convex-helpers/react'
import type { UsePaginatedQueryReturnType } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { getClientTimeZone, toLocalDateKey } from '@/lib/utils'
import { useViewAsQueryPatch } from './viewAsPatch'
import { useLiveQueriesEnabled, usePendingOverlay, useSnapshotAccess, useSnapshotWriter } from './offlineData'
import { feedFromSnapshot, type SnapshotPatch } from '@/lib/offline/snapshot'
import { applyPendingToFeed } from '@/lib/offline/overlay'
import type { DataSource } from './useSales'

/** One day of the merged sales + expenses feed, as returned by `saleSessions.getDayFeed`. */
export type DayFeedEntry = FunctionReturnType<typeof api.saleSessions.getDayFeed>['page'][number]

export type DayFeedRange = { startDate: number; endDate: number }

type LiveFeed = UsePaginatedQueryReturnType<typeof api.saleSessions.getDayFeed>

const NO_DAYS: DayFeedEntry[] = []

/**
 * `usePaginatedQuery` result + where the days came from. `results` include
 * pending outbox entries (rows with `isPendingId(_id)`), day totals adjusted.
 */
export type DayFeedResult = LiveFeed & {
  source:  DataSource
  /** Snapshot save time when `source === 'snapshot'`, else null. */
  savedAt: number | null
}

/**
 * Paginated day feed (newest day first). `range` null = all time.
 * Uses convex-helpers' `usePaginatedQuery`, which re-binds loaded pages with
 * `endCursor` so page boundaries stay stable when new days appear.
 *
 * Offline support: until the first live page arrives, days come from the
 * snapshot (status 'Exhausted' when the snapshot covers the whole range, else
 * 'LoadingMore'); pending outbox entries are merged into their days.
 */
export function useDayFeed(range: DayFeedRange | null, daysPerPage = 7): DayFeedResult {
  const va = useViewAsQueryPatch()
  const viewAsUserId = 'viewAsUserId' in va ? va.viewAsUserId : undefined
  const ready = useLiveQueriesEnabled()
  const startDate = range?.startDate
  const endDate = range?.endDate

  const args = useMemo(() => ({
    timeZone: getClientTimeZone(),
    ...(startDate !== undefined && endDate !== undefined ? { startDate, endDate } : {}),
    ...(viewAsUserId !== undefined ? { viewAsUserId } : {}),
  }), [startDate, endDate, viewAsUserId])

  const live = usePaginatedQuery(api.saleSessions.getDayFeed, ready ? args : 'skip', { initialNumItems: daysPerPage })
  const snap = useSnapshotAccess()
  const pending = usePendingOverlay()

  const liveLoaded = live.status !== 'LoadingFirstPage'
  const liveResults = live.results
  const liveDone = live.status === 'Exhausted'
  const s = startDate ?? null
  const e = endDate ?? null

  const patch = useMemo(
    (): SnapshotPatch | null => (liveLoaded
      ? { kind: 'feed', startDate: s, endDate: e, entries: liveResults, isDone: liveDone }
      : null),
    [liveLoaded, liveResults, liveDone, s, e],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)

  const record = snap.record
  const fromSnap = useMemo(
    () => (!liveLoaded && record ? feedFromSnapshot(record, s, e) : null),
    [liveLoaded, record, s, e],
  )
  // Snapshot-only mode with nothing saved: show just the pending entries.
  const emptyOffline = !liveLoaded && !fromSnap && !ready && snap.loaded

  const base = liveLoaded ? liveResults : fromSnap ? fromSnap.entries : emptyOffline ? NO_DAYS : null
  const isDone = liveLoaded ? liveDone : fromSnap ? fromSnap.complete : emptyOffline
  const startKey = s === null ? null : toLocalDateKey(s)
  const endKey = e === null ? null : toLocalDateKey(e)
  const results = useMemo(
    () => (base ? applyPendingToFeed(base, pending, { startKey, endKey, isDone }) : null),
    [base, pending, startKey, endKey, isDone],
  )

  if (liveLoaded) {
    return { ...live, results: results ?? liveResults, source: 'live', savedAt: null } as DayFeedResult
  }
  if (results) {
    const complete = fromSnap ? fromSnap.complete : true
    return {
      results,
      status:   complete ? 'Exhausted' : 'LoadingMore',
      isLoading: !complete,
      loadMore: live.loadMore,
      source:   fromSnap ? 'snapshot' : 'none',
      savedAt:  fromSnap?.savedAt ?? null,
    } as DayFeedResult
  }
  return { ...live, source: 'none', savedAt: null } as DayFeedResult
}
