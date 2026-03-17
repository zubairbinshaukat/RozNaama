import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, useUser } from '@clerk/clerk-react'
import { useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import LoadingScreen from './LoadingScreen'

interface ProtectedRouteProps {
  children: React.ReactNode
}

/**
 * Route guard that:
 * 1. Shows a branded loading screen while Clerk is initialising
 * 2. Redirects to /sign-in if not authenticated
 * 3. Waits for Convex to receive the auth token (avoids Unauthorized on first load)
 * 4. Upserts the user record in Convex once authenticated
 * 5. Renders children once everything is ready
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAuth()
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth()
  const { user } = useUser()
  const upsertUser = useMutation(api.users.upsertUser)

  // Sync user with Convex once signed in and Convex has the token
  useEffect(() => {
    if (!isSignedIn || !isConvexAuthenticated || !user) return

    const email = user.primaryEmailAddress?.emailAddress
    if (!email) return

    const name = user.fullName ?? user.firstName ?? 'User'

    upsertUser({ name, email }).catch(console.error)
  }, [isSignedIn, isConvexAuthenticated, user, upsertUser])

  if (!isLoaded) {
    return <LoadingScreen message="Signing you in…" />
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />
  }

  // Wait for Convex to have the auth token before rendering children
  // (dashboard queries run as soon as children mount; without this we get Unauthorized)
  if (!isConvexAuthenticated) {
    return <LoadingScreen message="Connecting…" />
  }

  return <>{children}</>
}
