import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import ThemeSwitcher from '@/components/shared/ThemeSwitcher'
import { AmountVisibilityProvider, AmountVisibilityToggle } from '@/components/shared/Amount'
import QueryErrorBoundary from '@/components/shared/QueryErrorBoundary'
import OverviewCards from '@/components/admin/OverviewCards'
import UsersList from '@/components/admin/UsersList'
import UserDetail from '@/components/admin/UserDetail'
import CustomizeSheet from '@/components/admin/CustomizeSheet'
import { CardPrefsContext, type CardPrefs } from '@/components/admin/cardPrefs'
import { readHiddenCards, writeHiddenCards, type AdminCardId } from '@/lib/admin'

function AdminHome() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="admin-overview-heading" className="flex flex-col gap-3">
        <h1 id="admin-overview-heading" className="text-xl sm:text-2xl font-logo font-bold text-foreground">Platform overview</h1>
        <QueryErrorBoundary fallbackMessage="Couldn't load the overview">
          <OverviewCards />
        </QueryErrorBoundary>
      </section>
      <section aria-labelledby="admin-users-heading" className="flex flex-col gap-3">
        <h2 id="admin-users-heading" className="text-lg font-bold text-foreground">Users</h2>
        <QueryErrorBoundary fallbackMessage="Couldn't load users">
          <UsersList />
        </QueryErrorBoundary>
      </section>
    </div>
  )
}

function useCardPrefsState(): CardPrefs {
  const [hidden, setHidden] = useState<AdminCardId[]>(readHiddenCards)
  const update = useCallback((next: AdminCardId[]) => {
    writeHiddenCards(next)
    setHidden(next)
  }, [])
  const toggle = useCallback((id: AdminCardId) => {
    update(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id])
  }, [hidden, update])
  const showAll = useCallback(() => update([]), [update])
  return useMemo(() => ({
    isHidden: (id: AdminCardId) => hidden.includes(id),
    toggle,
    showAll,
    hiddenCount: hidden.length,
  }), [hidden, toggle, showAll])
}

/**
 * Admin dashboard (/admin, /admin/users/:userId). Lazy chunk, rendered only
 * behind AdminGuard. Read-only: platform KPIs, users list, and each user's
 * dashboard numbers via the normal per-user queries (viewAsUserId).
 */
export default function Admin() {
  const prefs = useCardPrefsState()
  const [customizing, setCustomizing] = useState(false)

  return (
    <AmountVisibilityProvider>
      <CardPrefsContext.Provider value={prefs}>
        <div className="min-h-dvh bg-background">
          <header
            className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border/60"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 max-w-5xl">
              <Link
                to="/dashboard"
                aria-label="Back to dashboard"
                className="w-11 h-11 -ml-2 flex items-center justify-center rounded-full text-foreground hover:bg-muted active:scale-[0.97] transition-all"
              >
                <ArrowLeft size={18} />
              </Link>
              <span className="flex items-center gap-1.5 min-w-0 font-logo text-[1.0625rem] text-foreground">
                <ShieldCheck size={16} className="text-primary shrink-0" aria-hidden />
                <span className="truncate">Admin</span>
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <AmountVisibilityToggle />
                <button
                  type="button"
                  onClick={() => setCustomizing(true)}
                  aria-label="Customize cards"
                  title="Customize cards"
                  aria-haspopup="dialog"
                  className="relative w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all"
                >
                  <SlidersHorizontal size={18} />
                  {prefs.hiddenCount > 0 && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-primary" aria-hidden />
                  )}
                </button>
                <ThemeSwitcher />
              </div>
            </div>
          </header>

          <main className="mx-auto px-4 sm:px-6 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))] max-w-5xl">
            <Routes>
              <Route index element={<AdminHome />} />
              <Route path="users/:userId" element={<UserDetail />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </main>

          {customizing && <CustomizeSheet onClose={() => setCustomizing(false)} />}
        </div>
      </CardPrefsContext.Provider>
    </AmountVisibilityProvider>
  )
}
