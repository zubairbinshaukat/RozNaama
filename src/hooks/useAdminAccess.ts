import { useAuth } from '@clerk/clerk-react'
import { useConvexAuth, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

export type AdminAccess = {
  isAdmin: boolean
  /** True until the server has answered for the signed-in user. */
  loading: boolean
}

/**
 * Admin flag from the server (`users.getMyAccess`: Clerk role "Admin" in the
 * JWT claims). UI gating only — every admin query is checked
 * on the server too. Skipped until Convex has the auth token, so a
 * signed-out first answer never flips the flag (and never clears a saved
 * view-as) while the token is still on its way.
 */
export function useAdminAccess(): AdminAccess {
  const { isLoaded, isSignedIn } = useAuth()
  const { isAuthenticated } = useConvexAuth()
  const enabled = isLoaded && isSignedIn === true && isAuthenticated
  const access = useQuery(api.users.getMyAccess, enabled ? {} : 'skip')
  if (isLoaded && isSignedIn !== true) return { isAdmin: false, loading: false }
  return { isAdmin: access?.isAdmin === true, loading: access === undefined }
}
