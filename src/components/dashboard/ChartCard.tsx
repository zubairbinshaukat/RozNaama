import type { ReactNode } from 'react'
import Amount from '@/components/shared/Amount'

/** Card around a Recharts chart: plain-language title, total, and a text summary for screen readers. */
export default function ChartCard({
  title,
  total,
  totalLabel,
  summary,
  children,
}: {
  title: string
  total?: number
  totalLabel?: string
  /** Read by screen readers instead of the SVG. */
  summary: string
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card shadow-card p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3 mb-3">
        <h3 className="text-base font-bold text-foreground tracking-tight">{title}</h3>
        {total !== undefined && (
          <p className="text-right">
            {totalLabel && <span className="block text-xs font-semibold text-muted-foreground">{totalLabel}</span>}
            <Amount value={total} className="block text-base font-bold text-foreground" />
          </p>
        )}
      </div>
      <p className="sr-only">{summary}</p>
      <div aria-hidden className="-mx-1">{children}</div>
    </section>
  )
}

/** Chart tooltip in the app's style. */
export function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?:  string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-2xl border border-border bg-popover shadow-card-hover px-3 py-2">
      <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
      <Amount value={payload[0]!.value} className="block text-base font-bold text-foreground" />
    </div>
  )
}

/** Section heading above a period's day list. */
export function ListHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-3 px-1">
      {children}
    </h3>
  )
}
