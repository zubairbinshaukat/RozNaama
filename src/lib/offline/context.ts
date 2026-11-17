import { createContext } from 'react'
import type { OutboxEngine, OutboxEngineState } from './outboxEngine'
import type { SnapshotRecord } from './snapshotTypes'

/**
 * Data-ready gate. 'ready' (default) = data hooks run live Convex queries.
 * 'snapshot' = hooks skip live queries and serve the IndexedDB snapshot only
 * (ProtectedRoute's offline / Clerk-unavailable mode).
 */
export type DataReadyMode = 'ready' | 'snapshot'
export const DataReadyContext = createContext<DataReadyMode>('ready')

export type OwnerSource = 'clerk' | 'hint' | 'none'

export type SnapshotContextValue = {
  owner:       string | null
  ownerSource: OwnerSource
  /** Snapshot of `owner` (never another user's), or null. */
  record:      SnapshotRecord | null
  /** The IndexedDB read for `owner` has finished. */
  loaded:      boolean
}
export const SnapshotContext = createContext<SnapshotContextValue | null>(null)

export type OutboxContextValue = {
  owner:       string | null
  ownerSource: OwnerSource
  engine:      OutboxEngine | null
  state:       OutboxEngineState | null
}
export const OutboxContext = createContext<OutboxContextValue | null>(null)
