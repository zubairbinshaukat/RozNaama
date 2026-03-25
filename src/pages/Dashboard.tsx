import { useState, useEffect, useRef, useCallback } from 'react'
import { Sun, CalendarDays, CalendarRange, TrendingUp, Download } from 'lucide-react'
import { UserButton, useUser } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, getGreeting } from '@/lib/utils'
import ThemeSwitcher   from '@/components/shared/ThemeSwitcher'
import SummaryCards    from '@/components/dashboard/SummaryCards'
import DailyTab        from '@/components/dashboard/DailyTab'
import WeeklyChart     from '@/components/dashboard/WeeklyChart'
import MonthlyChart    from '@/components/dashboard/MonthlyChart'
import FAB             from '@/components/shared/FAB'
import AddCategoryModal      from '@/components/modals/AddCategoryModal'
import AddSaleModal          from '@/components/modals/AddSaleModal'
import AddExpenseModal      from '@/components/modals/AddExpenseModal'
import ManageCategoriesModal from '@/components/modals/ManageCategoriesModal'
import IOSInstallModal      from '@/components/modals/IOSInstallModal'
import { useDashboardStats } from '@/hooks/useSales'
import { useHorizontalTabSwipe } from '@/hooks/useHorizontalTabSwipe'
import { useMediaQueryMatch } from '@/hooks/useMediaQueryMatch'

type Tab = 'daily' | 'weekly' | 'monthly'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'daily',   label: 'Daily',   icon: <Sun          size={14} /> },
  { id: 'weekly',  label: 'Weekly',  icon: <CalendarDays  size={14} /> },
  { id: 'monthly', label: 'Monthly', icon: <CalendarRange size={14} /> },
]

// ── PWA install hook ────────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function usePWAInstall({ onIOSInstall }: { onIOSInstall: () => void }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    const standaloneNavigator = (window.navigator as { standalone?: boolean }).standalone === true
    return mediaQuery.matches || standaloneNavigator
  })
  const [isIOS] = useState(() => {
    if (typeof navigator === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
  })

  useEffect(() => {
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

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [activeTab,              setActiveTab]              = useState<Tab>('daily')
  const [showCategoryModal,      setShowCategoryModal]      = useState(false)
  const [showSaleModal,          setShowSaleModal]          = useState(false)
  const [showExpenseModal,      setShowExpenseModal]      = useState(false)
  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false)
  const [showIOSInstallModal,   setShowIOSInstallModal]   = useState(false)

  const stats = useDashboardStats()
  const tabSwipeRef = useRef<HTMLDivElement>(null)
  const mobileLayout = useMediaQueryMatch('(max-width: 639px)')
  const reduceMotion = useMediaQueryMatch('(prefers-reduced-motion: reduce)')

  const goTabNext = useCallback(() => {
    setActiveTab((t) => (t === 'daily' ? 'weekly' : t === 'weekly' ? 'monthly' : t))
  }, [])
  const goTabPrev = useCallback(() => {
    setActiveTab((t) => (t === 'monthly' ? 'weekly' : t === 'weekly' ? 'daily' : t))
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
    'there'

  return (
    <div className="min-h-dvh bg-background">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-xl border-b border-border/50 pt-[max(0,env(safe-area-inset-top))]">
        <div className="mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 max-w-5xl">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-[8px] bg-gradient-brand flex items-center justify-center shadow-glow-sm">
              <TrendingUp className="text-white" size={13} strokeWidth={2.5} />
            </div>
            <span className="font-logo text-[1.05rem] text-foreground hidden sm:block">RozNaama</span>
          </Link> 

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto">
            <ThemeSwitcher />
            <UserButton
              afterSignOutUrl="/"
              appearance={{ elements: { avatarBox: 'w-8 h-8' } }}
            />
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="mx-auto px-4 sm:px-6 py-6 pb-28 max-w-5xl">
        <section aria-label="Greeting" className="mb-6">
          <p className="text-[0.9375rem] sm:text-lg leading-snug">
            <span className="text-muted-foreground font-medium">{getGreeting()}, </span>
            <span className="font-logo font-semibold text-gradient-brand">{displayName}</span>
          </p>
        </section>

        {/* PWA Install CTA (only when not installed) */}
        <AnimatePresence>
          {canInstall && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6"
            >
              <button
                onClick={install}
                aria-label={isIOS ? 'Add to Home Screen' : 'Install app'}
                title={isIOS ? 'Add to Home Screen' : 'Install App'}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all border border-border/60"
              >
                <Download size={16} />
                <span className="whitespace-nowrap">
                  {isIOS ? 'Add to Home Screen' : 'Install RozNaama'}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary cards — tab aware */}
        <section aria-label="Summary" className="mb-6">
          <SummaryCards stats={stats} activeTab={activeTab} onAddExpense={() => setShowExpenseModal(true)} />
        </section>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border/60 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-selected={activeTab === tab.id}
              role="tab"
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg',
                'text-[0.8rem] font-semibold transition-all duration-200 active:scale-95',
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab panels — swipe left/right on small screens to change period */}
        <div
          ref={tabSwipeRef}
          className="min-h-48"
          style={{ touchAction: 'pan-y' }}
        >
          <AnimatePresence mode="wait">
            <motion.section
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              aria-label={`${activeTab} view`}
            >
              {activeTab === 'daily'   && <DailyTab />}
              {activeTab === 'weekly'  && <WeeklyChart />}
              {activeTab === 'monthly' && <MonthlyChart />}
            </motion.section>
          </AnimatePresence>
        </div>
      </main>

      {/* ── FAB ──────────────────────────────────────────────────────────── */}
      <FAB
        onAddCategory={() => setShowCategoryModal(true)}
        onAddSale={()     => setShowSaleModal(true)}
        onManageCategories={() => setShowManageCategoriesModal(true)}
      />

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showCategoryModal && (
        <AddCategoryModal onClose={() => setShowCategoryModal(false)} />
      )}
      {showSaleModal && (
        <AddSaleModal onClose={() => setShowSaleModal(false)} />
      )}
      {showExpenseModal && (
        <AddExpenseModal onClose={() => setShowExpenseModal(false)} />
      )}
      {showManageCategoriesModal && (
        <ManageCategoriesModal onClose={() => setShowManageCategoriesModal(false)} />
      )}
      {showIOSInstallModal && (
        <IOSInstallModal onClose={() => setShowIOSInstallModal(false)} />
      )}
    </div>
  )
}
