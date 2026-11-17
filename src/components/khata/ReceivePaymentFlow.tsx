import { useId, useMemo, useState } from 'react'
import { ChevronRight, HandCoins, Search } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import SuggestionChips from '@/components/shared/SuggestionChips'
import { useKhataOpenList } from '@/hooks/useKhata'
import { customerNameKey, NO_NAME, type KhataOpenRow } from '@/lib/khata'
import { btnSecondary, fieldHint, inputBase } from '@/lib/ui'
import { cn } from '@/lib/utils'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import { ChooseEntrySheet } from './RecordMenu'
import { customerChipLabel } from './customer'
import { entryTitle, groupOpenRows, recordSub, rowAmount, targetFromRow, type EntryTarget, type OpenGroup } from './model'

/** Open records loaded for the picker (Udhaar + advances). */
const PICKER_PAGE = 100

type CustomerGroup = Extract<OpenGroup, { kind: 'customer' }>

/**
 * FAB "Receive payment": search + chips of customers with open records
 * (like product chips), records without a name as their own rows →
 * (which record) → payment sheet.
 */
export default function ReceivePaymentFlow({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<EntryTarget | null>(null)
  const [choosing, setChoosing] = useState<CustomerGroup | null>(null)
  const due = useKhataOpenList('due', PICKER_PAGE)
  const booked = useKhataOpenList('booked', PICKER_PAGE)
  const loading = due.status === 'LoadingFirstPage' || booked.status === 'LoadingFirstPage'

  const groups = useMemo(() => groupOpenRows([...due.results, ...booked.results]), [due.results, booked.results])
  const key = customerNameKey(search)
  const customers = useMemo(() => {
    const named = groups.filter((g): g is CustomerGroup => g.kind === 'customer')
    if (!key) return named
    const k = (g: CustomerGroup) => customerNameKey(g.name)
    return [...named.filter((g) => k(g).startsWith(key)), ...named.filter((g) => !k(g).startsWith(key) && k(g).includes(key))]
  }, [groups, key])
  const nameless = useMemo(
    () => groups
      .filter((g): g is Extract<OpenGroup, { kind: 'record' }> => g.kind === 'record')
      .map((g) => g.row)
      .filter((r) => !key || customerNameKey(r.itemLabel ?? '').includes(key)),
    [groups, key],
  )
  const labels = useMemo(() => customers.map((g) => customerChipLabel(g)), [customers])

  const pickCustomer = (g: CustomerGroup) => {
    const only = g.rows.length === 1 ? g.rows[0] : undefined
    if (only) setTarget(targetFromRow(only))
    else setChoosing(g)
  }

  if (target) return <ReceivePaymentSheet target={target} onClose={onClose} />
  if (choosing) {
    return (
      <ChooseEntrySheet<KhataOpenRow>
        title={choosing.name}
        entries={choosing.rows}
        onClose={() => setChoosing(null)}
        onPick={(row) => setTarget(targetFromRow(row))}
      />
    )
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId}>
      <SheetHeader titleId={titleId} title="Receive payment" subtitle="Who paid?" icon={<HandCoins size={18} />} onClose={onClose} />
      <SheetBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
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
          {loading ? (
            <div className="flex gap-2" aria-hidden>
              <div className="skeleton h-11 w-24 rounded-full" />
              <div className="skeleton h-11 w-20 rounded-full" />
            </div>
          ) : (
            <SuggestionChips
              items={labels}
              query={search}
              onPick={(l) => { const g = customers[labels.indexOf(l)]; if (g) pickCustomer(g) }}
              aria-label="Customers with Baqi or advance"
            />
          )}
        </div>

        {nameless.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Records without a name">
            {nameless.map((r) => (
              <li key={r._id}>
                <button
                  type="button"
                  onClick={() => setTarget(targetFromRow(r))}
                  className="w-full flex items-center gap-3 min-h-15 px-4 py-2.5 rounded-2xl border border-border/70 bg-card text-left hover:bg-muted/40 active:scale-[0.97] transition-all"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-semibold text-muted-foreground truncate">{NO_NAME} · {entryTitle(r)}</span>
                    <span className="block text-[13px] text-muted-foreground truncate">{recordSub({ openedAt: r.openedAt })}</span>
                  </span>
                  <Amount value={rowAmount(r)} className={cn('text-base font-bold', r.status === 'due' ? 'text-negative' : 'text-foreground')} />
                  <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loading && customers.length === 0 && nameless.length === 0 && (
          <p className={fieldHint}>{key ? 'Nothing open by that name.' : 'Nobody has Baqi or an advance.'}</p>
        )}
      </SheetBody>
      <SheetFooter>
        <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>Cancel</button>
      </SheetFooter>
    </Sheet>
  )
}
