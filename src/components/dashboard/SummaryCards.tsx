import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import Amount from '@/components/shared/Amount'
import type { DashboardStats } from '@/hooks/useSales'

type Tab = 'daily' | 'weekly' | 'monthly' | 'yearly'

// ── Skeleton ──────────────────────────────────────────────────────────────

function SummarySkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1.9fr]" aria-hidden data-testid="summary-skeleton">
      <div className="rounded-3xl border border-border/70 bg-card p-5 flex flex-col gap-3 min-h-32">
        <div className="skeleton h-3.5 w-28 rounded-full" />
        <div className="skeleton h-10 w-44 rounded-xl" />
        <div className="skeleton h-3 w-20 rounded-full" />
      </div>
      <div className="rounded-3xl border border-border/70 bg-card grid grid-cols-3 divide-x divide-border/60">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-3.5 flex flex-col gap-2">
            <div className="skeleton h-3 w-14 rounded-full" />
            <div className="skeleton h-5 w-16 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────

interface Hero {
  label: string
  /** Money value (always shown big, bare, with a separate PKR label); null = not known ("—"). */
  value: number | null
  signed?: boolean
  /** One muted line under the number. */
  note: string
}

interface Cell {
  label: string
  /** Rendered value (an <Amount>, a count or a name). */
  value: ReactNode
  onClick?: () => void
  actionLabel?: string
}

/** Wallet-style balance card: the one big number of the view. */
function HeroCard({ hero }: { hero: Hero }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-brand text-brand-foreground p-5 shadow-glow-md min-h-32 flex flex-col justify-between gap-2">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 w-44 h-44 rounded-full bg-brand-foreground/10" />
      <p className="relative text-sm font-semibold opacity-90">{hero.label}</p>
      <p className="relative flex items-baseline gap-2 min-w-0">
        <span className="text-lg font-semibold opacity-85">PKR</span>
        {hero.value === null ? (
          <span className="text-[2.125rem] sm:text-[2.5rem] font-bold tracking-tight leading-none">—</span>
        ) : (
          <Amount
            value={hero.value}
            signed={hero.signed}
            bare
            className="text-[2.125rem] sm:text-[2.5rem] font-bold tracking-tight leading-none wrap-break-word min-w-0"
          />
        )}
      </p>
      <p className="relative text-sm font-medium opacity-85">{hero.note}</p>
    </div>
  )
}

function StripCell({ cell }: { cell: Cell }) {
  const content = (
    <>
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground leading-tight">
        {cell.label}
        {cell.onClick && (
          <span className="ml-auto w-5 h-5 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0" aria-hidden>
            <Plus size={12} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="text-lg font-bold text-foreground tracking-tight leading-tight wrap-break-word line-clamp-2">
        {cell.value}
      </span>
    </>
  )
  const base = 'min-w-0 min-h-18 px-3 py-3 sm:px-4 flex flex-col justify-center gap-1 text-left'
  if (cell.onClick) {
    return (
      <button
        type="button"
        onClick={cell.onClick}
        aria-label={cell.actionLabel}
        className={cn(base, 'hover:bg-muted/50 active:scale-[0.97] transition-all duration-150')}
      >
        {content}
      </button>
    )
  }
  return <div className={base}>{content}</div>
}

// ── Main component ─────────────────────────────────────────────────────────

/** Selected year's totals for the yearly view (from `getYearlyMonthlyTotals`). */
export interface YearSummary {
  salesTotal: number
  netTotal:   number
  /** Short month name with the best net, or null when nothing was recorded. */
  bestMonth:  string | null
}

interface SummaryCardsProps {
  stats:     DashboardStats | undefined
  activeTab: Tab
  /**
   * Name of the selected period: "Today" / "Mon, 16 Nov", "This week" / "9–15 Nov",
   * "This month" / "October", "This year" / "2025". Defaults to the current one.
   */
  periodLabel?: string
  /** Whether the selected period is the current one (today / this week / …). */
  isCurrent?: boolean
  /** Days in the selected month (monthly average). Defaults to the current month. */
  monthDays?: number
  /** Best day of the selected week / month; null = no positive day, undefined = loading. */
  bestDay?: { label: string } | null
  /** Yearly view: the selected year's totals; undefined = loading. */
  year?: YearSummary
  onAddExpense?: () => void
  /** Hide expense shortcut when admin is viewing another user. */
  readOnly?: boolean
  /**
   * Offline snapshot from an earlier day: these periods' numbers are not for
   * the shown period → rendered as "—" with `staleLabel` ("Last updated …").
   */
  stale?: { today: boolean; week: boolean; month: boolean }
  staleLabel?: string | null
}

const NOT_STALE = { today: false, week: false, month: false }
const DASH = '—'

const salesText = (n: number) => `${n} sale${n !== 1 ? 's' : ''}`

const DEFAULT_LABEL: Record<Tab, string> = {
  daily: 'Today', weekly: 'This week', monthly: 'This month', yearly: 'This year',
}

export default function SummaryCards({
  stats,
  activeTab,
  periodLabel = DEFAULT_LABEL[activeTab],
  isCurrent = true,
  monthDays,
  bestDay,
  year,
  onAddExpense,
  readOnly = false,
  stale = NOT_STALE,
  staleLabel = null,
}: SummaryCardsProps) {
  if (!stats || (activeTab === 'yearly' && !year)) return <SummarySkeleton />

  const now = new Date()
  const monthDayCount = monthDays ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const weekDailyAvg = stats.weekCount > 0 ? stats.weekTotal / 7 : 0
  const monthDailyAvg = stats.monthCount > 0 ? stats.monthTotal / monthDayCount : 0
  const net = (v: number) => <Amount value={v} signed colored bare />
  const plain = (v: number) => <Amount value={v} bare />
  const bestDayCell: Cell = { label: 'Best day', value: bestDay?.label ?? '—' }
  /** Value, or "—" when that period's numbers are from an earlier day. */
  const unless = <T,>(isStale: boolean, v: T): T | typeof DASH => (isStale ? DASH : v)
  const staleNote = staleLabel ?? 'Not updated yet'

  const yearly = (y: YearSummary): { hero: Hero; strip: [Cell, Cell, Cell] } => ({
    hero: {
      label: `${periodLabel}, after expenses`,
      value: y.netTotal,
      signed: true,
      note: y.bestMonth ? `Best month: ${y.bestMonth}` : 'Nothing recorded yet',
    },
    strip: [
      { label: 'Sales', value: plain(y.salesTotal) },
      { label: 'Expenses', value: plain(y.salesTotal - y.netTotal) },
      { label: 'All time', value: net(stats.allTimeTotal) },
    ],
  })

  const views: Record<Tab, () => { hero: Hero; strip: [Cell, Cell, Cell] }> = {
    daily: () => ({
      hero: {
        label: isCurrent ? "Today's sales" : `Sales · ${periodLabel}`,
        value: stale.today ? null : stats.todaySalesTotal,
        note: stale.today
          ? staleNote
          : stats.todayCount === 0 ? (isCurrent ? 'No sales yet' : 'No sales') : salesText(stats.todayCount),
      },
      strip: [
        {
          label: 'After expense',
          value: unless(stale.today, net(stats.todayNetTotal)),
          // Adding an expense records it for today, so only offer it on today.
          onClick: readOnly || !isCurrent ? undefined : onAddExpense,
          actionLabel: 'Add expense: After Expense',
        },
        { label: 'Sales', value: unless(stale.today, String(stats.todayCount)) },
        { label: 'Top category', value: unless(stale.today, stats.topCategoryName ?? '—') },
      ],
    }),
    weekly: () => ({
      hero: {
        label: `${periodLabel}, after expenses`,
        value: stale.week ? null : stats.weekTotal,
        signed: true,
        note: stale.week ? staleNote : salesText(stats.weekCount),
      },
      strip: [
        { label: 'Sales', value: unless(stale.week, String(stats.weekCount)) },
        { label: 'Avg / day', value: unless(stale.week, plain(Math.round(weekDailyAvg))) },
        isCurrent ? { label: 'Today', value: unless(stale.today, net(stats.todayNetTotal)) } : bestDayCell,
      ],
    }),
    monthly: () => ({
      hero: {
        label: `${periodLabel}, after expenses`,
        value: stale.month ? null : stats.monthTotal,
        signed: true,
        note: stale.month ? staleNote : salesText(stats.monthCount),
      },
      strip: [
        { label: 'Sales', value: unless(stale.month, String(stats.monthCount)) },
        { label: 'Avg / day', value: unless(stale.month, plain(Math.round(monthDailyAvg))) },
        bestDayCell,
      ],
    }),
    yearly: () => yearly(year!),
  }

  const view = views[activeTab]()
  // Only a strip cell is stale (weekly "Today"): say so under the cards.
  const stripOnlyStale = activeTab === 'weekly' && isCurrent && stale.today && !stale.week

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="grid gap-3 lg:grid-cols-[1.1fr_1.9fr]"
      >
        <HeroCard hero={view.hero} />
        <div className="rounded-3xl border border-border/70 bg-card shadow-card grid grid-cols-3 divide-x divide-border/60 overflow-hidden">
          {view.strip.map((c) => <StripCell key={c.label} cell={c} />)}
        </div>
        {stripOnlyStale && (
          <p className="lg:col-span-2 px-1 text-[13px] text-muted-foreground">Today: {staleNote}</p>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
