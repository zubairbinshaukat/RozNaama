import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Calendar } from 'lucide-react'
import { useYearlyMonthlyTotals } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useDayFeed } from '@/hooks/useDayFeed'
import { toDayGroups } from '@/lib/dayGroups'
import { cn, endOfYear, startOfYear } from '@/lib/utils'
import { compactTick, hiddenTick } from '@/lib/chart'
import { useAmountVisibility, useFormatMoney } from '@/context/amountVisibility'
import EmptyState from '@/components/shared/EmptyState'
import SalesList from './SalesList'
import LoadMoreButton from './LoadMoreButton'
import DayFeedSkeleton from './DayFeedSkeleton'
import ChartCard, { ChartTooltip, ListHeading } from './ChartCard'

type MetricMode = 'net' | 'sales'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS_PER_PAGE = 7

const METRICS: { id: MetricMode; label: string }[] = [
  { id: 'net', label: 'Profit (sales − expenses)' },
  { id: 'sales', label: 'Total sales' },
]

interface YearlyChartProps {
  /** Selected calendar year (picked with the period switcher above the summary). */
  year: number
}

export default function YearlyChart({ year: selectedYearSafe }: YearlyChartProps) {
  const money = useFormatMoney()
  const { hidden: amountsHidden } = useAmountVisibility()
  const [metricMode, setMetricMode] = useState<MetricMode>('net')

  const yearlyTotals = useYearlyMonthlyTotals(selectedYearSafe)
  const categories = useCategories()
  const yearStart = new Date(selectedYearSafe, 0, 1)
  const feed = useDayFeed({ startDate: startOfYear(yearStart), endDate: endOfYear(yearStart) }, DAYS_PER_PAGE)
  const days = useMemo(() => toDayGroups(feed.results), [feed.results])
  const isCurrent = selectedYearSafe === new Date().getFullYear()

  if (yearlyTotals === undefined || categories === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <div className="skeleton h-28 rounded-3xl" />
        <div className="skeleton h-64 rounded-3xl" />
        <DayFeedSkeleton count={1} />
      </div>
    )
  }

  const data = yearlyTotals.map((month) => ({
    month: MONTH_LABELS[month.monthIndex],
    total: metricMode === 'net' ? month.netTotal : month.salesTotal,
  }))
  const yearSum = data.reduce((s, d) => s + d.total, 0)

  const hasAnyData = yearlyTotals.some((month) => month.netTotal !== 0 || month.salesTotal !== 0)
  if (!hasAnyData) {
    return (
      <EmptyState
        icon={<Calendar size={48} strokeWidth={1.5} />}
        title={isCurrent ? 'No yearly data yet' : `No sales in ${selectedYearSafe}`}
        message={isCurrent
          ? 'Record sales or expenses and your year will show up here.'
          : 'Nothing was recorded in this year.'}
        showActions={isCurrent}
      />
    )
  }

  const metricLabel = METRICS.find((m) => m.id === metricMode)!.label

  return (
    <div className="flex flex-col gap-5 pt-1">
      <div className="flex flex-col gap-3">
        {/* Metric segmented control */}
        <div role="radiogroup" aria-label="What to show" className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={metricMode === m.id}
              onClick={() => setMetricMode(m.id)}
              className={cn(
                'min-h-11 px-2 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]',
                metricMode === m.id
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ChartCard
        title={`${selectedYearSafe} by month`}
        total={yearSum}
        totalLabel={metricMode === 'net' ? 'Year profit' : 'Year sales'}
        summary={`${metricLabel} in ${selectedYearSafe}: ${money(yearSum)}.`}
      >
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="yearlyAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              minTickGap={8}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={amountsHidden ? hiddenTick : compactTick}
              width={40}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="total"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              fill="url(#yearlyAreaGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div>
        <ListHeading>{selectedYearSafe} · sales and expenses</ListHeading>
        {feed.status === 'LoadingFirstPage' ? (
          <DayFeedSkeleton count={2} />
        ) : (
          <div className="flex flex-col gap-4">
            <SalesList days={days} categories={categories} />
            <LoadMoreButton status={feed.status} onLoadMore={() => feed.loadMore(DAYS_PER_PAGE)} />
          </div>
        )}
      </div>
    </div>
  )
}
