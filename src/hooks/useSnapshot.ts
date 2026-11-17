import { useContext } from 'react'
import { SnapshotContext, type OwnerSource } from '@/lib/offline/context'
import { isStaleDay } from '@/lib/offline/snapshot'
import type { SnapshotRecord } from '@/lib/offline/snapshotTypes'
import { useLiveQueriesEnabled } from './offlineData'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'

export type SnapshotInfo = {
  /** Own snapshot for the current user (null in view-as / none saved / other owner). */
  snapshot:    SnapshotRecord | null
  owner:       string | null
  ownerSource: OwnerSource
  /** IndexedDB read finished. */
  loaded:      boolean
  /** Live queries are running (false in snapshot-only mode). */
  live:        boolean
  savedAt:     number | null
  /** Saved on an earlier local day: today's numbers are not today's. */
  isStaleDay:  boolean
}

/** The instant-open snapshot as seen by the current screen. */
export function useSnapshot(): SnapshotInfo {
  const ctx = useContext(SnapshotContext)
  const live = useLiveQueriesEnabled()
  const viewingOther = useViewAsUserIdForQuery() !== undefined
  const snapshot = !viewingOther && ctx?.record && ctx.record.owner === ctx.owner ? ctx.record : null
  return {
    snapshot,
    owner:       ctx?.owner ?? null,
    ownerSource: ctx?.ownerSource ?? 'none',
    loaded:      ctx?.loaded ?? true,
    live,
    savedAt:     snapshot?.savedAt ?? null,
    isStaleDay:  snapshot ? isStaleDay(snapshot) : false,
  }
}
