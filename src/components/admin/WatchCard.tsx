import { Link } from 'react-router-dom'
import { ChevronRight, Clock, ReceiptText, Shield, ShoppingBag } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import type { WatchSummary } from '@/hooks/useAdmin'
import { initialsOf, lastActiveLabel, recordWhenLabel } from '@/lib/admin'
import { cn } from '@/lib/utils'
import KhataChip from './KhataChip'

type Period = { sales: number; expenses: number }

function Kpi({ label, period }: { label: string; period: Period }) {
  const net = period.sales - period.expenses
  return (
    <div className="min-w-0 rounded-2xl bg-muted/50 px-2.5 py-2 flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate">{label}</span>
      <Amount value={period.sales} className="text-[15px] font-bold text-foreground leading-tight wrap-break-word" />
      {/* Net only when there were expenses; otherwise it would just repeat the sales figure. */}
      <span className={cn('text-[11px] font-medium leading-tight truncate', period.expenses > 0 ? 'text-muted-foreground' : 'invisible')}>
        Net <Amount value={net} bare className={cn('font-semibold', net < 0 ? 'text-negative' : 'text-foreground')} />
      </span>
    </div>
  )
}

function Latest({ latest }: { latest: WatchSummary['latest'] }) {
  if (!latest) {
    return <p className="text-[13px] text-muted-foreground">Nothing recorded yet</p>
  }
  const isSale = latest.kind === 'sale'
  return (
    <p className="flex items-center gap-2 min-w-0 text-[13px]">
      <span
        className={cn(
          'w-7 h-7 rounded-xl flex items-center justify-center shrink-0',
          isSale ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
        )}
        aria-hidden
      >
        {isSale ? <ShoppingBag size={14} /> : <ReceiptText size={14} />}
      </span>
      <span className="sr-only">{isSale ? 'Latest sale:' : 'Latest expense:'}</span>
      <span className="min-w-0 truncate text-foreground">
        <span className="font-semibold">{latest.label}</span>
        <span className="text-muted-foreground"> · </span>
        <Amount value={latest.amount} className="font-semibold" />
        <span className="text-muted-foreground"> · {recordWhenLabel(latest.at)}</span>
      </span>
    </p>
  )
}

/** One watched user: who, last record, today / week / month, Access. Tap → user detail. */
export default function WatchCard({ row, onAccess }: { row: WatchSummary; onAccess: (id: WatchSummary['userId'], name: string) => void }) {
  const last = lastActiveLabel(row.lastActivityAt)
  return (
    <article
      aria-label={row.name}
      className="rounded-3xl border border-border/70 bg-card shadow-card flex flex-col overflow-hidden min-w-0"
    >
      <Link
        to={`/admin/users/${row.userId}`}
        className="flex flex-col gap-3 p-4 hover:bg-muted/30 active:scale-[0.99] transition-all duration-150"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0 text-sm font-bold" aria-hidden>
            {initialsOf(row.name)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 min-w-0"><span className="text-base font-semibold text-foreground truncate">{row.name}</span>{row.khataEnabled && <KhataChip />}</span>
            <span className="block text-[13px] text-muted-foreground truncate">{row.email}</span>
          </span>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" aria-hidden />
        </div>

        <div className="flex flex-col gap-1.5">
          <Latest latest={row.latest} />
          <p className={cn('flex items-center gap-1.5 text-[12px] font-medium', last === 'Today' ? 'text-positive' : 'text-muted-foreground')}>
            <Clock size={12} aria-hidden /> Last active: {last}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Today" period={row.today} />
          <Kpi label="This week" period={row.week} />
          <Kpi label="This month" period={row.month} />
        </div>
        {row.partial && (
          <p className="text-[12px] text-muted-foreground">Very busy account: week and month count the newest entries only.</p>
        )}
      </Link>

      <div className="border-t border-border/60 p-2">
        <button
          type="button"
          onClick={() => onAccess(row.userId, row.name)}
          aria-label={`Access ${row.name}'s dashboard`}
          className="w-full min-h-11 flex items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-primary hover:bg-primary/8 active:scale-[0.97] transition-all"
        >
          <Shield size={16} aria-hidden /> Access
        </button>
      </div>
    </article>
  )
}
