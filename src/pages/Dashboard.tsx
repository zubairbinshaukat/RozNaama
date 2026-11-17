import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { TrendingUp, Download, Eye, ArrowLeft, BookOpen } from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getGreeting } from '@/lib/utils'
import { VIEWS, VIEW_LABELS, VIEW_PANEL_ID, type View } from '@/lib/views'
import {
  CURRENT_SELECTION,
  dayLabel,
  monthLabel,
  resolveSelection,
  selectPeriod,
  weekLabel,
  yearLabel,
  type PeriodSelection,
} from '@/lib/period'
import ThemeSwitcher   from '@/components/shared/ThemeSwitcher'
import { AmountVisibilityProvider, AmountVisibilityToggle } from '@/components/shared/Amount'
import PeriodSummary   from '@/components/dashboard/PeriodSummary'
import DailyTab        from '@/components/dashboard/DailyTab'
import DayFeedSkeleton from '@/components/dashboard/DayFeedSkeleton'
import AccountMenu     from '@/components/dashboard/AccountMenu'
import { SegmentedTabs, BottomNav } from '@/components/dashboard/ViewTabs'
import FAB             from '@/components/shared/FAB'
import SheetFallback   from '@/components/shared/SheetFallback'
import DataFreshnessChip from '@/components/shared/DataFreshnessChip'
import { useViewAs } from '@/context/ViewAsContext'
import { DashboardActionsContext, type DashboardActions } from '@/context/dashboardActions'
import { useToast } from '@/components/shared/Toast'
import QueryErrorBoundary from '@/components/shared/QueryErrorBoundary'
import { useHorizontalTabSwipe } from '@/hooks/useHorizontalTabSwipe'
import { useMediaQueryMatch } from '@/hooks/useMediaQueryMatch'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { readLastUserHint } from '@/lib/userHints'
import { KHATA_TURNED_OFF_MESSAGE, useOnKhataTurnedOff, useShopSettings } from '@/hooks/useShopSettings'

// ── Code splitting ──────────────────────────────────────────────────────────
// Recharts views and secondary sheets are separate chunks, so the first load
// is just the Daily view. All chunks are precached by the service worker.
const WeeklyChart  = lazy(() => import('@/components/dashboard/WeeklyChart'))
const MonthlyChart = lazy(() => import('@/components/dashboard/MonthlyChart'))
const YearlyChart  = lazy(() => import('@/components/dashboard/YearlyChart'))

const loadAddSale    = () => import('@/components/modals/AddSaleModal')
const loadAddExpense = () => import('@/components/modals/AddExpenseModal')
const AddSaleModal          = lazy(loadAddSale)
const AddExpenseModal       = lazy(loadAddExpense)
const AddCategoryModal      = lazy(() => import('@/components/modals/AddCategoryModal'))
const ManageCategoriesModal = lazy(() => import('@/components/modals/ManageCategoriesModal'))
const IOSInstallModal       = lazy(() => import('@/components/modals/IOSInstallModal'))
const AdminAccessDialog     = lazy(() => import('@/components/dashboard/AdminAccessDialog'))
// Advance & Udhaar (only requested when it is switched on).
const KhataPeriodLine       = lazy(() => import('@/components/khata/KhataPeriodLine'))
const AdvanceSheet          = lazy(() => import('@/components/khata/AdvanceSheet'))
const ReceivePaymentFlow    = lazy(() => import('@/components/khata/ReceivePaymentFlow'))

/** The two everyday sheets: fetch them once the dashboard is idle, so the first tap is instant. */
function usePrefetchEntrySheets() {
  useEffect(() => {
    const prefetch = () => {
      loadAddSale().catch(() => {})
      loadAddExpense().catch(() => {})
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(prefetch, 1500)
    return () => window.clearTimeout(timer)
  }, [])
}

function ChartViewSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-1" data-testid="chart-view-skeleton">
      <div className="skeleton h-64 rounded-3xl" aria-hidden />
      <DayFeedSkeleton count={2} />
    </div>
  )
}

// ── PWA install hook ────────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function usePWAInstall({ onIOSInstall }: { onIOSInstall: () => void }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    const standaloneNavigator = (window.navigator as { standalone?: boolean }).standalone === true
    return mediaQuery.matches || standaloneNavigator
  })
  const [isIOS] = useState(() => {
    if (typeof navigator === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const onDisplay = (e: MediaQueryListEvent) => { if (e.matches) setIsInstalled(true) }
    mediaQuery.addEventListener('change', onDisplay)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      mediaQuery.removeEventListener('change', onDisplay)
    }
  }, [])

  const install = async () => {
    if (isIOS) {
      onIOSInstall()
      return
    }
    if (!promptEvent) return
    await promptEvent.prompt()
    const result = await promptEvent.userChoice
    if (result.outcome === 'accepted') {
      setPromptEvent(null)
      setIsInstalled(true)
    }
  }

  return { canInstall: !isInstalled && (isIOS || !!promptEvent), install, isIOS }
}

/** Screen-reader heading for the summary: "Weekly · Last week". */
function periodTitle(view: View, value: number): string {
  const name =
    view === 'daily' ? dayLabel(value)
    : view === 'weekly' ? weekLabel(value)
    : view === 'monthly' ? monthLabel(value)
    : yearLabel(value)
  return `${VIEW_LABELS[view]} · ${name}`
}

// ── Modal error boundary (category / count queries inside modals) ──────────

const MODAL_FALLBACK_CLASS =
  'fixed z-[500] left-4 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 shadow-lg'

/**
 * Keeps a modal's failing query (e.g. FORBIDDEN / USER_NOT_FOUND during
 * view-as, or a server error) from white-screening the dashboard: view-as
 * invalidation drops back to own data, anything else shows the fallback card
 * with Retry / Close.
 */
function ModalQueryBoundary({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const { isViewingOther, viewAsUserId, handleViewAsInvalid } = useViewAs()
  return (
    <QueryErrorBoundary
      isViewingOther={isViewingOther}
      onViewAsInvalid={handleViewAsInvalid}
      resetKeys={[viewAsUserId]}
      onDismiss={onClose}
      className={MODAL_FALLBACK_CLASS}
    >
      {children}
    </QueryErrorBoundary>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [activeTab,              setActiveTab]              = useState<View>('daily')
  const [showCategoryModal,      setShowCategoryModal]      = useState(false)
  const [showSaleModal,          setShowSaleModal]          = useState(false)
  const [showExpenseModal,      setShowExpenseModal]      = useState(false)
  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false)
  const [showIOSInstallModal,   setShowIOSInstallModal]   = useState(false)
  /** Advance & Udhaar sheets (FAB). */
  const [khataSheet,            setKhataSheet]            = useState<'advance' | 'payment' | null>(null)
  /** Selected day / week / month / year per view: kept while switching tabs, reset on reopen. */
  const [periodSelection,       setPeriodSelection]       = useState<PeriodSelection>(CURRENT_SELECTION)
  const period = resolveSelection(periodSelection)
  const changePeriod = useCallback((value: number) => {
    setPeriodSelection((s) => selectPeriod(s, activeTab, value))
  }, [activeTab])

  const { isViewingOther, viewAsName, viewAsUserId, handleViewAsInvalid, clearViewAs, isAdmin } = useViewAs()
  const { showToast } = useToast()
  const canEditOnline = useCanEditOnline()
  const { khataOn } = useShopSettings()
  // Switched off elsewhere (another phone / admin) while a khata sheet is open.
  useOnKhataTurnedOff(() => {
    if (khataSheet) showToast(KHATA_TURNED_OFF_MESSAGE, 'info')
    setKhataSheet(null)
  })
  usePrefetchEntrySheets()
  const tabSwipeRef = useRef<HTMLDivElement>(null)
  const mobileLayout = useMediaQueryMatch('(max-width: 639px)')
  const reduceMotion = useMediaQueryMatch('(prefers-reduced-motion: reduce)')

  /** Change view; if the user scrolled deep into the list, bring the summary back into view. */
  const changeTab = useCallback((next: View) => {
    setActiveTab(next)
    if (typeof window !== 'undefined' && window.scrollY > 240) {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    }
  }, [reduceMotion])

  const goTabNext = useCallback(() => {
    setActiveTab((t) => VIEWS[Math.min(VIEWS.indexOf(t) + 1, VIEWS.length - 1)]!)
  }, [])
  const goTabPrev = useCallback(() => {
    setActiveTab((t) => VIEWS[Math.max(VIEWS.indexOf(t) - 1, 0)]!)
  }, [])

  useHorizontalTabSwipe(tabSwipeRef, {
    enabled: mobileLayout && !reduceMotion,
    onSwipeNext: goTabNext,
    onSwipePrev: goTabPrev,
  })

  const { canInstall, install, isIOS } = usePWAInstall({
    onIOSInstall: () => setShowIOSInstallModal(true),
  })

  const { user } = useUser()
  const displayName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.username?.trim() ||
    // Snapshot mode (Clerk not loaded yet / offline): the last user on this phone.
    (user ? '' : readLastUserHint()?.name.trim()) ||
    'there'

  /** New categories need the server (only new sales / expenses save offline). */
  const openAddCategory = () => {
    if (!canEditOnline) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    setShowCategoryModal(true)
  }

  const actions = useMemo<DashboardActions | null>(
    () => isViewingOther
      ? null
      : { openAddSale: () => setShowSaleModal(true), openAddExpense: () => setShowExpenseModal(true) },
    [isViewingOther],
  )

  const backToMyData = () => {
    clearViewAs()
    showToast('Back to your own data', 'info')
  }

  return (
    <AmountVisibilityProvider>
    <DashboardActionsContext.Provider value={actions}>
      <div className="min-h-dvh bg-background">
        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border/60"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 max-w-5xl">
            <Link to="/" className="flex items-center gap-2 shrink-0 min-h-11 rounded-xl" aria-label="RozNaama home">
              <div className="w-8 h-8 rounded-[10px] bg-gradient-brand flex items-center justify-center shadow-glow-sm">
                <TrendingUp className="text-brand-foreground" size={16} strokeWidth={2.5} />
              </div>
              <span className="font-logo text-[1.0625rem] text-foreground">RozNaama</span>
            </Link>

            <div className="flex items-center gap-1.5 ml-auto">
              {khataOn && (
                <Link
                  to="/khata"
                  aria-label="Khata (Udhaar and Advance)"
                  title="Khata"
                  className="w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all"
                >
                  <BookOpen size={18} />
                </Link>
              )}
              <ThemeSwitcher />
              <AccountMenu />
            </div>
          </div>
        </header>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="mx-auto px-4 sm:px-6 pt-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-32 max-w-5xl">
          <section aria-label="Greeting" className="mb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-muted-foreground">{getGreeting()},</p>
                <p className="text-xl sm:text-2xl font-logo font-bold text-foreground truncate">{displayName}</p>
                <DataFreshnessChip className="mt-1.5" />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Admin-only code: never downloaded for shopkeepers. */}
                {isAdmin && (
                  <Suspense fallback={null}>
                    <AdminAccessDialog />
                  </Suspense>
                )}
                <AmountVisibilityToggle />
              </div>
            </div>
          </section>

          {/* Admin read-only banner */}
          {isViewingOther && viewAsName && (
            <div
              role="status"
              className="mb-5 flex items-center gap-3 rounded-3xl border border-warning/40 bg-warning/10 px-4 py-3"
            >
              <Eye size={18} className="text-warning shrink-0" aria-hidden />
              <p className="flex-1 min-w-0 text-[15px] text-foreground">
                Viewing <span className="font-bold">{viewAsName}</span>&apos;s data — recording and edits are disabled.
              </p>
              <button
                type="button"
                onClick={backToMyData}
                className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-2xl bg-card border border-border text-sm font-semibold text-foreground active:scale-[0.97] transition-all"
              >
                <ArrowLeft size={16} aria-hidden /> My data
              </button>
            </div>
          )}

          {/* PWA Install CTA (only when not installed) */}
          <AnimatePresence>
            {canInstall && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5"
              >
                <button
                  type="button"
                  onClick={install}
                  aria-label={isIOS ? 'Add to Home Screen' : 'Install app'}
                  title={isIOS ? 'Add to Home Screen' : 'Install App'}
                  className="w-full flex items-center gap-3 min-h-14 px-4 py-3 rounded-3xl text-left bg-primary/8 border border-primary/25 hover:bg-primary/12 active:scale-[0.97] transition-all"
                >
                  <span className="w-10 h-10 rounded-2xl bg-gradient-brand text-brand-foreground flex items-center justify-center shrink-0" aria-hidden>
                    <Download size={18} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-bold text-foreground">
                      {isIOS ? 'Add to Home Screen' : 'Install RozNaama'}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">Open it like an app, even with weak internet.</span>
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Summary cards — tab aware */}
          <section aria-labelledby="summary-heading" className="mb-5">
            <h2 id="summary-heading" className="sr-only">
              {periodTitle(activeTab, period[activeTab])}
            </h2>
            <QueryErrorBoundary
              isViewingOther={isViewingOther}
              onViewAsInvalid={handleViewAsInvalid}
              resetKeys={[viewAsUserId]}
            >
              <PeriodSummary
                view={activeTab}
                value={period[activeTab]}
                onChange={changePeriod}
                onAddExpense={() => setShowExpenseModal(true)}
                readOnly={isViewingOther}
              />
              {khataOn && (
                <Suspense fallback={null}>
                  <KhataPeriodLine view={activeTab} value={period[activeTab]} />
                </Suspense>
              )}
            </QueryErrorBoundary>
          </section>

          {/* Period tabs (tablet / desktop) — phones use the bottom bar */}
          <div className="mb-4">
            <SegmentedTabs active={activeTab} onChange={changeTab} />
          </div>

          {/* Tab panel — swipe left/right on phones to change period */}
          <div
            ref={tabSwipeRef}
            className="min-h-48"
            style={{ touchAction: 'pan-y' }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.section
                key={activeTab}
                id={VIEW_PANEL_ID}
                role="tabpanel"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                aria-label={`${activeTab} view`}
              >
                <QueryErrorBoundary
                  isViewingOther={isViewingOther}
                  onViewAsInvalid={handleViewAsInvalid}
                  resetKeys={[viewAsUserId]}
                >
                  {activeTab === 'daily'   && <DailyTab day={period.daily} />}
                  <Suspense fallback={<ChartViewSkeleton />}>
                    {activeTab === 'weekly'  && <WeeklyChart week={period.weekly} />}
                    {activeTab === 'monthly' && <MonthlyChart month={period.monthly} />}
                    {activeTab === 'yearly'  && <YearlyChart year={period.yearly} />}
                  </Suspense>
                </QueryErrorBoundary>
              </motion.section>
            </AnimatePresence>
          </div>
        </main>

        {/* ── Bottom tab bar (phones) + FAB ─────────────────────────────────── */}
        <BottomNav active={activeTab} onChange={changeTab} reserveFabSpace={!isViewingOther} />
        <FAB
          disabled={isViewingOther}
          onAddCategory={openAddCategory}
          onAddSale={()     => setShowSaleModal(true)}
          onAddExpense={()  => setShowExpenseModal(true)}
          onManageCategories={() => setShowManageCategoriesModal(true)}
          {...(khataOn ? {
            onAdvance:        () => setKhataSheet('advance'),
            onReceivePayment: () => setKhataSheet('payment'),
          } : {})}
        />

        {/* ── Modals (write actions never open in read-only view-as) ─────────── */}
        <Suspense fallback={<SheetFallback />}>
        {showCategoryModal && !isViewingOther && (
          <AddCategoryModal onClose={() => setShowCategoryModal(false)} />
        )}
        {showSaleModal && !isViewingOther && (
          <ModalQueryBoundary onClose={() => setShowSaleModal(false)}>
            <AddSaleModal onClose={() => setShowSaleModal(false)} />
          </ModalQueryBoundary>
        )}
        {showExpenseModal && !isViewingOther && (
          <AddExpenseModal onClose={() => setShowExpenseModal(false)} />
        )}
        {showManageCategoriesModal && !isViewingOther && (
          <ModalQueryBoundary onClose={() => setShowManageCategoriesModal(false)}>
            <ManageCategoriesModal
              onClose={() => setShowManageCategoriesModal(false)}
              onAddCategory={() => {
                setShowManageCategoriesModal(false)
                setShowCategoryModal(true)
              }}
            />
          </ModalQueryBoundary>
        )}
        {khataOn && !isViewingOther && khataSheet === 'advance' && (
          <ModalQueryBoundary onClose={() => setKhataSheet(null)}>
            <AdvanceSheet onClose={() => setKhataSheet(null)} />
          </ModalQueryBoundary>
        )}
        {khataOn && !isViewingOther && khataSheet === 'payment' && (
          <ModalQueryBoundary onClose={() => setKhataSheet(null)}>
            <ReceivePaymentFlow onClose={() => setKhataSheet(null)} />
          </ModalQueryBoundary>
        )}
        {showIOSInstallModal && (
          <IOSInstallModal onClose={() => setShowIOSInstallModal(false)} />
        )}
        </Suspense>
      </div>
    </DashboardActionsContext.Provider>
    </AmountVisibilityProvider>
  )
}
