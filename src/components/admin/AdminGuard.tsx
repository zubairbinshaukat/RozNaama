import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, WifiOff } from 'lucide-react'
import LoadingScreen from '@/components/shared/LoadingScreen'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { useBrowserOnline } from '@/lib/network'
import { btnOutline } from '@/lib/ui'

/**
 * Renders `children` (the lazy admin page) only once the SERVER says the
 * caller is an admin (`users.getMyAccess`), so the admin chunk is never
 * downloaded for anyone else. Non-admins go to /dashboard. Every admin query
 * is checked on the server as well; this guard only decides what to render.
 */
export default function AdminGuard({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAdminAccess()
  const online = useBrowserOnline()

  if (loading) {
    if (!online) {
      return (
        <div role="alert" className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center bg-background">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <WifiOff className="text-muted-foreground" size={24} aria-hidden />
          </div>
          <p className="text-base font-semibold text-foreground max-w-xs">
            Connect to the internet to open the admin dashboard.
          </p>
          <Link to="/dashboard" replace className={btnOutline}>
            <ArrowLeft size={18} aria-hidden /> Back to dashboard
          </Link>
        </div>
      )
    }
    return <LoadingScreen message="Checking admin access…" />
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
