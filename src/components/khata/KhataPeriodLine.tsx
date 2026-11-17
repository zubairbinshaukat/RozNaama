import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import { useKhataReceivedInRange, useKhataTotals } from '@/hooks/useKhata'
import type { PeriodView } from '@/lib/period'
import { periodBounds } from './model'

/**
 * Under the summary cards (Advance & Udhaar on): money received from
 * customers in the selected period and today's open Baqi → opens /khata.
 */
export default function KhataPeriodLine({ view, value }: { view: PeriodView; value: number }) {
  const { start, end } = useMemo(() => periodBounds(view, value), [view, value])
  const received = useKhataReceivedInRange(start, end)
  const totals = useKhataTotals()

  return (
    <Link
      to="/khata"
      className="mt-3 flex items-center gap-2.5 min-h-12 px-3.5 py-2 rounded-2xl border border-border/70 bg-card text-[14px] text-muted-foreground hover:bg-muted/40 active:scale-[0.97] transition-all"
      aria-label="Open Khata (Udhaar and Advance)"
    >
      <BookOpen size={16} className="text-primary shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 leading-snug">
        Received (Udhaar/Advance):{' '}
        {received === undefined
          ? <span className="skeleton inline-block h-3.5 w-14 rounded-full align-middle" aria-hidden />
          : <Amount value={received.total} className="font-bold text-foreground" />}
        {' · '}Baqi:{' '}
        {totals === undefined
          ? <span className="skeleton inline-block h-3.5 w-14 rounded-full align-middle" aria-hidden />
          : <Amount value={totals.dueTotal} className="font-bold text-negative" />}
      </span>
      <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" aria-hidden />
    </Link>
  )
}
