import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useConvexAuth } from 'convex/react'
import { PERF_MARKS, perfMark } from '@/lib/perf'
import { useBrowserOnline } from '@/lib/network'
import { clearLastUserHint, readLastUserHint, writeLastUserHint } from '@/lib/userHints'
import { clearSnapshot } from '@/lib/offline/snapshot'

/**
 * Renders nothing. Mounted once in App (all routes):
 * - startup perf marks rn:clerk-loaded / rn:convex-auth;
 * - keeps `rn-last-user` = {id, name} while a user is signed in, and clears it
 *   only on a confirmed ONLINE sign-out (Clerk loaded + signed out + online),
 *   together with that user's instant-open snapshot (the outbox is kept).
 *   ProtectedRoute uses the hint to open in snapshot mode while Clerk is unavailable.
 */
export default function SessionWatcher() {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth()
  const browserOnline = useBrowserOnline()

  useEffect(() => {
    if (isLoaded) perfMark(PERF_MARKS.clerkLoaded)
  }, [isLoaded])

  useEffect(() => {
    if (isConvexAuthenticated) perfMark(PERF_MARKS.convexAuth)
  }, [isConvexAuthenticated])

  const userId = isSignedIn && user ? user.id : null
  const userName = user ? (user.firstName ?? user.fullName ?? '') : ''

  useEffect(() => {
    if (userId) writeLastUserHint({ id: userId, name: userName })
  }, [userId, userName])

  useEffect(() => {
    if (!(isLoaded && isSignedIn === false && browserOnline)) return
    // Confirmed online sign-out: forget the instant-open snapshot of the user
    // who left. Their unsynced outbox entries stay for their next sign-in.
    const hint = readLastUserHint()
    if (hint) void clearSnapshot(hint.id)
    clearLastUserHint()
  }, [isLoaded, isSignedIn, browserOnline])

  return null
}
