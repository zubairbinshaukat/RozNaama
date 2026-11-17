import { useId, useState } from 'react'
import { AlertCircle, Check, Loader2, Pencil, Phone, UserRound } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import { useToast } from '@/components/shared/Toast'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import { useKhataActions } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { checkAmount } from '@/lib/amount'
import { getErrorMessage } from '@/lib/errors'
import { CUSTOMER_NAME_MAX, KHATA_ITEM_LABEL_MAX, PHONE_MAX, phoneProblem, toPaisa, type KhataCustomer, type KhataDetailEntry } from '@/lib/khata'
import { NOTE_MAX } from '@/lib/constants'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { cn } from '@/lib/utils'
import DueDateField from './DueDateField'
import { entryTitle } from './model'

function Footer({ saving, onCancel, onSave, label }: { saving: boolean; onCancel: () => void; onSave: () => void; label: string }) {
  const canEdit = useCanEditOnline()
  return (
    <SheetFooter>
      {!canEdit && <OfflineEditNote className="mb-3" />}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} disabled={saving} className={cn(btnSecondary, 'flex-1')}>Cancel</button>
        <button type="button" onClick={onSave} disabled={saving} className={cn(btnPrimary, 'flex-2')}>
          {saving
            ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
            : <><Check size={18} /> {label}</>}
        </button>
      </div>
    </SheetFooter>
  )
}

/** Edit a record: bill (when it has one or is booked), item, note, ready-by date. Online only. */
export function EditEntrySheet({ entry, onClose }: { entry: KhataDetailEntry; onClose: () => void }) {
  const titleId = useId()
  const uid = useId()
  const [total, setTotal] = useState(entry.total !== undefined ? String(entry.total) : '')
  const [itemLabel, setItemLabel] = useState(entry.itemLabel ?? '')
  const [note, setNote] = useState(entry.note ?? '')
  const [dueDate, setDueDate] = useState<number | null>(entry.dueDate ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { updateEntry } = useKhataActions()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const close = () => { if (!saving) onClose() }
  const canEditTotal = entry.status !== 'cancelled'

  const save = async () => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    let totalValue: number | undefined
    if (canEditTotal && total.trim() !== '') {
      const t = checkAmount(total, 'bill')
      if (!t.ok) { setError(t.message); return }
      if (entry.total === undefined || toPaisa(t.value) !== toPaisa(entry.total)) totalValue = t.value
    }
    setSaving(true)
    setError(null)
    try {
      await updateEntry({
        entryId: entry._id,
        ...(totalValue !== undefined ? { total: totalValue } : {}),
        itemLabel: itemLabel.trim(),
        note: note.trim(),
        dueDate: dueDate,
      })
      showToast('Record updated', 'success')
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not update the record. Try again.')
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} layer={580}>
      <SheetHeader titleId={titleId} title="Edit record" subtitle={entryTitle(entry)} icon={<Pencil size={18} />} onClose={close} closeDisabled={saving} />
      <SheetBody className="flex flex-col gap-4">
        {canEditTotal && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-total`} className={fieldLabel}>Total bill</label>
            <AmountInput id={`${uid}-total`} value={total} onChange={(v) => { setTotal(v); setError(null) }} invalid={error !== null} disabled={saving} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-item`} className={fieldLabel}>Item <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input id={`${uid}-item`} type="text" value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} maxLength={KHATA_ITEM_LABEL_MAX} autoComplete="off" disabled={saving} className={inputBase} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-note`} className={fieldLabel}>Note <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input id={`${uid}-note`} type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} autoComplete="off" disabled={saving} className={inputBase} />
        </div>
        {entry.kind === 'advance' && entry.status === 'booked' && (
          <DueDateField value={dueDate} onChange={setDueDate} disabled={saving} />
        )}
        {error && <p className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>}
      </SheetBody>
      <Footer saving={saving} onCancel={close} onSave={() => void save()} label="Save" />
    </Sheet>
  )
}

/** Rename a customer / change or clear the phone. Online only. */
export function EditCustomerSheet({ customer, onClose }: { customer: KhataCustomer; onClose: () => void }) {
  const titleId = useId()
  const uid = useId()
  const [name, setName] = useState(customer.name)
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { updateCustomer } = useKhataActions()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const close = () => { if (!saving) onClose() }

  const save = async () => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    if (!name.trim()) { setError('Write the customer name.'); return }
    const p = phoneProblem(phone, PHONE_MAX)
    if (p) { setError(p); return }
    setSaving(true)
    setError(null)
    try {
      await updateCustomer({ customerId: customer._id, name: name.trim(), phone: phone.trim() })
      showToast('Customer updated', 'success')
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not update the customer. Try again.')
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} layer={580}>
      <SheetHeader titleId={titleId} title="Edit customer" icon={<UserRound size={18} />} onClose={close} closeDisabled={saving} />
      <SheetBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-name`} className={fieldLabel}>Name</label>
          <input id={`${uid}-name`} type="text" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} maxLength={CUSTOMER_NAME_MAX} autoComplete="off" disabled={saving} aria-invalid={error ? true : undefined} className={cn(inputBase, error && inputInvalid)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-phone`} className={fieldLabel}>Phone <span className="font-normal text-muted-foreground">(optional)</span></label>
          <div className="relative">
            <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input id={`${uid}-phone`} type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setError(null) }} maxLength={PHONE_MAX + 6} autoComplete="off" disabled={saving} className={cn(inputBase, 'pl-11')} />
          </div>
        </div>
        {error && <p className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>}
      </SheetBody>
      <Footer saving={saving} onCancel={close} onSave={() => void save()} label="Save" />
    </Sheet>
  )
}
