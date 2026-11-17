import { useMemo } from 'react'
import SummaryCards, { type YearSummary } from './SummaryCards'
import { DayNav, MonthNav, WeekNav, YearNav } from './PeriodNav'
import {
  useAvailableYears,
  useDashboardStatsState,
  useMonthlyTotals,
  useWeeklyTotals,
  useYearlyMonthlyTotals,
} from '@/hooks/useSales'
import {
  bestDayOf,
  dayLabel,
  daysInMonth,
  focusDayIn,
  isCurrentPeriod,
  monthLabel,
  monthRange,
  MONTHS_SHORT,
  statsRangesForDay,
  weekLabel,
  weekRange,
  yearLabel,
  type PeriodView,
  type StatsRanges,
} from '@/lib/period'
import { lastUpdatedLabel } from '@/hooks/useDataFreshness'
import { startOfDay } from '@/lib/utils'

interface Common {
  onAddExpense: () => void
  readOnly: boolean
}

interface PeriodSummaryProps extends Common {
  view: PeriodView
  /** Resolved selection for `view` (period start ms, or the year). */
  value: number
  onChange: (value: number) => void
}

/** Period switcher + summary cards for the active view's selected period. */
export default function PeriodSummary({ view, ...props }: PeriodSummaryProps) {
  return (
    <div className="flex flex-col gap-3">
      {view === 'daily' && <DailySummary {...props} />}
      {view === 'weekly' && <WeeklySummary {...props} />}
      {view === 'monthly' && <MonthlySummary {...props} />}
      {view === 'yearly' && <YearlySummary {...props} />}
    </div>
  )
}

type Props = Omit<PeriodSummaryProps, 'view'>

/**
 * Stats (live, else the offline snapshot) + which periods are from an
 * earlier day: SummaryCards shows those as "—" with "Last updated …".
 */
function useSummaryStats(ranges?: StatsRanges) {
  const s = useDashboardStatsState(ranges)
  const anyStale = s.staleToday || s.staleWeek || s.staleMonth
  return {
    stats: s.stats,
    stale: { today: s.staleToday, week: s.staleWeek, month: s.staleMonth },
    staleLabel: anyStale && s.savedAt !== null ? lastUpdatedLabel(s.savedAt) : null,
  }
}

function DailySummary({ value, onChange, ...common }: Props) {
  const ranges = useMemo(() => statsRangesForDay(value), [value])
  const { stats, ...staleness } = useSummaryStats(ranges)
  return (
    <>
      <DayNav value={value} onChange={onChange} />
      <SummaryCards
        stats={stats}
        activeTab="daily"
        periodLabel={dayLabel(value)}
        isCurrent={isCurrentPeriod('day', value)}
        {...staleness}
        {...common}
      />
    </>
  )
}

function WeeklySummary({ value, onChange, ...common }: Props) {
  const today = startOfDay()
  const ranges = useMemo(() => statsRangesForDay(focusDayIn(weekRange(value), today)), [value, today])
  const { stats, ...staleness } = useSummaryStats(ranges)
  const totals = useWeeklyTotals(value)
  const bestDay = useMemo(() => (totals ? bestDayOf(totals, 'weekday') : undefined), [totals])
  return (
    <>
      <WeekNav value={value} onChange={onChange} />
      <SummaryCards
        stats={stats}
        activeTab="weekly"
        periodLabel={weekLabel(value)}
        isCurrent={isCurrentPeriod('week', value)}
        bestDay={bestDay}
        {...staleness}
        {...common}
      />
    </>
  )
}

function MonthlySummary({ value, onChange, ...common }: Props) {
  const today = startOfDay()
  const ranges = useMemo(() => statsRangesForDay(focusDayIn(monthRange(value), today)), [value, today])
  const { stats, ...staleness } = useSummaryStats(ranges)
  const totals = useMonthlyTotals(value)
  const bestDay = useMemo(() => (totals ? bestDayOf(totals, 'date') : undefined), [totals])
  return (
    <>
      <MonthNav value={value} onChange={onChange} />
      <SummaryCards
        stats={stats}
        activeTab="monthly"
        periodLabel={monthLabel(value)}
        isCurrent={isCurrentPeriod('month', value)}
        monthDays={daysInMonth(value)}
        bestDay={bestDay}
        {...staleness}
        {...common}
      />
    </>
  )
}

function YearlySummary({ value, onChange, ...common }: Props) {
  const { stats, ...staleness } = useSummaryStats()
  const years = useAvailableYears()
  const totals = useYearlyMonthlyTotals(value)
  const year = useMemo<YearSummary | undefined>(() => {
    if (!totals) return undefined
    let best: { monthIndex: number; netTotal: number } | null = null
    let salesTotal = 0
    let netTotal = 0
    for (const m of totals) {
      salesTotal += m.salesTotal
      netTotal += m.netTotal
      if ((m.salesTotal !== 0 || m.netTotal !== 0) && (best === null || m.netTotal > best.netTotal)) best = m
    }
    return { salesTotal, netTotal, bestMonth: best ? MONTHS_SHORT[best.monthIndex] ?? null : null }
  }, [totals])
  return (
    <>
      <YearNav value={value} onChange={onChange} years={years} />
      <SummaryCards
        stats={stats}
        activeTab="yearly"
        periodLabel={yearLabel(value)}
        isCurrent={value === new Date().getFullYear()}
        year={year}
        {...staleness}
        {...common}
      />
    </>
  )
}
