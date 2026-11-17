/**
 * Shared plumbing for the data hooks: the DataReady gate, snapshot read/write
 * access and the pending-entry overlay. Everything degrades to "live only,
 * nothing saved, no overlay" outside the offline providers.
 */
import { useCallback, useContext, useEffect } from 'react'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { DataReadyContext, OutboxContext, SnapshotContext } from '@/lib/offline/context'
import { canWriteSnapshot, readableSnapshot, snapshotStore, type SnapshotPatch } from '@/lib/offline/snapshot'
import type { SnapshotRecord } from '@/lib/offline/snapshotTypes'
import type { OutboxEntry } from '@/lib/offline/types'

/** False in snapshot-only mode: pass 'skip' to live queries. */
export function useLiveQueriesEnabled(): boolean {
  return useContext(DataReadyContext) === 'ready'
}

export type SnapshotAccessResult = {
  /** Readable snapshot (own data, owner-checked, not in view-as), or null. */
  record:   SnapshotRecord | null
  /** Snapshot read finished (or there is nothing to read). */
  loaded:   boolean
  canWrite: boolean
  /** Save live data (no-op unless `canWrite`). */
  write:    (patch: SnapshotPatch) => void
}

export function useSnapshotAccess(): SnapshotAccessResult {
  const ctx = useContext(SnapshotContext)
  const viewingOther = useViewAsUserIdForQuery() !== undefined
  const dataReady = useLiveQueriesEnabled()
  const access = {
    owner:        ctx?.owner ?? null,
    ownerSource:  ctx?.ownerSource ?? 'none',
    viewingOther,
    dataReady,
  } as const
  const record = readableSnapshot(ctx?.record ?? null, access)
  const canWrite = ctx !== null && canWriteSnapshot(access)
  const owner = access.owner
  const write = useCallback(
    (patch: SnapshotPatch) => {
      if (canWrite && owner) snapshotStore.patch(owner, patch)
    },
    [canWrite, owner],
  )
  return { record, loaded: ctx === null || ctx.owner === null || ctx.loaded || viewingOther, canWrite, write }
}

/**
 * Write `patch` to the snapshot whenever it changes. Pass null while the
 * live result is not loaded (never pass snapshot-derived data).
 */
export function useSnapshotWriter(patch: SnapshotPatch | null, write: (p: SnapshotPatch) => void): void {
  useEffect(() => {
    if (patch) write(patch)
  }, [patch, write])
}

const EMPTY: readonly OutboxEntry[] = []

/** Pending outbox entries to overlay on the current owner's own data ([] in view-as). */
export function usePendingOverlay(): readonly OutboxEntry[] {
  const ctx = useContext(OutboxContext)
  const viewingOther = useViewAsUserIdForQuery() !== undefined
  if (viewingOther || !ctx?.state) return EMPTY
  return ctx.state.entries
}
