import { useId, useMemo, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { ChevronRight, HandCoins, MessageCircle, MoreHorizontal, PackageCheck, Pencil, Receipt, Trash2, UserRound, Wallet } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import { useToast } from '@/components/shared/Toast'
import ConfirmModal from '@/components/modals/ConfirmModal'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import { useCustomerDetail, useKhataActions, usePendingKhata } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { getErrorMessage } from '@/lib/errors'
import { whatsAppReminderLink, type KhataDetailEntry } from '@/lib/khata'
import { btnOutline, btnPrimary, btnSecondary } from '@/lib/ui'
import { cn, formatDate } from '@/lib/utils'
import type { Id } from '../../../convex/_generated/dataModel'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import CompleteOrderSheet from './CompleteOrderSheet'
import { EditCustomerSheet } from './EditSheets'
import RecordMenu, { ActionsSheet, ChooseEntrySheet } from './RecordMenu'
import Timeline from './Timeline'
import { buildTimeline, entryTitle, pendingForCustomer, recordSub, rowAmount, toTarget, type EntryTarget } from './model'

interface CustomerSheetProps {
  customerId: Id<'customers'>
  onClose:    () => void
  /** Opened from a day-list row: that row's record shows "See sale" (edit / delete the sale itself). */
  focusEntryId?: Id<'khataEntries'>
  onOpenSale?:   () => void
}

/**
 * One customer: Baqi / advance held, open records (each with ⋯), history, and
 * one big "Receive payment" (+ "Complete order" for a booking). Read-only in view-as.
 */
export default function CustomerSheet({ customerId, onClose, focusEntryId, onOpenSale }: CustomerSheetProps) {
  const titleId = useId()
  const detail = useCustomerDetail(customerId)
  const pendingAll = usePendingKhata()
  const readOnly = useIsViewingOtherSafe()
  const canEdit = useCanEditOnline()
  const { user } = useUser()
  const { archiveCustomer } = useKhataActions()
  const { showToast } = useToast()
  const [paying, setPaying] = useState<EntryTarget | null>(null)
  const [completing, setCompleting] = useState<EntryTarget | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [customerMenu, setCustomerMenu] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [busy, setBusy] = useState(false)

  const customer = detail?.customer
  const entries = useMemo(() => detail?.entries ?? [], [detail])
  const open = useMemo(() => entries.filter((e) => e.status === 'booked' || e.status === 'due'), [entries])
  const pending = useMemo(() => {
    if (!customer) return []
    return pendingForCustomer(pendingAll, customer, new Set(entries.map((e) => e._id as string)))
  }, [pendingAll, customer, entries])
  const timeline = useMemo(() => buildTimeline(entries, pending), [entries, pending])

  const targetOf = (e: KhataDetailEntry) => toTarget(e, customer?.name ?? null)
  const startPayment = () => {
    const only = open.length === 1 ? open[0] : undefined
    if (only) setPaying(targetOf(only))
    else setChoosing(true)
  }

  const archive = async () => {
    if (!customer) return
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    setBusy(true)
    try {
      await archiveCustomer({ customerId: customer._id })
      showToast(`${customer.name} hidden`, 'success')
      setArchiving(false)
      onClose()
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
  const single = open.length === 1 ? targetOf(open[0]!) : null

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
                <a href={remind} target="_blank" rel="noreferrer" className={cn(btnOutline, 'flex-1 min-h-11 px-3 text-[15px]')}>
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
                            {recordSub({ openedAt: e.openedAt })}{e.dueDate !== undefined ? ` · ready by ${formatDate(e.dueDate)}` : ''}
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
                          <RecordMenu
                            record={e}
                            customerName={customer.name}
                            onPay={() => setPaying(targetOf(e))}
                            onComplete={() => setCompleting(targetOf(e))}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Timeline events={timeline} capped={detail.entriesCapped} />
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
              {single?.status === 'booked' && (
                <button
                  type="button"
                  onClick={() => (canEdit ? setCompleting(single) : showToast(OFFLINE_EDIT_MESSAGE, 'error'))}
                  className={cn(btnOutline, 'w-full')}
                >
                  <PackageCheck size={18} /> Complete order
                </button>
              )}
            </div>
          )}
        </SheetFooter>
      </Sheet>

      {choosing && (
        <ChooseEntrySheet entries={open} onClose={() => setChoosing(false)} onPick={(e) => { setChoosing(false); setPaying(targetOf(e)) }} />
      )}
      {paying && <ReceivePaymentSheet target={paying} onClose={() => setPaying(null)} />}
      {completing && <CompleteOrderSheet target={completing} onClose={() => setCompleting(null)} />}
      {editingCustomer && customer && <EditCustomerSheet customer={customer} onClose={() => setEditingCustomer(false)} />}
      {customerMenu && customer && (
        <ActionsSheet
          title={customer.name}
          onClose={() => setCustomerMenu(false)}
          items={[
            { icon: <Pencil size={18} />, label: 'Edit name / phone', run: () => (canEdit ? setEditingCustomer(true) : showToast(OFFLINE_EDIT_MESSAGE, 'error')) },
            { icon: <Trash2 size={18} />, label: 'Hide customer', danger: true, run: () => setArchiving(true) },
          ]}
        />
      )}
      {archiving && customer && (
        <ConfirmModal
          title={`Hide ${customer.name}?`}
          message={`${customer.name} will not show in the customer list. Old records stay.`}
          confirmLabel="Hide"
          destructive
          loading={busy}
          onConfirm={() => void archive()}
          onClose={() => setArchiving(false)}
        />
      )}
    </>
  )
}
