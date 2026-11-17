import type { SnapshotContextValue } from '@/lib/offline/context'

/** Whether an instant-open snapshot can be shown right now. */
export type SnapshotAvailability = 'available' | 'loading' | 'none'

/**
 * Snapshot of the current offline owner, never one whose owner differs from a
 * loaded Clerk user (`clerkUserId`). `loading` while IndexedDB is still read.
 */
export function snapshotAvailability(
  ctx: Pick<SnapshotContextValue, 'owner' | 'record' | 'loaded'> | null,
  clerkUserId: string | null,
): SnapshotAvailability {
  if (!ctx || ctx.owner === null) return 'none'
  if (clerkUserId !== null && ctx.owner !== clerkUserId) return 'none'
  if (ctx.record && ctx.record.owner === ctx.owner) return 'available'
  return ctx.loaded ? 'none' : 'loading'
}

export type GuardInput = {
  isLoaded:            boolean
  isSignedIn:          boolean | undefined
  browserOnline:       boolean
  /** clerk-js failed to load, or took longer than the give-up timeout. */
  clerkFailed:         boolean
  convexAuthenticated: boolean
  syncStatus:          'idle' | 'syncing' | 'ready' | 'error'
  alreadySynced:       boolean
  snapshot:            SnapshotAvailability
}

export type GuardView =
  | 'loading-signin'
  | 'loading-connecting'
  | 'loading-setup'
  | 'offline'
  | 'redirect'
  | 'sync-error'
  /** Dashboard from the snapshot; live queries off (DataReadyProvider mode="snapshot"). */
  | 'snapshot'
  /** Same, while Clerk says signed out but cannot confirm it offline. */
  | 'snapshot-signed-out'
  | 'ready'

/**
 * ProtectedRoute's startup state machine (OFFLINE-PLAN §2):
 * 1. Clerk not loaded + snapshot → snapshot mode at once (instant open);
 *    no snapshot and offline / Clerk failed / slow → offline screen + Retry.
 * 2. Signed out → /sign-in, except offline (cannot be confirmed): snapshot
 *    mode with a note when there is a snapshot, else the offline screen.
 * 3. Signed in, Convex auth pending → keep showing the snapshot when there is
 *    one (no spinner flash), else "Connecting…" / offline screen.
 * 4. User sync error → error screen; first sync on this device blocks.
 */
export function decideGuard(i: GuardInput): GuardView {
  const waitingForSnapshot = i.snapshot === 'loading'
  if (!i.isLoaded) {
    if (i.snapshot === 'available') return 'snapshot'
    if ((!i.browserOnline || i.clerkFailed) && !waitingForSnapshot) return 'offline'
    return 'loading-signin'
  }
  if (!i.isSignedIn) {
    if (i.browserOnline) return 'redirect'
    if (i.snapshot === 'available') return 'snapshot-signed-out'
    return waitingForSnapshot ? 'loading-signin' : 'offline'
  }
  if (!i.convexAuthenticated) {
    if (i.snapshot === 'available') return 'snapshot'
    if (!i.browserOnline && !waitingForSnapshot) return 'offline'
    return 'loading-connecting'
  }
  if (i.syncStatus === 'error') return 'sync-error'
  if (i.syncStatus !== 'ready' && !i.alreadySynced) return 'loading-setup'
  return 'ready'
}
