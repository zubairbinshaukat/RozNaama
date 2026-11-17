import { useEffect, useSyncExternalStore } from 'react'
import { useNetworkStatus } from '@/lib/network'
import { formatDate, formatTime, isSameLocalDay } from '@/lib/utils'
import { useSnapshot } from './useSnapshot'

// Last moment this page had live data (module-wide; ticks every minute while live).
let lastLiveAt: number | null = null
const clockListeners = new Set<() => void>()
const subscribeClock = (l: () => void) => {
  clockListeners.add(l)
  return () => { clockListeners.delete(l) }
}
const getLastLiveAt = () => lastLiveAt
function markLive(): void {
  lastLiveAt = Date.now()
  for (const l of [...clockListeners]) l()
}
const currentTime = () => Date.now()

export type FreshnessMode =
  /** Live queries connected. */
  | 'live'
  /** Connection dropped: showing the last live data (+ snapshot). */
  | 'offline'
  /** Snapshot-only mode (before / without auth). */
  | 'snapshot'

export type DataFreshness = {
  mode:       FreshnessMode
  /** When the shown data was last known fresh (null while live). */
  updatedAt:  number | null
  /** `updatedAt` is from an earlier local day: render today's fields as "—". */
  isStaleDay: boolean
  /** "Last updated 2:45 PM" / "Last updated Yesterday, 2:45 PM" / null while live. */
  label:      string | null
}

/** "Last updated …" text for a timestamp (relative to `now`). */
export function lastUpdatedLabel(at: number, now: number = Date.now()): string {
  if (now - at < 60_000) return 'Last updated just now'
  if (isSameLocalDay(at, now)) return `Last updated ${formatTime(at)}`
  return `Last updated ${formatDate(at)}, ${formatTime(at)}`
}

/** Freshness of the dashboard data, for the DataFreshness chip. */
export function useDataFreshness(): DataFreshness {
  const { isOffline } = useNetworkStatus()
  const { live, savedAt } = useSnapshot()
  const liveAt = useSyncExternalStore(subscribeClock, getLastLiveAt, getLastLiveAt)
  const mode: FreshnessMode = !live ? 'snapshot' : isOffline ? 'offline' : 'live'

  useEffect(() => {
    if (mode !== 'live') return
    markLive()
    const timer = setInterval(markLive, 60_000)
    return () => {
      clearInterval(timer)
      markLive()
    }
  }, [mode])

  if (mode === 'live') return { mode, updatedAt: null, isStaleDay: false, label: null }
  const candidates = [savedAt, mode === 'offline' ? liveAt : null].filter((t): t is number => t !== null)
  const updatedAt = candidates.length > 0 ? Math.max(...candidates) : null
  const now = currentTime()
  return {
    mode,
    updatedAt,
    isStaleDay: updatedAt !== null && !isSameLocalDay(updatedAt, now),
    label: updatedAt !== null ? lastUpdatedLabel(updatedAt, now) : null,
  }
}
