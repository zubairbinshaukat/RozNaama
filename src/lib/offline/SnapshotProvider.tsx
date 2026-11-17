import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useOfflineOwner } from '@/hooks/useOfflineOwner'
import { SnapshotContext, type SnapshotContextValue } from './context'
import { snapshotStore } from './snapshot'

/**
 * Provides the current owner's instant-open snapshot to the data hooks.
 * Mount inside ClerkProvider + ConvexProvider (above the routes). Without it
 * the hooks behave exactly as before (live only, nothing saved).
 */
export default function SnapshotProvider({ children }: { children: ReactNode }) {
  const { owner, source } = useOfflineOwner()
  const state = useSyncExternalStore(snapshotStore.subscribe, snapshotStore.getState, snapshotStore.getState)

  useEffect(() => {
    if (owner) void snapshotStore.load(owner)
  }, [owner])

  const sameOwner = owner !== null && state.owner === owner
  const record = sameOwner && state.record?.owner === owner ? state.record : null
  const loaded = sameOwner && state.loaded

  const value = useMemo(
    (): SnapshotContextValue => ({ owner, ownerSource: source, record, loaded }),
    [owner, source, record, loaded],
  )
  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>
}
