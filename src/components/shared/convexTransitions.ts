/**
 * Why this exists (verified against convex@1.x `src/browser/sync`):
 * when the last `useQuery` subscriber of a query unmounts, the client drops the
 * subscription at once (`LocalSyncState.removeSubscriber`), but the last result
 * — including a thrown error — stays in `OptimisticQueryResults` keyed by the
 * query token until the next server message (Transition / MutationResponse)
 * rebuilds that map from the live subscriptions. `localQueryResult` does not
 * check the subscription, so remounting the same query before then re-throws
 * the cached error without refetching.
 *
 * `subscribeToTransitions` lets an error boundary wait for that rebuild. It
 * uses `BaseConvexClient.addOnTransitionHandler` (public on that class) via the
 * React client's `sync` getter (marked @internal), duck-typed: returns null if
 * the shape is not there, so callers fall back to a timer.
 */
type TransitionSource = {
  addOnTransitionHandler: (fn: () => void) => unknown
}

function isTransitionSource(value: unknown): value is TransitionSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { addOnTransitionHandler?: unknown }).addOnTransitionHandler === 'function'
  )
}

/** Calls `onTransition` after each client transition; returns an unsubscribe, or null if unsupported. */
export function subscribeToTransitions(client: unknown, onTransition: () => void): (() => void) | null {
  if (typeof client !== 'object' || client === null) return null
  let sync: unknown
  try {
    sync = (client as { sync?: unknown }).sync
  } catch {
    return null // closed client
  }
  if (!isTransitionSource(sync)) return null
  const off = sync.addOnTransitionHandler(() => onTransition())
  if (typeof off !== 'function') return null
  const unsubscribe = off as () => unknown
  return () => {
    unsubscribe()
  }
}
