import { lazy, Suspense, useState } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { ToastProvider } from '@/components/shared/Toast'
import { ViewAsProvider } from '@/context/ViewAsContext'
import ProtectedRoute from '@/components/shared/ProtectedRoute'
import AdminGuard from '@/components/admin/AdminGuard'
import LoadingScreen from '@/components/shared/LoadingScreen'
import OfflineBanner from '@/components/shared/OfflineBanner'
import SessionWatcher from '@/components/shared/SessionWatcher'
import { OutboxProvider, SnapshotProvider } from '@/lib/offline'
import { useOutbox } from '@/hooks/useOutbox'
import { KHATA_TURNED_OFF_MESSAGE, useOnKhataTurnedOff, useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/components/shared/Toast'
import ShopSettingsProvider from '@/components/shared/ShopSettingsProvider'

// Route-level code splitting: each page (and what only it uses) is its own chunk,
// so /dashboard never downloads the landing page and vice versa. All chunks are
// precached by the service worker, so offline navigation still works.
const Landing    = lazy(() => import('@/pages/Landing'))
const SignInPage = lazy(() => import('@/pages/SignInPage'))
const SignUpPage = lazy(() => import('@/pages/SignUpPage'))
const loadDashboard = () => import('@/pages/Dashboard')
const Dashboard  = lazy(loadDashboard)
// Admin-only chunk: requested only after AdminGuard has the server's yes, and
// kept out of the service-worker precache (vite.config.ts), so shopkeepers
// never download it.
const Admin      = lazy(() => import('@/pages/Admin'))
// Advance & Udhaar: its chunk is requested only when khata is switched on.
const Khata      = lazy(() => import('@/pages/Khata'))

/** /khata only exists for shops with Advance & Udhaar on; otherwise it behaves like an unknown path. */
function KhataRoute() {
  const { khataOn, isLoading } = useShopSettings()
  const { showToast } = useToast()
  const [turnedOff, setTurnedOff] = useState(false)
  // Switched off elsewhere (another phone / admin) while this page is open.
  useOnKhataTurnedOff(() => {
    setTurnedOff(true)
    showToast(KHATA_TURNED_OFF_MESSAGE, 'info')
  })
  if (isLoading) return <LoadingScreen />
  if (!khataOn) return <Navigate to={turnedOff ? '/dashboard' : '/'} replace />
  return <Khata />
}

// Don't let the Dashboard chunk download wait behind Clerk + Convex auth:
// on /dashboard (the PWA start_url) fetch it in parallel right away; from the
// sign-in / sign-up pages fetch it when the browser is idle (likely next stop).
if (typeof window !== 'undefined') {
  const path = window.location.pathname
  if (path.startsWith('/dashboard')) {
    loadDashboard().catch(() => {})
  } else if (path.startsWith('/sign-in') || path.startsWith('/sign-up')) {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => { loadDashboard().catch(() => {}) })
  }
}

/** Offline / syncing / paused pill, fed by this phone's outbox. */
function OutboxBanner() {
  const { entries, pendingCount, paused, retryNow } = useOutbox()
  const syncingCount = entries.filter((e) => e.status === 'pending').length
  return (
    <OfflineBanner
      pendingCount={pendingCount}
      syncingCount={syncingCount}
      paused={paused}
      onRetry={() => { void retryNow() }}
    />
  )
}

export default function App() {
  return (
    // "user": framer-motion drops transform animations when the OS asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        {/* Offline data for the current (or last) user: instant-open snapshot + outbox. */}
        <SnapshotProvider>
        <OutboxProvider>
        <SessionWatcher />
        <OutboxBanner />
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/"         element={<Landing />} />
            <Route path="/sign-in/*" element={<SignInPage />} />
            <Route path="/sign-up/*" element={<SignUpPage />} />
            {/* One guard + view-as state for /dashboard and /admin, so going from the
                admin dashboard to "View as" keeps the session and the choice. */}
            <Route
              element={
                <ProtectedRoute>
                  <ViewAsProvider>
                    <ShopSettingsProvider>
                      <Outlet />
                    </ShopSettingsProvider>
                  </ViewAsProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/khata" element={<KhataRoute />} />
              <Route
                path="/admin/*"
                element={
                  <AdminGuard>
                    <Admin />
                  </AdminGuard>
                }
              />
            </Route>
            {/* Catch-all → home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </OutboxProvider>
        </SnapshotProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
