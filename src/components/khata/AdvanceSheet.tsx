import { useId, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, Wallet } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import AmountInput from '@/components/shared/AmountInput'
import DateField from '@/components/shared/DateField'
import { useToast } from '@/components/shared/Toast'
import { queuedToast } from '@/components/modals/submitToasts'
import { useFormatMoney } from '@/context/amountVisibility'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useSubmitEntry } from '@/hooks/useSubmitEntry'
import { checkAmount } from '@/lib/amount'
import { getErrorMessage } from '@/lib/errors'
import { KHATA_ITEM_LABEL_MAX, toPaisa } from '@/lib/khata'
import { btnPrimary, btnSecondary, fieldError, fieldLabel, inputBase } from '@/lib/ui'
import { clampSaleDateToTodayMs, cn, startOfDay } from '@/lib/utils'
import CustomerPicker from './CustomerPicker'
import DueDateField from './DueDateField'
import { customerArg, customerProblem, pickedName, type PickedCustomer } from './customer'

type Errors = { customer?: string; amount?: string; total?: string }

/** Advance / booking: customer, money received now, optional bill / item / ready-by date. */
export default function AdvanceSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const uid = useId()
  const amountRef = useRef<HTMLInputElement | null>(null)
  const [customer, setCustomer] = useState<PickedCustomer | null>(null)
  const [amount, setAmount] = useState('')
  const [dateMs, setDateMs] = useState(() => startOfDay())
  const [details, setDetails] = useState(false)
  const [total, setTotal] = useState('')
  const [itemLabel, setItemLabel] = useState('')
  const [dueDate, setDueDate] = useState<number | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [topError, setTopError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { submitAdvance } = useSubmitEntry()
  const { settings } = useShopSettings()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const close = () => { if (!saving) onClose() }

  const save = async () => {
    const next: Errors = {}
    const c = customerProblem(customer)
    if (c) next.customer = c
    const a = checkAmount(amount, 'advance')
    if (!a.ok) next.amount = a.message
    let totalValue: number | undefined
    if (total.trim() !== '') {
      const t = checkAmount(total, 'total')
      if (!t.ok) next.total = t.message
      else if (a.ok && toPaisa(a.value) > toPaisa(t.value)) next.total = `Advance can't be more than the total (${money(t.value)})`
      else totalValue = t.value
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || !customer || !a.ok) return

    setSaving(true)
    setTopError(null)
    const name = pickedName(customer)
    try {
      const out = await submitAdvance({
        customer:     customerArg(customer),
        customerName: name,
        amount:       a.value,
        receivedAt:   clampSaleDateToTodayMs(dateMs),
        ...(totalValue !== undefined ? { total: totalValue } : {}),
        ...(itemLabel.trim() ? { itemLabel: itemLabel.trim() } : {}),
        ...(dueDate !== null ? { dueDate } : {}),
        recognition:  settings.advanceRecognition,
      })
      if (out.status === 'saved') showToast(`Saved · Advance ${money(a.value)} (${name})`, 'success')
      else {
        const t = queuedToast(out.problem)
        showToast(t.message, t.type)
      }
      onClose()
    } catch (e) {
      const message = getErrorMessage(e, 'Could not save the advance. Try again.')
      setTopError(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet onClose={close} dismissible={!saving} labelledBy={titleId} size="lg">
      <SheetHeader
        titleId={titleId}
        title="Advance / booking"
        subtitle="Money received before handover"
        icon={<Wallet size={18} />}
        iconClassName="bg-warning/15 text-warning"
        onClose={close}
        closeDisabled={saving}
      />
      <SheetBody className="flex flex-col gap-4">
        {topError && (
          <p role="alert" className="flex items-start gap-2.5 text-[15px] font-medium text-negative bg-negative/8 border border-negative/25 rounded-2xl px-4 py-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5" /> {topError}
          </p>
        )}
        <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setErrors((e) => ({ ...e, customer: undefined })) }} disabled={saving} error={errors.customer} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-amount`} className={fieldLabel}>Advance received</label>
          <AmountInput
            id={`${uid}-amount`}
            inputRef={amountRef}
            size="lg"
            value={amount}
            onChange={(v) => { setAmount(v); setErrors((e) => ({ ...e, amount: undefined })) }}
            invalid={Boolean(errors.amount)}
            disabled={saving}
          />
          {errors.amount && <p className={fieldError} role="alert"><AlertCircle size={16} /> {errors.amount}</p>}
        </div>

        <DateField label="Date" value={dateMs} onChange={(ms) => setDateMs(clampSaleDateToTodayMs(ms))} disabled={saving} />

        {details ? (
          <div className="flex flex-col gap-4 p-3.5 rounded-3xl border border-border/70 bg-muted/25">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-total`} className={fieldLabel}>
                Total bill <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <AmountInput
                id={`${uid}-total`}
                value={total}
                onChange={(v) => { setTotal(v); setErrors((e) => ({ ...e, total: undefined })) }}
                invalid={Boolean(errors.total)}
                disabled={saving}
              />
              {errors.total && <p className={fieldError} role="alert"><AlertCircle size={16} /> {errors.total}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-item`} className={fieldLabel}>
                What is it for? <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id={`${uid}-item`}
                type="text"
                value={itemLabel}
                onChange={(e) => setItemLabel(e.target.value)}
                placeholder="e.g. Suit stitching"
                maxLength={KHATA_ITEM_LABEL_MAX}
                autoComplete="off"
                disabled={saving}
                className={inputBase}
              />
            </div>
            <DueDateField value={dueDate} onChange={setDueDate} disabled={saving} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDetails(true)}
            disabled={saving}
            className="self-start flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-2xl text-base font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all"
          >
            <ChevronDown size={18} /> Add bill, item or date
          </button>
        )}
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          <button type="button" onClick={close} disabled={saving} className={cn(btnSecondary, 'flex-1')}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className={cn(btnPrimary, 'flex-2')}>
            {saving
              ? <><Loader2 size={18} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
              : <><Check size={18} /> Save advance</>}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
