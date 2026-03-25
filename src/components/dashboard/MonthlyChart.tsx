import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { CalendarRange } from 'lucide-react'
import { useMonthlyTotals, useMonthSessions } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency } from '@/lib/utils'
import SalesList from './SalesList'
import { useMonthExpenses } from '@/hooks/useExpenses'

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
      <CalendarRange className="text-muted-foreground/40" size={48} strokeWidth={1.5} />
      <div>
        <p className="font-semibold text-foreground">No sales this month</p>
        <p className="text-sm text-muted-foreground mt-1">Record sales or add expenses to see your monthly trend.</p>
      </div>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?:  string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card shadow-card-hover px-3 py-2 text-sm">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
}

export default function MonthlyChart() {
  const totals     = useMonthlyTotals()
  const sessions   = useMonthSessions()
  const categories = useCategories()
  const expenses   = useMonthExpenses()

  if (totals === undefined || sessions === undefined || categories === undefined || expenses === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        <div className="skeleton h-60 rounded-xl" />
        <div className="skeleton h-20 rounded-2xl" />
      </div>
    )
  }

  const hasAnyData = (sessions.length > 0) || (expenses.length > 0)
  if (!hasAnyData) return <EmptyState />

  const data = totals
    .map((t) => ({ day: shortDate(t.date), rawDate: t.date, total: t.total }))
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate))

  return (
    <div className="flex flex-col gap-6 pt-2">
      {/* Area chart */}
      <div className="bg-card border border-border rounded-2xl p-4">
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
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
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
              fill="url(#areaGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed sales for the month */}
      {sessions.length > 0 || expenses.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            This Month (Sales - Expenses)
          </p>
          <SalesList sessions={sessions} expenses={expenses} categories={categories} compact />
        </div>
      ) : null}
    </div>
  )
}
