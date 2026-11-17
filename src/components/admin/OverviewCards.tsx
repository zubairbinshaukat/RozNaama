import type { ReactNode } from 'react'
import { Activity, CalendarCheck, Loader2, Sun, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react'
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

/**
 * Tiles grow to fill each row: 2 per row on phones, up to 4 per row from `sm`.
 * Fewer visible tiles get wider; a lone tile on the last row stretches across.
 * Tiles in a row share the same height (flex stretch).
 */
const TILE_SIZE = 'grow min-w-0 basis-[calc(50%-0.25rem)] sm:basis-[calc(25%-0.375rem)]'

function TileCard({ tile }: { tile: Tile }) {
  return (
    <div className="w-full min-w-0 rounded-2xl border border-border/70 bg-card px-3.5 py-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-1.5 text-muted-foreground">
        <span className="text-primary shrink-0 mt-px" aria-hidden>{tile.icon}</span>
        <span className="text-[12px] font-semibold leading-tight">{tile.label}</span>
      </div>
      <p className="text-xl font-bold text-foreground tracking-tight leading-tight wrap-break-word tabular">{tile.value}</p>
      <p className="mt-auto text-[11px] text-muted-foreground leading-snug">{tile.note}</p>
    </div>
  )
}

const STRIP = 'flex flex-wrap gap-2'

function OverviewSkeleton() {
  return (
    <div className={STRIP} aria-hidden data-testid="overview-skeleton">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={`${TILE_SIZE} rounded-2xl border border-border/70 bg-card px-3.5 py-3 flex flex-col gap-2`}>
          <div className="skeleton h-3 w-20 rounded-full" />
          <div className="skeleton h-5 w-16 rounded-lg" />
          <div className="skeleton h-2.5 w-24 rounded-full" />
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
    { id: 'users', label: 'Total users', icon: <Users size={16} />, value: o.users.toLocaleString('en-PK'),
      note: `${o.newThisMonth} joined this month` },
    { id: 'activeToday', label: 'Active today', icon: <Sun size={16} />, value: o.activeToday.toLocaleString('en-PK'),
      note: pct(o.activeToday, o.users) },
    { id: 'active7d', label: 'Active, 7 days', icon: <Activity size={16} />, value: o.active7d.toLocaleString('en-PK'),
      note: pct(o.active7d, o.users) },
    { id: 'active30d', label: 'Active, 30 days', icon: <CalendarCheck size={16} />, value: o.active30d.toLocaleString('en-PK'),
      note: pct(o.active30d, o.users) },
    { id: 'todaySales', label: "Today's sales", icon: <Wallet size={16} />, value: <Amount value={o.todaySales} />,
      note: <>Expenses <Amount value={o.todayExpenses} /></> },
    { id: 'monthSales', label: "This month's sales", icon: <TrendingUp size={16} />, value: <Amount value={o.monthSales} />,
      note: <>Expenses <Amount value={o.monthExpenses} /></> },
    { id: 'newUsers', label: 'New this month', icon: <UserPlus size={16} />, value: o.newThisMonth.toLocaleString('en-PK'),
      note: 'Signed up this month' },
  ]
  const visible = tiles.filter((t) => !isHidden(t.id))

  return (
    <div className="flex flex-col gap-2">
      {visible.length === 0 ? (
        <p className="text-[15px] text-muted-foreground px-1">All overview cards are hidden. Use Customize to show them.</p>
      ) : (
        <div className={STRIP} role="list" aria-label="Platform overview">
          {visible.map((t) => <div key={t.id} role="listitem" className={`${TILE_SIZE} flex`}><TileCard tile={t} /></div>)}
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
