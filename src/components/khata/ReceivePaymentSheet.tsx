import { useId, useRef, useState } from 'react'
import { AlertCircle, Check, HandCoins, Loader2 } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import Amount from '@/components/shared/Amount'
import DateField from '@/components/shared/DateField'
import { useToast } from '@/components/shared/Toast'
import { queuedToast } from '@/components/modals/submitToasts'
import { useFormatMoney } from '@/context/amountVisibility'
import { useSubmitEntry } from '@/hooks/useSubmitEntry'
import { checkAmount } from '@/lib/amount'
import { getErrorMessage } from '@/lib/errors'
import { toPaisa } from '@/lib/khata'
import { btnPrimary, btnSecondary, chip, chipActive, chipIdle, fieldError, fieldLabel } from '@/lib/ui'
import { clampSaleDateToTodayMs, cn, startOfDay } from '@/lib/utils'
import { entryTitle, type EntryTarget } from './model'

interface ReceivePaymentSheetProps {
  target:  EntryTarget
  onClose: () => void
  /** Called after a save (server or phone). */
  onDone?: () => void
}

/** Amount (with a "Full Baqi" chip), date → khata.receivePayment (offline-safe). */
export default function ReceivePaymentSheet({ target, onClose, onDone }: ReceivePaymentSheetProps) {
  const titleId = useId()
  const amountId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [amount, setAmount] = useState('')
  const [dateMs, setDateMs] = useState(() => startOfDay())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { submitPayment } = useSubmitEntry()
  const { showToast } = useToast()
  const money = useFormatMoney()

  const remaining = target.remaining
  const isFull = remaining !== null && amount !== '' && toPaisa(parseFloat(amount)) === toPaisa(remaining)
  const close = () => { if (!saving) onClose() }

  const save = async () => {
    const check = checkAmount(amount)
    if (!check.ok) { setError(check.message); inputRef.current?.focus(); return }
    if (remaining !== null && toPaisa(check.value) > toPaisa(remaining)) {
      setError(`More than Baqi (${money(remaining)})`)
      inputRef.current?.focus()
      return
    }
    if (dateMs < startOfDay(new Date(target.openedAt))) {
      setError("Date can't be before the record started")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const out = await submitPayment({
        entryId:      target.entryId,
        amount:       check.value,
        receivedAt:   clampSaleDateToTodayMs(dateMs),
        customerName: target.customerName,
        customerId:   target.customerId,
        entryKind:    target.kind,
        recognition:  target.recognition,
      })
      if (out.status === 'saved') {
        const left = out.result.remaining
        showToast(
          left === null || target.status === 'booked'
            ? `Received ${money(check.value)} (${target.customerName})`
            : left > 0
              ? `Received ${money(check.value)} · Baqi ${money(left)} (${target.customerName})`
              : `Received ${money(check.value)} · ${target.customerName} paid in full`,
          'success',
        )
      } else {
        const t = queuedToast(out.problem)
        showToast(t.message, t.type)
      }
      onDone?.()
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not save the payment. Try again.')
      setError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} layer={560} initialFocusRef={inputRef}>
      <SheetHeader
        titleId={titleId}
        title="Receive payment"
        subtitle={<>{target.customerName} · {entryTitle(target)}</>}
        icon={<HandCoins size={18} />}
        onClose={close}
        closeDisabled={saving}
      />
      <SheetBody className="flex flex-col gap-4">
        <div className="rounded-3xl bg-muted/50 px-5 py-4">
          <p className="text-sm font-semibold text-muted-foreground">
            {target.status === 'booked' ? 'Advance received so far' : 'Baqi'}
          </p>
          <p className={cn('text-[2rem] font-bold tabular tracking-tight leading-tight', target.status === 'booked' ? 'text-foreground' : 'text-negative')}>
            <Amount value={target.status === 'booked' ? target.paid : (remaining ?? 0)} />
          </p>
          {target.status === 'booked' && remaining !== null && (
            <p className="text-[15px] text-muted-foreground mt-0.5">Left to pay: <Amount value={remaining} /></p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={amountId} className={fieldLabel}>Amount received</label>
          <AmountInput
            id={amountId}
            inputRef={inputRef}
            size="lg"
            value={amount}
            onChange={(v) => { setAmount(v); setError(null) }}
            invalid={error !== null}
            disabled={saving}
            aria-describedby={error ? `${amountId}-err` : undefined}
          />
          {remaining !== null && remaining > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                aria-pressed={isFull}
                onClick={() => { setAmount(String(remaining)); setError(null) }}
                className={cn(chip, isFull ? chipActive : chipIdle)}
              >
                {isFull && <Check size={16} aria-hidden />}
                {target.status === 'booked' ? 'Full amount' : 'Full Baqi'} · <Amount value={remaining} />
              </button>
            </div>
          )}
          {error && (
            <p id={`${amountId}-err`} className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>
          )}
        </div>

        <DateField label="Date" value={dateMs} onChange={(ms) => setDateMs(clampSaleDateToTodayMs(ms))} disabled={saving} />
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className={cn(btnPrimary, 'flex-2')}>
            {saving
              ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
              : <><Check size={18} /> Save</>}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
