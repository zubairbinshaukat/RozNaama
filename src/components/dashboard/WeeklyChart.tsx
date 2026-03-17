import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { CalendarDays } from 'lucide-react'
import { useWeeklyTotals, useWeekSessions } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, startOfWeek } from '@/lib/utils'
import SalesList from './SalesList'

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function buildWeekFrame(totals: { date: string; total: number }[]): { day: string; total: number }[] {
  const map    = new Map(totals.map((t) => [t.date, t.total]))
  const monday = new Date(startOfWeek())

  return DAY_ABBR.map((day, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = d.toISOString().split('T')[0]
    return { day, total: map.get(key) ?? 0 }
  })
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
      <CalendarDays className="text-muted-foreground/40" size={48} strokeWidth={1.5} />
      <div>
        <p className="font-semibold text-foreground">No sales this week</p>
        <p className="text-sm text-muted-foreground mt-1">Start recording sales to see your weekly chart.</p>
      </div>
    </div>
  )
}

export default function WeeklyChart() {
  const totals     = useWeeklyTotals()
  const sessions   = useWeekSessions()
  const categories = useCategories()

  if (totals === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        <div className="skeleton h-60 rounded-xl" />
        <div className="skeleton h-20 rounded-2xl" />
      </div>
    )
  }

  const data    = buildWeekFrame(totals)
  const hasData = data.some((d) => d.total > 0)
  if (!hasData) return <EmptyState />

  return (
    <div className="flex flex-col gap-6 pt-2">
      {/* Bar chart */}
      <div className="bg-card border border-border rounded-2xl p-4">
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
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
              width={38}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} />
            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed sales for the week */}
      {sessions !== undefined && categories !== undefined && sessions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            This Week's Sales
          </p>
          <SalesList sessions={sessions} categories={categories} compact />
        </div>
      )}
    </div>
  )
}
