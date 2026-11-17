import { CloudOff } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import { cn, formatDate } from '@/lib/utils'
import type { TimelineEvent } from './model'

/** History list (newest first): sales, bookings, payments, refunds, … */
export default function Timeline({ events, capped = false }: { events: readonly TimelineEvent[]; capped?: boolean }) {
  return (
    <section aria-label="History" className="flex flex-col gap-2">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground px-1">History</h3>
      {events.length === 0 ? (
        <p className="px-1 text-[15px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70">
          {events.map((t) => (
            <li key={t.key} className="flex items-center gap-3 px-4 py-3 min-h-14">
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-foreground truncate">{t.title}</span>
                <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  {t.kind === 'pending' && <><CloudOff size={14} aria-hidden /> Waiting to sync ·</>}
                  {formatDate(t.at)}
                </span>
              </span>
              {t.amount !== undefined && (
                <Amount
                  value={t.amount}
                  className={cn('text-base font-bold shrink-0', t.tone === 'in' ? 'text-positive' : t.tone === 'out' ? 'text-negative' : 'text-foreground')}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {capped && <p className="px-1 text-[13px] text-muted-foreground">Showing the latest 50 records.</p>}
    </section>
  )
}
