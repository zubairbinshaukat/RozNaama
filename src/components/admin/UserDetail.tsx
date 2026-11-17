import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Clock, Eye, UserX } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import QueryErrorBoundary from '@/components/shared/QueryErrorBoundary'
import { useToast } from '@/components/shared/Toast'
import PeriodSummary from '@/components/dashboard/PeriodSummary'
import DailyTab from '@/components/dashboard/DailyTab'
import DayFeedSkeleton from '@/components/dashboard/DayFeedSkeleton'
import { SegmentedTabs } from '@/components/dashboard/ViewTabs'
import { ViewAsOverride } from '@/context/ViewAsContext'
import { useAdminUser, type AdminUserRow } from '@/hooks/useAdmin'
import { initialsOf, lastActiveLabel } from '@/lib/admin'
import { CURRENT_SELECTION, resolveSelection, selectPeriod, shortDayText, type PeriodSelection } from '@/lib/period'
import { VIEW_PANEL_ID, type View } from '@/lib/views'
import { btnOutline, btnPrimary } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useCardPrefs } from './cardPrefs'
import { useImpersonate } from './useImpersonate'
import ShopSettingsCard from './ShopSettingsCard'

// Same chunks the normal dashboard uses (shared, not duplicated).
const WeeklyChart  = lazy(() => import('@/components/dashboard/WeeklyChart'))
const MonthlyChart = lazy(() => import('@/components/dashboard/MonthlyChart'))
const YearlyChart  = lazy(() => import('@/components/dashboard/YearlyChart'))

const UNAVAILABLE = 'That user is no longer available'
const noop = () => {}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden data-testid="user-detail-skeleton">
      <div className="skeleton h-28 rounded-3xl" />
      <div className="skeleton h-20 rounded-3xl" />
      <div className="skeleton h-64 rounded-3xl" />
    </div>
  )
}

function Figures({ user }: { user: AdminUserRow }) {
  const cells = [
    { label: 'Today', value: user.todaySales },
    { label: 'This month', value: user.monthSales },
    { label: 'All time', value: user.allTimeSales },
  ]
  return (
    <div className="rounded-3xl border border-border/70 bg-card shadow-card grid grid-cols-3 divide-x divide-border/60 overflow-hidden">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 min-h-18 px-3 py-3 sm:px-4 flex flex-col justify-center gap-1">
          <span className="text-xs font-semibold text-muted-foreground">{c.label} sales</span>
          <Amount value={c.value} bare className="text-lg font-bold text-foreground tracking-tight leading-tight wrap-break-word" />
        </div>
      ))}
    </div>
  )
}

/** Header + period switcher + the dashboard's own KPI cards / charts for one user (read-only). */
function Detail({ user }: { user: AdminUserRow }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const impersonate = useImpersonate()
  const { isHidden } = useCardPrefs()
  const [view, setView] = useState<View>('daily')
  const [selection, setSelection] = useState<PeriodSelection>(CURRENT_SELECTION)
  const period = resolveSelection(selection)
  const changePeriod = useCallback((value: number) => {
    setSelection((s) => selectPeriod(s, view, value))
  }, [view])

  const onInvalid = useCallback(() => {
    showToast(UNAVAILABLE, 'error')
    navigate('/admin', { replace: true })
  }, [navigate, showToast])

  const viewAsUser = () => impersonate(user._id, user.name)

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="User" className="rounded-3xl border border-border/70 bg-card shadow-card p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-12 h-12 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0 text-lg font-bold" aria-hidden>
            {initialsOf(user.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-logo font-bold text-foreground truncate">{user.name}</h1>
            <p className="text-[13px] text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="flex items-start gap-2">
            <CalendarPlus size={16} className="text-muted-foreground mt-0.5 shrink-0" aria-hidden />
            <div><dt className="text-muted-foreground">Joined</dt><dd className="font-semibold text-foreground">{shortDayText(user.createdAt, true)}</dd></div>
          </div>
          <div className="flex items-start gap-2">
            <Clock size={16} className="text-muted-foreground mt-0.5 shrink-0" aria-hidden />
            <div><dt className="text-muted-foreground">Last active</dt><dd className="font-semibold text-foreground">{lastActiveLabel(user.lastActivityAt)}</dd></div>
          </div>
        </dl>
        <button type="button" onClick={viewAsUser} className={cn(btnPrimary, 'w-full sm:w-auto sm:self-start')}>
          <Eye size={18} /> View as this user
        </button>
      </section>

      {!isHidden('userFigures') && (
        <section aria-label="Sales so far" className="flex flex-col gap-1.5">
          <Figures user={user} />
          {user.partial && (
            <p className="px-1 text-[13px] text-muted-foreground">Very busy account: month and all-time figures count the newest entries only.</p>
          )}
        </section>
      )}

      <QueryErrorBoundary fallbackMessage="Couldn't load shop settings" resetKeys={[user._id]}>
        <ShopSettingsCard userId={user._id} name={user.name} />
      </QueryErrorBoundary>

      <SegmentedTabs active={view} onChange={setView} showOnPhones />

      <ViewAsOverride userId={user._id} name={user.name} onInvalid={onInvalid}>
        {!isHidden('userSummary') && (
          <section aria-label="Period summary">
            <QueryErrorBoundary isViewingOther onViewAsInvalid={onInvalid} resetKeys={[user._id, view]}>
              <PeriodSummary view={view} value={period[view]} onChange={changePeriod} onAddExpense={noop} readOnly />
            </QueryErrorBoundary>
          </section>
        )}
        {!isHidden('userCharts') && (
          <section id={VIEW_PANEL_ID} role="tabpanel" aria-label={`${view} view`}>
            <QueryErrorBoundary isViewingOther onViewAsInvalid={onInvalid} resetKeys={[user._id, view]}>
              {view === 'daily' && <DailyTab day={period.daily} />}
              <Suspense fallback={<DayFeedSkeleton count={2} />}>
                {view === 'weekly' && <WeeklyChart week={period.weekly} />}
                {view === 'monthly' && <MonthlyChart month={period.monthly} />}
                {view === 'yearly' && <YearlyChart year={period.yearly} />}
              </Suspense>
            </QueryErrorBoundary>
          </section>
        )}
        {isHidden('userSummary') && isHidden('userCharts') && (
          <p className="text-[15px] text-muted-foreground px-1">Period cards and charts are hidden. Use Customize to show them.</p>
        )}
      </ViewAsOverride>
    </div>
  )
}

/** /admin/users/:userId */
export default function UserDetail() {
  const { userId = '' } = useParams()
  const user = useAdminUser(userId)

  return (
    <div className="flex flex-col gap-4">
      <Link to="/admin" className="self-start inline-flex items-center gap-1.5 min-h-11 px-1 text-sm font-semibold text-primary active:scale-[0.97] transition-all">
        <ArrowLeft size={16} aria-hidden /> Admin home
      </Link>
      {user === undefined ? (
        <HeaderSkeleton />
      ) : user === null ? (
        <EmptyState
          icon={<UserX size={48} strokeWidth={1.5} />}
          title="User not found"
          message="This account may have been removed."
          showActions={false}
        />
      ) : (
        // Fresh period state per user.
        <Detail key={user._id} user={user} />
      )}
      {user === null && (
        <Link to="/admin" className={cn(btnOutline, 'self-center')}>
          <ArrowLeft size={18} aria-hidden /> Back to users
        </Link>
      )}
    </div>
  )
}
