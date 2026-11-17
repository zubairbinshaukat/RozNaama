import { useId, useMemo, useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { ChevronRight, HandCoins, MessageCircle, PackageCheck, Receipt, UserPlus, Wallet } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import { useToast } from '@/components/shared/Toast'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import { useEntryDetail, usePendingKhata } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { NO_NAME, whatsAppReminderLink } from '@/lib/khata'
import { btnOutline, btnPrimary, btnSecondary } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Id } from '../../../convex/_generated/dataModel'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import CompleteOrderSheet from './CompleteOrderSheet'
import RecordMenu, { AssignCustomerSheet } from './RecordMenu'
import Timeline from './Timeline'
import { buildTimeline, entryTitle, pendingForEntry, recordSub, rowAmount, toTarget, type EntryLike, type TimelineEntry } from './model'

interface EntrySheetProps {
  entryId:     Id<'khataEntries'>
  onClose:     () => void
  /** Opened from a day-list row: "See sale" opens the sale itself. */
  onOpenSale?: () => void
}

/**
 * One record (used for records without a name): amounts, history, Receive
 * payment / Complete order, ⋯ and "Add name". Read-only in view-as.
 */
export default function EntrySheet({ entryId, onClose, onOpenSale }: EntrySheetProps) {
  const titleId = useId()
  const detail = useEntryDetail(entryId)
  const pendingAll = usePendingKhata()
  const readOnly = useIsViewingOtherSafe()
  const canEdit = useCanEditOnline()
  const { user } = useUser()
  const { showToast } = useToast()
  const [paying, setPaying] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [naming, setNaming] = useState(false)

  const entry = detail?.entry as (EntryLike & TimelineEntry & { note?: string; dueDate?: number }) | undefined
  const customer = detail?.customer ?? null
  const name = customer?.name?.trim() || null
  const timeline = useMemo(() => {
    if (!detail || !entry) return []
    return buildTimeline([{ ...entry, payments: detail.payments }], pendingForEntry(pendingAll, entryId))
  }, [detail, entry, pendingAll, entryId])

  const isOpen = entry?.status === 'booked' || entry?.status === 'due'
  const target = entry ? toTarget(entry, name) : null
  const shopName = user?.fullName?.trim() || user?.firstName?.trim() || ''
  const remind = entry && name && !readOnly && entry.status === 'due' && (entry.remaining ?? 0) > 0
    ? whatsAppReminderLink(customer?.phone, name, entry.remaining ?? 0, shopName)
    : null

  return (
    <>
      <Sheet onClose={onClose} labelledBy={titleId} layer={540}>
        <SheetHeader
          titleId={titleId}
          title={<span className={cn('wrap-break-word', !name && 'text-muted-foreground')}>{name ?? NO_NAME}</span>}
          subtitle={entry ? `${entryTitle(entry)} · ${recordSub({ openedAt: entry.openedAt })}` : undefined}
          icon={entry?.kind === 'advance' ? <Wallet size={18} /> : <Receipt size={18} />}
          onClose={onClose}
        >
          {entry && !readOnly && (
            <div className="flex items-center gap-2 mt-3">
              {!name && (
                <button
                  type="button"
                  onClick={() => (canEdit ? setNaming(true) : showToast(OFFLINE_EDIT_MESSAGE, 'error'))}
                  className={cn(btnOutline, 'flex-1 min-h-11 px-3 text-[15px]')}
                >
                  <UserPlus size={18} /> Add name
                </button>
              )}
              {remind && (
                <a href={remind} target="_blank" rel="noreferrer" className={cn(btnOutline, 'flex-1 min-h-11 px-3 text-[15px]')}>
                  <MessageCircle size={18} /> Remind on WhatsApp
                </a>
              )}
              <span className="ml-auto">
                <RecordMenu
                  record={entry}
                  customerName={name}
                  onPay={() => setPaying(true)}
                  onComplete={() => setCompleting(true)}
                  onDeleted={onClose}
                />
              </span>
            </div>
          )}
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {detail === undefined ? (
            <div className="flex flex-col gap-3" aria-hidden data-testid="entry-skeleton">
              <div className="skeleton h-24 rounded-3xl" />
              <div className="skeleton h-16 rounded-2xl" />
            </div>
          ) : detail === null || !entry ? (
            <EmptyState icon={<Receipt size={48} strokeWidth={1.5} />} title="Record not found" message="This record was removed." showActions={false} />
          ) : (
            <>
              <div className={cn('rounded-3xl px-5 py-4', entry.status === 'due' ? 'bg-negative/8' : 'bg-muted/50')}>
                <p className="text-sm font-semibold text-muted-foreground">
                  {entry.status === 'booked' ? 'Advance held' : entry.status === 'due' ? 'Baqi' : 'Closed'}
                </p>
                <p className={cn('text-[2rem] font-bold tabular tracking-tight leading-tight', entry.status === 'due' ? 'text-negative' : 'text-foreground')}>
                  <Amount value={rowAmount(entry)} />
                </p>
                {entry.total !== undefined && (
                  <p className="text-[15px] text-muted-foreground mt-0.5">Bill: <Amount value={entry.total} /></p>
                )}
              </div>
              {onOpenSale && (
                <button type="button" onClick={onOpenSale} className="self-start inline-flex items-center gap-1 min-h-11 text-sm font-semibold text-primary active:scale-[0.97] transition-all">
                  See sale <ChevronRight size={16} />
                </button>
              )}
              <Timeline events={timeline} />
            </>
          )}
        </SheetBody>
        <SheetFooter>
          {readOnly || !isOpen ? (
            <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>Close</button>
          ) : (
            <div className="flex flex-col gap-3">
              <button type="button" onClick={() => setPaying(true)} className={cn(btnPrimary, 'w-full min-h-14 text-lg')}>
                <HandCoins size={18} /> Receive payment
              </button>
              {entry?.status === 'booked' && (
                <button
                  type="button"
                  onClick={() => (canEdit ? setCompleting(true) : showToast(OFFLINE_EDIT_MESSAGE, 'error'))}
                  className={cn(btnOutline, 'w-full')}
                >
                  <PackageCheck size={18} /> Complete order
                </button>
              )}
            </div>
          )}
        </SheetFooter>
      </Sheet>

      {paying && target && <ReceivePaymentSheet target={target} onClose={() => setPaying(false)} />}
      {completing && target && <CompleteOrderSheet target={target} onClose={() => setCompleting(false)} />}
      {naming && entry && <AssignCustomerSheet entryId={entry._id} title={entryTitle(entry)} currentName={null} onClose={() => setNaming(false)} />}
    </>
  )
}
