import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { CalendarRange } from 'lucide-react'
import { useMonthlyTotals } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useDayFeed } from '@/hooks/useDayFeed'
import { toDayGroups } from '@/lib/dayGroups'
import { isCurrentPeriod, monthLabel, monthRange } from '@/lib/period'
import EmptyState from '@/components/shared/EmptyState'
import SalesList from './SalesList'
import LoadMoreButton from './LoadMoreButton'
import DayFeedSkeleton from './DayFeedSkeleton'
import ChartCard, { ChartTooltip, ListHeading } from './ChartCard'
import { compactTick, hiddenTick } from '@/lib/chart'
import { useAmountVisibility, useFormatMoney } from '@/context/amountVisibility'

const DAYS_PER_PAGE = 7

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
}

interface MonthlyChartProps {
  /** First day (local midnight) of the selected month. */
  month: number
}

export default function MonthlyChart({ month }: MonthlyChartProps) {
  const money = useFormatMoney()
  const { hidden: amountsHidden } = useAmountVisibility()
  const { start, end } = monthRange(month)
  const totals     = useMonthlyTotals(start)
  const categories = useCategories()
  const feed       = useDayFeed({ startDate: start, endDate: end }, DAYS_PER_PAGE)
  const days       = useMemo(() => toDayGroups(feed.results), [feed.results])
  const isCurrent  = isCurrentPeriod('month', start)
  const label      = monthLabel(start)

  if (totals === undefined || categories === undefined || feed.status === 'LoadingFirstPage') {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <div className="skeleton h-64 rounded-3xl" />
        <DayFeedSkeleton count={2} />
      </div>
    )
  }

  if (days.length === 0 && feed.status === 'Exhausted') {
    return (
      <EmptyState
        icon={<CalendarRange size={48} strokeWidth={1.5} />}
        title={isCurrent ? 'No sales this month' : `No sales in ${label}`}
        message={isCurrent
          ? 'Record sales or add expenses to see how your month is going.'
          : 'Nothing was recorded in this month.'}
        showActions={isCurrent}
      />
    )
  }

  const data = totals
    .map((t) => ({ day: shortDate(t.date), rawDate: t.date, total: t.total }))
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
  const monthSum = data.reduce((s, d) => s + d.total, 0)

  return (
    <div className="flex flex-col gap-5 pt-1">
      <ChartCard
        title={isCurrent ? 'Trend this month' : `Trend in ${label}`}
        total={monthSum}
        totalLabel={label}
        summary={`${isCurrent ? 'This month so far' : label}: ${money(monthSum)} across ${data.length} days with entries.`}
      >
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
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
              fill="url(#areaGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="flex flex-col gap-4">
        <div>
          <ListHeading>{label} · sales and expenses</ListHeading>
          <SalesList days={days} categories={categories} />
        </div>
        <LoadMoreButton status={feed.status} onLoadMore={() => feed.loadMore(DAYS_PER_PAGE)} />
      </div>
    </div>
  )
}
