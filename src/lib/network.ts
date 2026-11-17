import { useEffect, useState, useSyncExternalStore } from 'react'
import { useConvexConnectionState } from 'convex/react'

/** A connection drop must last this long before the app calls itself offline. */
export const OFFLINE_DEBOUNCE_MS = 2000

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getBrowserOnline = () => navigator.onLine
// Server render / prerender: assume online.
const getServerOnline = () => true

/** Raw `navigator.onLine`, kept live via `online` / `offline` events. No Convex dependency. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getBrowserOnline, getServerOnline)
}

export interface ConvexLinkState {
  isWebSocketConnected: boolean
  hasEverConnected: boolean
}

/**
 * True when the app should treat itself as offline: the browser says so, or
 * the Convex WebSocket dropped after having connected once. (Before the first
 * connect we trust `navigator.onLine`, so a slow first handshake is not "offline".)
 */
export function isConnectionDown(browserOnline: boolean, convex: ConvexLinkState): boolean {
  if (!browserOnline) return true
  return convex.hasEverConnected && !convex.isWebSocketConnected
}

export interface NetworkStatus {
  /** Debounced: down for at least OFFLINE_DEBOUNCE_MS. Recovers immediately. */
  isOffline: boolean
  /** Raw navigator.onLine (not debounced). */
  browserOnline: boolean
}

/**
 * Network status for UI (offline banner, WP-B outbox triggers).
 * Must be rendered under ConvexProvider.
 */
export function useNetworkStatus(): NetworkStatus {
  const browserOnline = useBrowserOnline()
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState()
  const down = isConnectionDown(browserOnline, { isWebSocketConnected, hasEverConnected })

  const [confirmedDown, setConfirmedDown] = useState(false)
  // Back online → clear at once (state adjustment during render, no effect).
  if (!down && confirmedDown) setConfirmedDown(false)

  useEffect(() => {
    if (!down) return
    const timer = setTimeout(() => setConfirmedDown(true), OFFLINE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [down])

  return { isOffline: down && confirmedDown, browserOnline }
}
