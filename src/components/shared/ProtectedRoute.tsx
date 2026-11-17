import { useContext, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, useClerk, useUser } from '@clerk/clerk-react'
import { useConvexAuth, useMutation } from 'convex/react'
import { AlertCircle, RotateCw, ShieldCheck, WifiOff } from 'lucide-react'
import DataReadyProvider from '@/lib/offline/DataReadyProvider'
import { SnapshotContext } from '@/lib/offline/context'
import { decideGuard, snapshotAvailability } from './guardDecision'
import { api } from '../../../convex/_generated/api'
import { getErrorMessage } from '@/lib/errors'
import { USER_SYNC_RETRY_DELAYS_MS } from '@/lib/retry'
import { isPermanentSyncError, retryTransient } from './syncRetry'
import { getClientTimeZone } from '@/lib/utils'
import { useBrowserOnline } from '@/lib/network'
import { PERF_MARKS, perfMark } from '@/lib/perf'
import { clearUserSynced, isUserSynced, markUserSynced } from '@/lib/userHints'
import LoadingScreen from './LoadingScreen'

interface ProtectedRouteProps {
  children: React.ReactNode
}

/** Clerk still not loaded after this long → stop spinning, offer Retry. */
const CLERK_LOAD_GIVE_UP_MS = 8000

type SyncStatus = 'idle' | 'syncing' | 'ready' | 'error'

type SyncResult = {
  /** Clerk user id the result belongs to */
  userId: string
  status: 'ready' | 'error'
  error?: unknown
}

function SyncErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background gap-5 px-6 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="text-negative" size={24} />
      </div>
      <div className="flex flex-col gap-1.5 max-w-sm">
        <p className="text-base font-semibold text-foreground">We couldn&apos;t set up your account</p>
        <p className="text-sm text-muted-foreground">
          {getErrorMessage(error, 'Please check your connection and try again.')}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 min-h-12 px-5 rounded-2xl text-base font-semibold bg-gradient-brand text-brand-foreground hover:brightness-105 active:scale-[0.97] transition-all"
      >
        <RotateCw size={18} />
        Retry
      </button>
    </div>
  )
}

function OfflineScreen({ browserOnline }: { browserOnline: boolean }) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background gap-5 px-6 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="text-muted-foreground" size={24} />
      </div>
      <div className="flex flex-col gap-1.5 max-w-sm">
        <p className="text-base font-semibold text-foreground">
          {browserOnline ? 'Can’t connect right now.' : 'You’re offline.'}
        </p>
        <p className="text-sm text-muted-foreground">
          {browserOnline
            ? 'Check your internet connection and try again.'
            : 'Connect to the internet to sign in.'}
        </p>
      </div>
      <button
        type="button"
        // A full reload re-runs the clerk-js script load (Clerk does not retry a failed load itself).
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 min-h-12 px-5 rounded-2xl text-base font-semibold bg-gradient-brand text-brand-foreground hover:brightness-105 active:scale-[0.97] transition-all"
      >
        <RotateCw size={18} />
        Retry
      </button>
    </div>
  )
}

/**
 * Route guard / startup state machine (decision table: `decideGuard`).
 * Snapshot mode: while the session can't be confirmed yet (Clerk loading /
 * offline / Convex auth pending) and this phone has the last user's snapshot,
 * children render at once with `DataReadyProvider mode="snapshot"` (no live
 * queries). Otherwise:
 * 1. Clerk not loaded → branded loading screen; if offline, clerk-js failed to
 *    load, or it takes longer than CLERK_LOAD_GIVE_UP_MS → offline screen + Retry
 *    (never an endless spinner).
 * 2. Signed out → /sign-in, except while offline (Clerk cannot confirm a
 *    sign-out without the network) → offline screen.
 * 3. Waits for Convex to receive the auth token (avoids Unauthorized on first load).
 * 4. Upserts the user record once per Clerk user (transient failures retried with
 *    backoff; server ConvexErrors such as FORBIDDEN are final):
 *    - first time on this device: blocking — children stay unmounted until it
 *      succeeds (fixes the first-login race where queries ran before the `users`
 *      row existed); success sets `rn-user-synced:<clerkId>`;
 *    - afterwards: children render as soon as Convex is authenticated and the
 *      upsert runs in the background; a ConvexError there still shows the error screen.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth()
  const { user } = useUser()
  const upsertUser = useMutation(api.users.upsertUser)
  const browserOnline = useBrowserOnline()
  const snapshotCtx = useContext(SnapshotContext)

  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [clerkTimedOut, setClerkTimedOut] = useState(false)
  /** `${userId}:${retryNonce}` of the sync already started (once per user/retry). */
  const startedKeyRef = useRef<string | null>(null)
  /** Latest Clerk user id, so in-flight retries for a previous user stop. */
  const currentUserIdRef = useRef<string | null>(null)

  const userId = isSignedIn && user ? user.id : null
  const canSync = isSignedIn === true && isConvexAuthenticated && user != null
  // Read on every render (cheap); flips to true right after the first success.
  const alreadySynced = userId != null && isUserSynced(userId)

  useEffect(() => {
    currentUserIdRef.current = userId
  }, [userId])

  useEffect(() => {
    if (isLoaded) return
    const timer = setTimeout(() => setClerkTimedOut(true), CLERK_LOAD_GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [isLoaded])

  useEffect(() => {
    if (!canSync || !user) return
    const id = user.id
    const key = `${id}:${retryNonce}`
    if (startedKeyRef.current === key) return
    startedKeyRef.current = key

    const name = user.fullName ?? user.firstName ?? 'User'
    const email = user.primaryEmailAddress?.emailAddress ?? ''
    const timeZone = getClientTimeZone()
    const background = isUserSynced(id)

    // Server rejections (ConvexError, e.g. FORBIDDEN account conflict) are shown
    // at once; only transient failures are retried.
    retryTransient(() => upsertUser({ name, email, timeZone }), {
      delaysMs: USER_SYNC_RETRY_DELAYS_MS,
      shouldAbort: () => currentUserIdRef.current !== id,
    })
      .then(() => {
        markUserSynced(id)
        perfMark(PERF_MARKS.upsertDone)
        setSyncResult({ userId: id, status: 'ready' })
      })
      .catch((error: unknown) => {
        console.error('User sync failed', error)
        if (background && !isPermanentSyncError(error)) {
          // Transient failure in the background: the user row already exists,
          // keep the app usable; the next launch / retry tries again.
          return
        }
        if (isPermanentSyncError(error)) clearUserSynced(id)
        setSyncResult({ userId: id, status: 'error', error })
      })
  }, [canSync, user, retryNonce, upsertUser])

  const syncStatus: SyncStatus = !canSync
    ? 'idle'
    : syncResult && syncResult.userId === userId
      ? syncResult.status
      : 'syncing'

  const view = decideGuard({
    isLoaded,
    isSignedIn,
    browserOnline,
    clerkFailed: clerk.status === 'error' || clerkTimedOut,
    // Live data (and the dashboard's queries) wait for Convex to have the auth
    // token; without it they fail with Unauthorized.
    convexAuthenticated: isConvexAuthenticated,
    syncStatus,
    alreadySynced,
    snapshot: snapshotAvailability(snapshotCtx, isLoaded && user ? user.id : null),
  })

  switch (view) {
    case 'loading-signin':
      return <LoadingScreen message="Signing you in…" />
    case 'loading-connecting':
      return <LoadingScreen message="Connecting…" />
    case 'loading-setup':
      return <LoadingScreen message="Setting up your account…" />
    case 'offline':
      return <OfflineScreen browserOnline={browserOnline} />
    case 'redirect':
      return <Navigate to="/sign-in" replace />
    case 'sync-error':
      return (
        <SyncErrorScreen
          error={syncResult?.error}
          onRetry={() => {
            setSyncResult(null)
            setRetryNonce((n) => n + 1)
          }}
        />
      )
  }

  // Same element tree in every data mode, so switching snapshot → live keeps
  // the dashboard mounted (no flash, open sheets stay open).
  return (
    <>
      {view === 'snapshot-signed-out' ? <SignInCheckNote /> : null}
      <DataReadyProvider mode={view === 'ready' ? 'ready' : 'snapshot'}>{children}</DataReadyProvider>
    </>
  )
}

/** Offline while Clerk reports signed out: we keep showing this phone's data. */
function SignInCheckNote() {
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-2 bg-muted text-[13px] font-medium text-muted-foreground"
      style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
    >
      <ShieldCheck size={16} className="shrink-0" aria-hidden />
      Sign-in will be checked when you&apos;re back online.
    </p>
  )
}
