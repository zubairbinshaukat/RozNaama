import type { ReactNode } from 'react'
import { Activity, CalendarCheck, CalendarDays, Loader2, Sun, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import { useAdminOverview } from '@/hooks/useAdmin'
import type { AdminCardId } from '@/lib/admin'
import { useCardPrefs } from './cardPrefs'

interface Tile {
  id: AdminCardId
  label: string
  icon: ReactNode
  value: ReactNode
  note: ReactNode
}

function TileCard({ tile }: { tile: Tile }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card shadow-card p-4 flex flex-col gap-2 min-h-28 min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden>
          {tile.icon}
        </span>
        <span className="text-[13px] font-semibold leading-tight">{tile.label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground tracking-tight leading-tight wrap-break-word tabular">{tile.value}</p>
      <p className="text-[13px] text-muted-foreground leading-snug">{tile.note}</p>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-hidden data-testid="overview-skeleton">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-3xl border border-border/70 bg-card p-4 flex flex-col gap-3 min-h-28">
          <div className="skeleton h-9 w-24 rounded-2xl" />
          <div className="skeleton h-7 w-20 rounded-xl" />
          <div className="skeleton h-3 w-28 rounded-full" />
        </div>
      ))}
    </div>
  )
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}% of users` : 'No users yet')

/** Platform KPI cards (admin.overview, all pages summed). Hidden cards come from the Customize sheet. */
export default function OverviewCards() {
  const { overview, counting } = useAdminOverview()
  const { isHidden } = useCardPrefs()

  if (!overview) return <OverviewSkeleton />

  const o = overview
  const tiles: Tile[] = [
    { id: 'users', label: 'Total users', icon: <Users size={24} />, value: o.users.toLocaleString('en-PK'),
      note: `${o.newThisMonth} joined this month` },
    { id: 'activeToday', label: 'Active today', icon: <Sun size={24} />, value: o.activeToday.toLocaleString('en-PK'),
      note: pct(o.activeToday, o.users) },
    { id: 'active7d', label: 'Active, 7 days', icon: <Activity size={24} />, value: o.active7d.toLocaleString('en-PK'),
      note: pct(o.active7d, o.users) },
    { id: 'active30d', label: 'Active, 30 days', icon: <CalendarCheck size={24} />, value: o.active30d.toLocaleString('en-PK'),
      note: pct(o.active30d, o.users) },
    { id: 'todaySales', label: "Today's sales", icon: <Wallet size={24} />, value: <Amount value={o.todaySales} />,
      note: <>Expenses <Amount value={o.todayExpenses} /></> },
    { id: 'monthSales', label: "This month's sales", icon: <TrendingUp size={24} />, value: <Amount value={o.monthSales} />,
      note: <>Expenses <Amount value={o.monthExpenses} /></> },
    { id: 'newUsers', label: 'New this month', icon: <UserPlus size={24} />, value: o.newThisMonth.toLocaleString('en-PK'),
      note: <span className="inline-flex items-center gap-1"><CalendarDays size={14} aria-hidden /> Signed up this month</span> },
  ]
  const visible = tiles.filter((t) => !isHidden(t.id))

  return (
    <div className="flex flex-col gap-2">
      {visible.length === 0 ? (
        <p className="text-[15px] text-muted-foreground px-1">All overview cards are hidden. Use Customize to show them.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {visible.map((t) => <TileCard key={t.id} tile={t} />)}
        </div>
      )}
      {counting && (
        <p role="status" className="flex items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
          <Loader2 size={14} className="animate-[spin_1s_linear_infinite]" aria-hidden />
          Counting users… {o.users} so far
        </p>
      )}
      {!counting && o.partialUsers > 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          {o.partialUsers === 1 ? '1 very busy user is' : `${o.partialUsers} very busy users are`} counted
          from their newest entries only, so totals may be a little low.
        </p>
      )}
    </div>
  )
}
