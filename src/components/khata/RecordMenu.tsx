import { useId, useState, type ReactNode } from 'react'
import {
  Ban, Check, ChevronRight, HandCoins, HandHeart, Loader2, MoreHorizontal, PackageCheck, Pencil, RotateCcw,
  Trash2, UserMinus, UserPen, UserPlus,
} from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import { useToast } from '@/components/shared/Toast'
import ConfirmModal from '@/components/modals/ConfirmModal'
import { useFormatMoney } from '@/context/amountVisibility'
import { useKhataActions } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { getErrorMessage } from '@/lib/errors'
import { btnDangerGhost, btnPrimary, btnSecondary } from '@/lib/ui'
import { cn, startOfDay } from '@/lib/utils'
import CustomerField from './CustomerField'
import { EditEntrySheet } from './EditSheets'
import { customerArg, customerProblem, EMPTY_CUSTOMER, fieldName, type CustomerFieldValue } from './customer'
import { displayName, entryTitle, nameSuffix, recordSub, rowAmount, type EntryLike } from './model'

export type MenuRecord = EntryLike & { note?: string; dueDate?: number }

type Confirm = 'forgive' | 'refund' | 'keep' | 'delete'

interface RecordMenuProps {
  record:       MenuRecord
  customerName: string | null
  onPay:        () => void
  onComplete:   () => void
  /** Called after "Delete" (e.g. close an entry sheet). */
  onDeleted?:   () => void
}

/**
 * ⋯ for one record: Complete order, Receive payment, Edit, Add name / Change
 * customer / Remove name, Forgive Baqi, Cancel & refund / keep, Delete.
 * Everything but payments needs internet; every change asks to confirm.
 */
export default function RecordMenu({ record, customerName, onPay, onComplete, onDeleted }: RecordMenuProps) {
  const actions = useKhataActions()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const name = customerName?.trim() || null
  const shown = displayName(name)

  const onlineOnly = (fn: () => void) => () => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    fn()
  }
  const isOpen = record.status === 'booked' || record.status === 'due'

  const run = async () => {
    if (!confirm) return
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    setBusy(true)
    try {
      if (confirm === 'forgive') {
        const out = await actions.forgiveRemaining({ entryId: record._id })
        showToast(`Forgave ${money(out.forgiven)}${nameSuffix(name)}`, 'success')
      } else if (confirm === 'refund') {
        await actions.cancelAdvance({ entryId: record._id, refund: true, at: startOfDay() })
        showToast(`Cancelled · refunded ${money(record.paid)}${nameSuffix(name)}`, 'success')
      } else if (confirm === 'keep') {
        await actions.cancelAdvance({ entryId: record._id, refund: false, at: startOfDay() })
        showToast(`Cancelled · kept ${money(record.paid)}${nameSuffix(name)}`, 'success')
      } else {
        await actions.removeEntry({ entryId: record._id })
        showToast('Record deleted', 'success')
        onDeleted?.()
      }
      setConfirm(null)
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not save. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const items: ActionItem[] = [
    ...(record.status === 'booked' ? [{ icon: <PackageCheck size={18} />, label: 'Complete order', run: onlineOnly(onComplete) }] : []),
    ...(isOpen ? [{ icon: <HandCoins size={18} />, label: 'Receive payment', run: onPay }] : []),
    { icon: <Pencil size={18} />, label: 'Edit', run: onlineOnly(() => setEditing(true)) },
    name
      ? { icon: <UserPen size={18} />, label: 'Change customer', run: onlineOnly(() => setAssigning(true)) }
      : { icon: <UserPlus size={18} />, label: 'Add name', run: onlineOnly(() => setAssigning(true)) },
    ...(record.status === 'due' ? [{ icon: <HandHeart size={18} />, label: 'Forgive Baqi', run: () => setConfirm('forgive') }] : []),
    ...(record.status === 'booked'
      ? [
          { icon: <RotateCcw size={18} />, label: 'Cancel & refund', run: () => setConfirm('refund') },
          { icon: <Ban size={18} />, label: 'Cancel, keep advance', run: () => setConfirm('keep') },
        ]
      : []),
    { icon: <Trash2 size={18} />, label: 'Delete (added by mistake)', danger: true, run: () => setConfirm('delete') },
  ]

  return (
    <>
      <button
        type="button"
        onClick={() => setMenu(true)}
        aria-label={`More for ${entryTitle(record)}`}
        className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-[0.97] transition-all"
      >
        <MoreHorizontal size={18} />
      </button>

      {menu && <ActionsSheet title={`${entryTitle(record)} · ${shown}`} items={items} onClose={() => setMenu(false)} />}
      {editing && <EditEntrySheet entry={record} onClose={() => setEditing(false)} />}
      {assigning && <AssignCustomerSheet entryId={record._id} title={entryTitle(record)} currentName={name} onClose={() => setAssigning(false)} />}
      {confirm && (
        <ConfirmModal
          title={
            confirm === 'forgive' ? 'Forgive Baqi?'
              : confirm === 'refund' ? 'Cancel and refund?'
                : confirm === 'keep' ? 'Cancel and keep advance?' : 'Delete record?'
          }
          message={
            confirm === 'forgive' ? `${name ?? 'The customer'} will not owe ${money(record.remaining ?? 0)} any more. Your sales stay the same.`
              : confirm === 'refund' ? `Give ${money(record.paid)} back${name ? ` to ${name}` : ''} and close this booking.`
                : confirm === 'keep' ? `Close this booking. You keep ${money(record.paid)}.`
                  : `Added by mistake? This removes "${entryTitle(record)}" with its payments and sales.`
          }
          confirmLabel={confirm === 'forgive' ? 'Forgive' : confirm === 'refund' ? 'Refund' : confirm === 'keep' ? 'Keep advance' : 'Delete'}
          destructive={confirm === 'delete'}
          loading={busy}
          onConfirm={() => void run()}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}

/** "Add name" / "Change customer" for one record (online only). */
export function AssignCustomerSheet({ entryId, title, currentName, onClose }: {
  entryId:     MenuRecord['_id']
  title:       string
  currentName: string | null
  onClose:     () => void
}) {
  const titleId = useId()
  const [value, setValue] = useState<CustomerFieldValue>(EMPTY_CUSTOMER)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { setEntryCustomer } = useKhataActions()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const close = () => { if (!saving) onClose() }

  const save = async (remove: boolean) => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    const problem = remove ? null : customerProblem(value)
    if (problem) { setError(problem); return }
    const customer = remove ? null : (customerArg(value) ?? null)
    if (!remove && customer === null) { setError('Write a name or tap a customer.'); return }
    setSaving(true)
    try {
      await setEntryCustomer({ entryId, customer })
      showToast(remove ? 'Name removed' : `Saved · ${fieldName(value) ?? ''}`.trim(), 'success')
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not save. Try again.')
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} layer={580}>
      <SheetHeader
        titleId={titleId}
        title={currentName ? 'Change customer' : 'Add name'}
        subtitle={currentName ? `${title} · now ${currentName}` : title}
        icon={currentName ? <UserPen size={18} /> : <UserPlus size={18} />}
        onClose={close}
        closeDisabled={saving}
      />
      <SheetBody className="flex flex-col gap-4">
        <CustomerField value={value} onChange={(v) => { setValue(v); setError(null) }} disabled={saving} error={error} />
      </SheetBody>
      <SheetFooter>
        {!canEdit && <OfflineEditNote className="mb-3" />}
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>Cancel</button>
            <button type="button" onClick={() => void save(false)} disabled={saving} className={cn(btnPrimary, 'flex-2')}>
              {saving ? <Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> : <Check size={18} />} Save
            </button>
          </div>
          {currentName && (
            <button type="button" onClick={() => void save(true)} disabled={saving} className={cn(btnDangerGhost, 'w-full')}>
              <UserMinus size={18} /> Remove name
            </button>
          )}
        </div>
      </SheetFooter>
    </Sheet>
  )
}

export type ActionItem = { icon: ReactNode; label: string; run: () => void; danger?: boolean }

/** ⋯ menu as a small bottom sheet (one big row per action). */
export function ActionsSheet({ title, items, onClose }: { title: string; items: ActionItem[]; onClose: () => void }) {
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
export function ChooseEntrySheet<E extends EntryLike>({ entries, onPick, onClose, title = 'Which one?' }: {
  entries: readonly E[]
  onPick:  (e: E) => void
  onClose: () => void
  title?:  string
}) {
  const titleId = useId()
  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={550} size="sm">
      <SheetHeader titleId={titleId} title={title} subtitle="Choose the record for this payment" icon={<HandCoins size={18} />} onClose={onClose} />
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
              <span className="block text-[13px] text-muted-foreground">{recordSub({ openedAt: e.openedAt })}</span>
            </span>
            <Amount value={rowAmount(e)} className={cn('text-base font-bold', e.status === 'due' ? 'text-negative' : 'text-foreground')} />
            <ChevronRight size={16} className="text-muted-foreground/60" aria-hidden />
          </button>
        ))}
      </SheetBody>
    </Sheet>
  )
}
