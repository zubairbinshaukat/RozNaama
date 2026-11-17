import { useMemo } from 'react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { CalendarDays } from 'lucide-react'
import { useWeeklyTotals } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useDayFeed } from '@/hooks/useDayFeed'
import { toDayGroups } from '@/lib/dayGroups'
import { addDays, toLocalDateKey } from '@/lib/utils'
import { isCurrentPeriod, weekLabel, weekRange } from '@/lib/period'
import EmptyState from '@/components/shared/EmptyState'
import SalesList from './SalesList'
import LoadMoreButton from './LoadMoreButton'
import DayFeedSkeleton from './DayFeedSkeleton'
import ChartCard, { ChartTooltip, ListHeading } from './ChartCard'
import { compactTick, hiddenTick } from '@/lib/chart'
import { useAmountVisibility, useFormatMoney } from '@/context/amountVisibility'

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_PER_PAGE = 7

function buildWeekFrame(
  totals: { date: string; total: number }[],
  monday: number,
): { day: string; total: number; isToday: boolean }[] {
  const map      = new Map(totals.map((t) => [t.date, t.total]))
  const todayKey = toLocalDateKey(Date.now())

  return DAY_ABBR.map((day, i) => {
    const key = toLocalDateKey(addDays(monday, i))
    return { day, total: map.get(key) ?? 0, isToday: key === todayKey }
  })
}

interface WeeklyChartProps {
  /** Monday (local midnight) of the selected week. */
  week: number
}

export default function WeeklyChart({ week }: WeeklyChartProps) {
  const money = useFormatMoney()
  const { hidden: amountsHidden } = useAmountVisibility()
  const { start, end } = weekRange(week)
  const totals     = useWeeklyTotals(start)
  const categories = useCategories()
  const feed       = useDayFeed({ startDate: start, endDate: end }, DAYS_PER_PAGE)
  const days       = useMemo(() => toDayGroups(feed.results), [feed.results])
  const isCurrent  = isCurrentPeriod('week', start)
  const label      = weekLabel(start)

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
        icon={<CalendarDays size={48} strokeWidth={1.5} />}
        title={isCurrent ? 'No sales this week' : label === 'Last week' ? 'No sales last week' : `No sales in ${label}`}
        message={isCurrent
          ? 'Record a sale and your weekly chart will appear here.'
          : 'Nothing was recorded in this week.'}
        showActions={isCurrent}
      />
    )
  }

  const data = buildWeekFrame(totals, start)
  const weekSum = data.reduce((s, d) => s + d.total, 0)
  const best = data.reduce((a, b) => (b.total > a.total ? b : a), data[0]!)

  return (
    <div className="flex flex-col gap-5 pt-1">
      <ChartCard
        title="Day by day"
        total={weekSum}
        totalLabel={label}
        summary={`${label}: ${money(weekSum)}. Best day ${best.day} with ${money(best.total)}.`}
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={amountsHidden ? hiddenTick : compactTick}
              width={40}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.6)' }} />
            <Bar dataKey="total" radius={[8, 8, 0, 0]} maxBarSize={36}>
              {data.map((d) => (
                <Cell
                  key={d.day}
                  fill={d.isToday || !isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.45)'}
                />
              ))}
            </Bar>
          </BarChart>
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
