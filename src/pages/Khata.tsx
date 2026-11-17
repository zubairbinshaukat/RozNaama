import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChevronRight, CloudOff, Eye, Plus, Search, Wallet } from 'lucide-react'
import { AmountVisibilityProvider, AmountVisibilityToggle } from '@/components/shared/Amount'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import LoadMoreButton from '@/components/dashboard/LoadMoreButton'
import PendingEntrySheet from '@/components/modals/PendingEntrySheet'
import CustomerSheet from '@/components/khata/CustomerSheet'
import AdvanceSheet from '@/components/khata/AdvanceSheet'
import { rowAmount } from '@/components/khata/model'
import { useViewAs } from '@/context/ViewAsContext'
import { useCustomerSearch, useKhataOpenList, useKhataTotals, usePendingKhata } from '@/hooks/useKhata'
import { phoneTail, sinceLabel, type KhataSegment } from '@/lib/khata'
import { entryAmount } from '@/lib/offline/types'
import { pendingEntryTitle } from '@/lib/pendingEntries'
import { btnPrimary, inputBase } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Id } from '../../convex/_generated/dataModel'

const SEGMENTS: { id: KhataSegment; label: string; sub: string }[] = [
  { id: 'due', label: 'Udhaar', sub: 'owed to you' },
  { id: 'booked', label: 'Advance', sub: 'you hold' },
]

/** Advance & Udhaar: who owes you (Udhaar) and whose money you hold (Advance). */
export default function Khata() {
  return (
    <AmountVisibilityProvider>
      <KhataScreen />
    </AmountVisibilityProvider>
  )
}

function KhataScreen() {
  const { isViewingOther, viewAsName } = useViewAs()
  const [segment, setSegment] = useState<KhataSegment>('due')
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState<Id<'customers'> | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [newAdvance, setNewAdvance] = useState(false)
  const searchId = useId()
  const totals = useKhataTotals()
  const list = useKhataOpenList(segment)
  const searching = search.trim() !== ''
  const found = useCustomerSearch(searching ? search : '')
  const pendingAll = usePendingKhata()
  const pending = useMemo(
    () => pendingAll.filter((p) => (segment === 'due' ? p.kind === 'khataSale' : p.kind === 'khataAdvance')),
    [pendingAll, segment],
  )

  return (
    <div className="min-h-dvh bg-background">
      <header
        className="sticky top-0 z-40 bg-background/85 backdrop-blur-xl border-b border-border/60"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 max-w-3xl">
          <Link
            to="/dashboard"
            aria-label="Back to dashboard"
            className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-foreground hover:bg-muted active:scale-[0.97] transition-all"
          >
            <ArrowLeft size={18} />
          </Link>
          <BookOpen size={18} className="text-primary" aria-hidden />
          <h1 className="flex-1 text-lg font-bold text-foreground tracking-tight">Khata</h1>
          <AmountVisibilityToggle />
        </div>
      </header>

      <main className="mx-auto px-4 sm:px-6 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] max-w-3xl flex flex-col gap-4">
        {isViewingOther && (
          <p role="status" className="flex items-center gap-2 rounded-3xl border border-warning/40 bg-warning/10 px-4 py-3 text-[15px] text-foreground">
            <Eye size={18} className="text-warning shrink-0" aria-hidden />
            Viewing {viewAsName ? <span className="font-bold">{viewAsName}</span> : 'this user'}&apos;s khata — read-only.
          </p>
        )}

        <div role="tablist" aria-label="Khata" className="grid grid-cols-2 gap-3">
          {SEGMENTS.map((s) => {
            const active = segment === s.id
            const total = s.id === 'due' ? totals?.dueTotal : totals?.heldTotal
            const count = s.id === 'due' ? totals?.dueCount : totals?.heldCount
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSegment(s.id)}
                className={cn(
                  'flex flex-col items-start gap-1 min-h-24 rounded-3xl border px-4 py-3 text-left active:scale-[0.97] transition-all',
                  active ? 'border-primary/50 bg-primary/8 shadow-card' : 'border-border/70 bg-card',
                )}
              >
                <span className="text-[15px] font-bold text-foreground">
                  {s.label} <span className="font-medium text-muted-foreground">({s.sub})</span>
                </span>
                {totals === undefined ? (
                  <span className="skeleton h-7 w-24 rounded-lg" aria-hidden />
                ) : (
                  <Amount value={total ?? 0} className={cn('text-2xl font-bold tracking-tight', s.id === 'due' ? 'text-negative' : 'text-foreground')} />
                )}
                <span className="text-[13px] text-muted-foreground">
                  {count === undefined ? ' ' : count === 1 ? '1 open' : `${count} open`}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor={searchId} className="sr-only">Search customer</label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer"
            autoComplete="off"
            className={cn(inputBase, 'pl-11')}
          />
        </div>

        {searching ? (
          found === undefined ? (
            <ListSkeleton />
          ) : found.length === 0 ? (
            <p className="px-1 text-[15px] text-muted-foreground">No customer by that name.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Customers">
              {found.map((c) => (
                <Row
                  key={c._id}
                  title={c.name}
                  tail={phoneTail(c.phone)}
                  sub={c.openCount > 0 ? `${c.openCount} open` : 'Nothing open'}
                  amount={c.dueTotal > 0 ? c.dueTotal : c.heldTotal}
                  amountLabel={c.dueTotal > 0 ? 'Baqi' : c.heldTotal > 0 ? 'Held' : ''}
                  negative={c.dueTotal > 0}
                  onOpen={() => setCustomerId(c._id)}
                />
              ))}
            </ul>
          )
        ) : (
          <>
            {pending.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Waiting to sync">
                {pending.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPendingId(p.id)}
                      className="w-full flex items-center gap-3 min-h-15 px-4 py-2.5 rounded-2xl border border-dashed border-border bg-card text-left active:scale-[0.97] transition-all"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-base font-semibold text-foreground truncate">{pendingEntryTitle(p)}</span>
                        <span className="flex items-center gap-1 text-[13px] font-semibold text-muted-foreground">
                          <CloudOff size={14} aria-hidden /> Waiting to sync
                        </span>
                      </span>
                      <Amount value={entryAmount(p)} className="text-base font-bold text-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {list.status === 'LoadingFirstPage' ? (
              <ListSkeleton />
            ) : list.results.length === 0 && pending.length === 0 ? (
              segment === 'due' ? (
                <EmptyState
                  icon={<BookOpen size={48} strokeWidth={1.5} />}
                  title="No Udhaar yet"
                  message="When a customer pays less, choose 'No' on Full payment."
                  showActions={false}
                />
              ) : (
                <EmptyState
                  icon={<Wallet size={48} strokeWidth={1.5} />}
                  title="No advances yet"
                  message="When a customer pays before taking the order, save it as an advance."
                  showActions={false}
                  action={isViewingOther ? undefined : (
                    <button type="button" onClick={() => setNewAdvance(true)} className={cn(btnPrimary, 'w-full max-w-xs')}>
                      <Plus size={18} /> New advance
                    </button>
                  )}
                />
              )
            ) : (
              <ul className="flex flex-col gap-2" aria-label={segment === 'due' ? 'Udhaar' : 'Advances'}>
                {list.results.map((r) => (
                  <Row
                    key={r._id}
                    title={r.customerName || 'Customer'}
                    tail={phoneTail(r.customerPhone)}
                    sub={`${r.itemLabel ? `${r.itemLabel} · ` : ''}${sinceLabel(r.openedAt)}`}
                    amount={rowAmount(r)}
                    amountLabel={r.status === 'booked' ? 'Held' : 'Baqi'}
                    negative={r.status === 'due'}
                    onOpen={() => setCustomerId(r.customerId)}
                  />
                ))}
              </ul>
            )}
            <LoadMoreButton status={list.status} onLoadMore={() => list.loadMore(20)} />
          </>
        )}
      </main>

      {customerId && <CustomerSheet customerId={customerId} onClose={() => setCustomerId(null)} />}
      {pendingId && <PendingEntrySheet rowId={pendingId} categories={[]} onClose={() => setPendingId(null)} />}
      {newAdvance && !isViewingOther && <AdvanceSheet onClose={() => setNewAdvance(false)} />}
    </div>
  )
}

function Row({ title, tail, sub, amount, amountLabel, negative, onOpen }: {
  title: string
  tail: string | null
  sub: string
  amount: number
  amountLabel: string
  negative: boolean
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-3 min-h-15 px-4 py-2.5 rounded-2xl border border-border/70 bg-card text-left hover:bg-muted/40 active:scale-[0.97] transition-all"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-foreground truncate">
            {title}{tail && <span className="font-medium text-muted-foreground"> · {tail}</span>}
          </span>
          <span className="block text-[13px] text-muted-foreground truncate">{sub}</span>
        </span>
        <span className="text-right shrink-0">
          {amountLabel && <span className="block text-[12px] font-semibold text-muted-foreground">{amountLabel}</span>}
          <Amount value={amount} className={cn('text-base font-bold', negative ? 'text-negative' : 'text-foreground')} />
        </span>
        <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" aria-hidden />
      </button>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden data-testid="khata-skeleton">
      {[0, 1, 2].map((i) => <div key={i} className="skeleton h-15 rounded-2xl" />)}
    </div>
  )
}
