import { useId, useState } from 'react'
import { AlertCircle, Check, Loader2, PackageCheck } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import Amount from '@/components/shared/Amount'
import DateField from '@/components/shared/DateField'
import { useToast } from '@/components/shared/Toast'
import OfflineEditNote from '@/components/shared/OfflineEditNote'
import { useFormatMoney } from '@/context/amountVisibility'
import { useKhataActions } from '@/hooks/useKhata'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { checkAmount } from '@/lib/amount'
import { getErrorMessage } from '@/lib/errors'
import { subMoney, toPaisa } from '@/lib/khata'
import { btnPrimary, btnSecondary, chip, chipActive, chipIdle, fieldError, fieldLabel } from '@/lib/ui'
import { clampSaleDateToTodayMs, cn, startOfDay } from '@/lib/utils'
import { entryTitle, type EntryTarget } from './model'

/** Handover of a booked order: final bill, cash received now (already-paid shown). Online only. */
export default function CompleteOrderSheet({ target, onClose }: { target: EntryTarget; onClose: () => void }) {
  const titleId = useId()
  const uid = useId()
  const [bill, setBill] = useState(target.total !== undefined ? String(target.total) : '')
  const [received, setReceived] = useState(() =>
    target.total !== undefined ? String(Math.max(0, subMoney(target.total, target.paid))) : '')
  const [dateMs, setDateMs] = useState(() => startOfDay())
  const [errors, setErrors] = useState<{ bill?: string; received?: string }>({})
  const [saving, setSaving] = useState(false)
  const { completeAdvance } = useKhataActions()
  const canEdit = useCanEditOnline()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const close = () => { if (!saving) onClose() }

  const billValue = parseFloat(bill)
  const left = Number.isFinite(billValue) ? Math.max(0, subMoney(billValue, target.paid)) : null
  const receivedValue = received.trim() === '' ? 0 : parseFloat(received)
  const baqiAfter = left !== null && Number.isFinite(receivedValue) ? Math.max(0, subMoney(left, receivedValue)) : null
  const fullLeft = left !== null && left > 0 && toPaisa(receivedValue) === toPaisa(left)

  const save = async () => {
    if (!canEdit) { showToast(OFFLINE_EDIT_MESSAGE, 'error'); return }
    const next: { bill?: string; received?: string } = {}
    const b = checkAmount(bill, 'bill')
    if (!b.ok) next.bill = b.message
    else if (toPaisa(b.value) < toPaisa(target.paid)) next.bill = "Bill can't be less than advance. Use Cancel & refund."
    if (received.trim() !== '' && (!Number.isFinite(receivedValue) || receivedValue < 0)) next.received = 'Check the amount.'
    else if (b.ok && toPaisa(receivedValue) > toPaisa(subMoney(b.value, target.paid))) {
      next.received = `More than Baqi (${money(Math.max(0, subMoney(b.value, target.paid)))})`
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || !b.ok) return
    setSaving(true)
    try {
      const out = await completeAdvance({
        entryId:     target.entryId,
        finalTotal:  b.value,
        receivedNow: receivedValue,
        deliveredAt: clampSaleDateToTodayMs(dateMs),
      })
      showToast(out.remaining > 0
        ? `Order handed over · Baqi ${money(out.remaining)} (${target.customerName})`
        : `Order handed over · ${target.customerName} paid in full`, 'success')
      onClose()
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not complete the order. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} layer={560}>
      <SheetHeader
        titleId={titleId}
        title="Complete order"
        subtitle={<>{target.customerName} · {entryTitle(target)}</>}
        icon={<PackageCheck size={18} />}
        onClose={close}
        closeDisabled={saving}
      />
      <SheetBody className="flex flex-col gap-4">
        <div className="rounded-3xl bg-muted/50 px-5 py-4">
          <p className="text-sm font-semibold text-muted-foreground">Already paid (advance)</p>
          <p className="text-[2rem] font-bold tabular tracking-tight leading-tight text-foreground"><Amount value={target.paid} /></p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-bill`} className={fieldLabel}>Final bill</label>
          <AmountInput
            id={`${uid}-bill`}
            value={bill}
            onChange={(v) => { setBill(v); setErrors((e) => ({ ...e, bill: undefined })) }}
            invalid={Boolean(errors.bill)}
            disabled={saving}
          />
          {errors.bill && <p className={fieldError} role="alert"><AlertCircle size={16} /> {errors.bill}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-received`} className={fieldLabel}>Received now</label>
          <AmountInput
            id={`${uid}-received`}
            value={received}
            onChange={(v) => { setReceived(v); setErrors((e) => ({ ...e, received: undefined })) }}
            invalid={Boolean(errors.received)}
            disabled={saving}
          />
          {left !== null && left > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                aria-pressed={fullLeft}
                onClick={() => setReceived(String(left))}
                className={cn(chip, fullLeft ? chipActive : chipIdle)}
              >
                {fullLeft && <Check size={16} aria-hidden />} Full · <Amount value={left} />
              </button>
            </div>
          )}
          {errors.received && <p className={fieldError} role="alert"><AlertCircle size={16} /> {errors.received}</p>}
          {baqiAfter !== null && baqiAfter > 0 && !errors.received && (
            <p className="text-lg font-bold text-negative" aria-live="polite">Baqi: <Amount value={baqiAfter} /></p>
          )}
        </div>

        <DateField label="Handover date" value={dateMs} onChange={(ms) => setDateMs(clampSaleDateToTodayMs(ms))} disabled={saving} />
      </SheetBody>
      <SheetFooter>
        {!canEdit && <OfflineEditNote className="mb-3" />}
        <div className="flex gap-3">
          <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className={cn(btnPrimary, 'flex-2')}>
            {saving
              ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
              : <><Check size={18} /> Hand over</>}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
