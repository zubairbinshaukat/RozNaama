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
import { CalendarRange, Loader2 } from 'lucide-react'
import { useAvailableYears, usePaginatedYearSessions, useYearlyMonthlyTotals } from '@/hooks/useSales'
import { usePaginatedYearExpenses } from '@/hooks/useExpenses'
import { useCategories } from '@/hooks/useCategories'
import { cn, formatCurrency } from '@/lib/utils'
import SalesList from './SalesList'

type MetricMode = 'net' | 'sales'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PAGE_SIZE = 20

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
      <Calendar className="text-muted-foreground/40" size={48} strokeWidth={1.5} />
      <div>
        <p className="font-semibold text-foreground">No yearly data yet</p>
        <p className="text-sm text-muted-foreground mt-1">Record sales or expenses to see your yearly trend.</p>
      </div>
    </div>
  )
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card shadow-card-hover px-3 py-2 text-sm">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

export default function YearlyChart() {
  const availableYears = useAvailableYears()
  const fallbackYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(fallbackYear)
  const [metricMode, setMetricMode] = useState<MetricMode>('net')

  const years = useMemo(() => {
    if (!availableYears || availableYears.length === 0) return [fallbackYear]
    return availableYears
  }, [availableYears, fallbackYear])

  const selectedYearSafe = years.includes(selectedYear) ? selectedYear : years[0]
  const yearlyTotals = useYearlyMonthlyTotals(selectedYearSafe)
  const categories = useCategories()
  const sessionsResult = usePaginatedYearSessions(selectedYearSafe, PAGE_SIZE)
  const expensesResult = usePaginatedYearExpenses(selectedYearSafe, PAGE_SIZE)

  if (availableYears === undefined || yearlyTotals === undefined || categories === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        <div className="skeleton h-24 rounded-xl" />
        <div className="skeleton h-60 rounded-xl" />
        <div className="skeleton h-20 rounded-2xl" />
      </div>
    )
  }

  const data = yearlyTotals.map((month) => ({
    month: MONTH_LABELS[month.monthIndex],
    total: metricMode === 'net' ? month.netTotal : month.salesTotal,
  }))

  const hasAnyData = yearlyTotals.some((month) => month.netTotal !== 0 || month.salesTotal !== 0)
  if (!hasAnyData) return <EmptyState />

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 w-full rounded-xl bg-muted/50 border border-border/60 p-1">
          <button
            type="button"
            onClick={() => setMetricMode('net')}
            className={cn(
              'w-full px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all active:scale-95',
              metricMode === 'net'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Net (Sales - Expense)
          </button>
          <button
            type="button"
            onClick={() => setMetricMode('sales')}
            className={cn(
              'w-full px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all active:scale-95',
              metricMode === 'sales'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Total Sales
          </button>
        </div>

        <select
          value={selectedYearSafe}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="w-full h-10 rounded-lg border border-border/70 bg-card px-3 text-sm font-medium text-foreground"
          aria-label="Select year"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4">
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
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
              width={38}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="total"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#yearlyAreaGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <CalendarRange size={14} />
          {selectedYearSafe} Sales & Expenses
        </p>
        <SalesList
          sessions={sessionsResult.results}
          expenses={expensesResult.results}
          categories={categories}
          compact
        />
        {(sessionsResult.status !== 'Exhausted' || expensesResult.status !== 'Exhausted') && (
          <div className="flex justify-center mt-4">
            <button
              type="button"
              onClick={() => {
                if (sessionsResult.status === 'CanLoadMore') sessionsResult.loadMore(PAGE_SIZE)
                if (expensesResult.status === 'CanLoadMore') expensesResult.loadMore(PAGE_SIZE)
              }}
              disabled={sessionsResult.status === 'LoadingMore' || expensesResult.status === 'LoadingMore'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border/70 bg-card text-sm font-semibold text-foreground hover:bg-muted/30 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.97] transition-all"
            >
              {(sessionsResult.status === 'LoadingMore' || expensesResult.status === 'LoadingMore') && (
                <Loader2 size={16} className="animate-spin" />
              )}
              <span>Show More</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
