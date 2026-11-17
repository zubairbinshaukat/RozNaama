import { useId, useMemo, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import {
  Ban, ChevronRight, CloudOff, HandCoins, HandHeart, MessageCircle, MoreHorizontal, PackageCheck,
  Pencil, Receipt, RotateCcw, Trash2, UserRound, Wallet,
} from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import { useToast } from '@/components/shared/Toast'
import ConfirmModal from '@/components/modals/ConfirmModal'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import { useFormatMoney } from '@/context/amountVisibility'
import { useCustomerDetail, useKhataActions, usePendingKhata } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { getErrorMessage } from '@/lib/errors'
import { sinceLabel, whatsAppReminderLink, type KhataDetailEntry } from '@/lib/khata'
import { btnOutline, btnPrimary, btnSecondary } from '@/lib/ui'
import { cn, formatDate, startOfDay } from '@/lib/utils'
import type { Id } from '../../../convex/_generated/dataModel'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import CompleteOrderSheet from './CompleteOrderSheet'
import { EditCustomerSheet, EditEntrySheet } from './EditSheets'
import { buildTimeline, entryTitle, pendingForCustomer, rowAmount, toTarget, type EntryTarget } from './model'

interface CustomerSheetProps {
  customerId: Id<'customers'>
  onClose:    () => void
  /** Opened from a day-list row: that row's record shows "See sale" (edit / delete the sale itself). */
  focusEntryId?: Id<'khataEntries'>
  onOpenSale?:   () => void
}

type Confirm =
  | { kind: 'forgive' | 'refund' | 'keep' | 'delete'; entry: KhataDetailEntry }
  | { kind: 'archive' }

/**
 * One customer: Baqi / advance held, open records, history, and one big
 * "Receive payment" (+ "Complete order" for a booking). Read-only in view-as.
 */
export default function CustomerSheet({ customerId, onClose, focusEntryId, onOpenSale }: CustomerSheetProps) {
  const titleId = useId()
  const detail = useCustomerDetail(customerId)
  const pendingAll = usePendingKhata()
  const readOnly = useIsViewingOtherSafe()
  const canEdit = useCanEditOnline()
  const { user } = useUser()
  const actions = useKhataActions()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const [paying, setPaying] = useState<EntryTarget | null>(null)
  const [completing, setCompleting] = useState<EntryTarget | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [menuFor, setMenuFor] = useState<KhataDetailEntry | null>(null)
  const [customerMenu, setCustomerMenu] = useState(false)
  const [editing, setEditing] = useState<KhataDetailEntry | null>(null)
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)

  const customer = detail?.customer
  const entries = useMemo(() => detail?.entries ?? [], [detail])
  const open = useMemo(() => entries.filter((e) => e.status === 'booked' || e.status === 'due'), [entries])
  const pending = useMemo(() => {
    if (!customer) return []
    return pendingForCustomer(pendingAll, customer, new Set(entries.map((e) => e._id as string)))
  }, [pendingAll, customer, entries])
  const timeline = useMemo(() => buildTimeline(entries, pending), [entries, pending])

  const onlineOnly = (fn: () => void) => () => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    fn()
  }

  const startPayment = () => {
    const only = open.length === 1 ? open[0] : undefined
    if (only && customer) setPaying(toTarget(only, customer.name))
    else setChoosing(true)
  }

  const runConfirm = async () => {
    if (!confirm || !customer) return
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    setBusy(true)
    try {
      if (confirm.kind === 'archive') {
        await actions.archiveCustomer({ customerId: customer._id })
        showToast(`${customer.name} hidden`, 'success')
        setConfirm(null)
        onClose()
        return
      }
      const entry = confirm.entry
      if (confirm.kind === 'forgive') {
        const out = await actions.forgiveRemaining({ entryId: entry._id })
        showToast(`Forgave ${money(out.forgiven)} (${customer.name})`, 'success')
      } else if (confirm.kind === 'refund') {
        await actions.cancelAdvance({ entryId: entry._id, refund: true, at: startOfDay() })
        showToast(`Cancelled · refunded ${money(entry.paid)} (${customer.name})`, 'success')
      } else if (confirm.kind === 'keep') {
        await actions.cancelAdvance({ entryId: entry._id, refund: false, at: startOfDay() })
        showToast(`Cancelled · kept ${money(entry.paid)} (${customer.name})`, 'success')
      } else {
        await actions.removeEntry({ entryId: entry._id })
        showToast('Record deleted', 'success')
      }
      setConfirm(null)
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not save. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const shopName = user?.fullName?.trim() || user?.firstName?.trim() || ''
  const remind = customer && !readOnly && customer.dueTotal > 0
    ? whatsAppReminderLink(customer.phone, customer.name, customer.dueTotal, shopName)
    : null
  const target = open.length === 1 && customer ? toTarget(open[0]!, customer.name) : null

  return (
    <>
      <Sheet onClose={onClose} labelledBy={titleId} layer={540} size="lg">
        <SheetHeader
          titleId={titleId}
          title={<span className="wrap-break-word">{customer?.name ?? 'Customer'}</span>}
          subtitle={customer ? (customer.phone ? `Phone ${customer.phone}` : 'No phone') : undefined}
          icon={<UserRound size={18} />}
          onClose={onClose}
        >
          {customer && !readOnly && (
            <div className="flex gap-2 mt-3">
              {remind && (
                <a
                  href={remind}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(btnOutline, 'flex-1 min-h-11 px-3 text-[15px]')}
                >
                  <MessageCircle size={18} /> Remind on WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => setCustomerMenu(true)}
                aria-label={`More for ${customer.name}`}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-muted/70 text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all ml-auto"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          )}
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {detail === undefined ? (
            <div className="flex flex-col gap-3" aria-hidden data-testid="customer-skeleton">
              <div className="skeleton h-24 rounded-3xl" />
              <div className="skeleton h-16 rounded-2xl" />
              <div className="skeleton h-16 rounded-2xl" />
            </div>
          ) : detail === null || !customer ? (
            <EmptyState icon={<UserRound size={48} strokeWidth={1.5} />} title="Customer not found" message="This customer was removed." showActions={false} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-3xl bg-negative/8 px-4 py-3">
                  <p className="text-sm font-semibold text-muted-foreground">Baqi</p>
                  <p className="text-2xl font-bold tabular tracking-tight text-negative"><Amount value={customer.dueTotal} /></p>
                </div>
                <div className="rounded-3xl bg-muted/50 px-4 py-3">
                  <p className="text-sm font-semibold text-muted-foreground">Advance held</p>
                  <p className="text-2xl font-bold tabular tracking-tight text-foreground"><Amount value={customer.heldTotal} /></p>
                </div>
              </div>

              {open.length > 0 && (
                <section aria-label="Open records" className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground px-1">Open</h3>
                  <ul className="flex flex-col gap-2">
                    {open.map((e) => (
                      <li key={e._id} className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card pl-3.5 pr-1 py-2 min-h-15">
                        <span className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', e.kind === 'udhaar' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')} aria-hidden>
                          {e.kind === 'udhaar' ? <Receipt size={18} /> : <Wallet size={18} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-semibold text-foreground truncate">{entryTitle(e)}</span>
                          <span className="block text-[13px] text-muted-foreground">
                            {sinceLabel(e.openedAt)}{e.dueDate !== undefined ? ` · ready by ${formatDate(e.dueDate)}` : ''}
                          </span>
                          {focusEntryId === e._id && onOpenSale && (
                            <button type="button" onClick={onOpenSale} className="mt-1 inline-flex items-center gap-1 min-h-11 text-sm font-semibold text-primary active:scale-[0.97] transition-all">
                              See sale <ChevronRight size={16} />
                            </button>
                          )}
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block text-[12px] font-semibold text-muted-foreground">{e.status === 'booked' ? 'Held' : 'Baqi'}</span>
                          <Amount value={rowAmount(e)} className={cn('text-base font-bold', e.status === 'due' ? 'text-negative' : 'text-foreground')} />
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setMenuFor(e)}
                            aria-label={`More for ${entryTitle(e)}`}
                            className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-[0.97] transition-all"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-label="History" className="flex flex-col gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground px-1">History</h3>
                {timeline.length === 0 ? (
                  <p className="px-1 text-[15px] text-muted-foreground">Nothing yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70">
                    {timeline.map((t) => (
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
                {detail.entriesCapped && <p className="px-1 text-[13px] text-muted-foreground">Showing the latest 50 records.</p>}
              </section>
            </>
          )}
        </SheetBody>
        <SheetFooter>
          {readOnly || open.length === 0 ? (
            <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>Close</button>
          ) : (
            <div className="flex flex-col gap-3">
              <button type="button" onClick={startPayment} className={cn(btnPrimary, 'w-full min-h-14 text-lg')}>
                <HandCoins size={18} /> Receive payment
              </button>
              {target?.status === 'booked' && (
                <button type="button" onClick={onlineOnly(() => setCompleting(target))} className={cn(btnOutline, 'w-full')}>
                  <PackageCheck size={18} /> Complete order
                </button>
              )}
            </div>
          )}
        </SheetFooter>
      </Sheet>

      {choosing && customer && (
        <ChooseEntrySheet
          entries={open}
          onClose={() => setChoosing(false)}
          onPick={(e) => { setChoosing(false); setPaying(toTarget(e, customer.name)) }}
        />
      )}
      {paying && <ReceivePaymentSheet target={paying} onClose={() => setPaying(null)} />}
      {completing && <CompleteOrderSheet target={completing} onClose={() => setCompleting(null)} />}
      {editing && <EditEntrySheet entry={editing} onClose={() => setEditing(null)} />}
      {editingCustomer && customer && <EditCustomerSheet customer={customer} onClose={() => setEditingCustomer(false)} />}

      {menuFor && customer && (
        <ActionsSheet
          title={entryTitle(menuFor)}
          onClose={() => setMenuFor(null)}
          items={[
            ...(menuFor.status === 'booked'
              ? [{ icon: <PackageCheck size={18} />, label: 'Complete order', run: onlineOnly(() => setCompleting(toTarget(menuFor, customer.name))) }]
              : []),
            { icon: <HandCoins size={18} />, label: 'Receive payment', run: () => setPaying(toTarget(menuFor, customer.name)) },
            { icon: <Pencil size={18} />, label: 'Edit', run: onlineOnly(() => setEditing(menuFor)) },
            ...(menuFor.status === 'due'
              ? [{ icon: <HandHeart size={18} />, label: 'Forgive Baqi', run: () => setConfirm({ kind: 'forgive', entry: menuFor }) }]
              : []),
            ...(menuFor.status === 'booked'
              ? [
                  { icon: <RotateCcw size={18} />, label: 'Cancel & refund', run: () => setConfirm({ kind: 'refund', entry: menuFor }) },
                  { icon: <Ban size={18} />, label: 'Cancel, keep advance', run: () => setConfirm({ kind: 'keep', entry: menuFor }) },
                ]
              : []),
            { icon: <Trash2 size={18} />, label: 'Delete (added by mistake)', danger: true, run: () => setConfirm({ kind: 'delete', entry: menuFor }) },
          ]}
        />
      )}
      {customerMenu && customer && (
        <ActionsSheet
          title={customer.name}
          onClose={() => setCustomerMenu(false)}
          items={[
            { icon: <Pencil size={18} />, label: 'Edit name / phone', run: onlineOnly(() => setEditingCustomer(true)) },
            { icon: <Trash2 size={18} />, label: 'Hide customer', danger: true, run: () => setConfirm({ kind: 'archive' }) },
          ]}
        />
      )}

      {confirm && customer && (
        <ConfirmModal
          title={
            confirm.kind === 'forgive' ? 'Forgive Baqi?'
              : confirm.kind === 'refund' ? 'Cancel and refund?'
                : confirm.kind === 'keep' ? 'Cancel and keep advance?'
                  : confirm.kind === 'archive' ? `Hide ${customer.name}?` : 'Delete record?'
          }
          message={
            confirm.kind === 'forgive' ? `${customer.name} will not owe ${money(confirm.entry.remaining ?? 0)} any more. Your sales stay the same.`
              : confirm.kind === 'refund' ? `Give ${money(confirm.entry.paid)} back to ${customer.name} and close this booking.`
                : confirm.kind === 'keep' ? `Close this booking. You keep ${money(confirm.entry.paid)}.`
                  : confirm.kind === 'archive' ? `${customer.name} will not show in the customer list. Old records stay.`
                    : `Added by mistake? This removes "${entryTitle(confirm.entry)}" with its payments and sales.`
          }
          confirmLabel={
            confirm.kind === 'forgive' ? 'Forgive' : confirm.kind === 'refund' ? 'Refund'
              : confirm.kind === 'keep' ? 'Keep advance' : confirm.kind === 'archive' ? 'Hide' : 'Delete'
          }
          destructive={confirm.kind === 'delete' || confirm.kind === 'archive'}
          loading={busy}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}

type ActionItem = { icon: React.ReactNode; label: string; run: () => void; danger?: boolean }

/** ⋯ menu as a small bottom sheet (one big row per action). */
function ActionsSheet({ title, items, onClose }: { title: string; items: ActionItem[]; onClose: () => void }) {
  const titleId = useId()
  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={560} size="sm">
      <SheetHeader titleId={titleId} title={title} icon={<MoreHorizontal size={18} />} onClose={onClose} />
      <SheetBody className="flex flex-col gap-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => { onClose(); it.run() }}
            className={cn(
              'flex items-center gap-3 min-h-13 px-4 rounded-2xl text-left text-base font-semibold active:scale-[0.97] transition-all',
              it.danger ? 'text-negative hover:bg-negative/10' : 'text-foreground hover:bg-muted',
            )}
          >
            {it.icon} {it.label}
          </button>
        ))}
      </SheetBody>
    </Sheet>
  )
}

/** Several open records: which one is the money for? */
export function ChooseEntrySheet({ entries, onPick, onClose }: { entries: KhataDetailEntry[]; onPick: (e: KhataDetailEntry) => void; onClose: () => void }) {
  const titleId = useId()
  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={550} size="sm">
      <SheetHeader titleId={titleId} title="Which one?" subtitle="Choose the record for this payment" icon={<HandCoins size={18} />} onClose={onClose} />
      <SheetBody className="flex flex-col gap-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {entries.map((e) => (
          <button
            key={e._id}
            type="button"
            onClick={() => onPick(e)}
            className="flex items-center gap-3 min-h-15 px-4 rounded-2xl border border-border/70 text-left hover:bg-muted/60 active:scale-[0.97] transition-all"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-base font-semibold text-foreground truncate">{entryTitle(e)}</span>
              <span className="block text-[13px] text-muted-foreground">{sinceLabel(e.openedAt)}</span>
            </span>
            <Amount value={rowAmount(e)} className={cn('text-base font-bold', e.status === 'due' ? 'text-negative' : 'text-foreground')} />
            <ChevronRight size={16} className="text-muted-foreground/60" aria-hidden />
          </button>
        ))}
      </SheetBody>
    </Sheet>
  )
}
