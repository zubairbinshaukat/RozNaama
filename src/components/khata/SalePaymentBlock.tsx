import { useId } from 'react'
import { AlertCircle, Check, Info } from 'lucide-react'
import AmountInput from '@/components/shared/AmountInput'
import Amount from '@/components/shared/Amount'
import { cn } from '@/lib/utils'
import { fieldError, fieldLabel } from '@/lib/ui'
import { subMoney, toPaisa } from '@/lib/khata'
import CustomerField from './CustomerField'
import { receivedValue, type SalePayment, type SalePaymentErrors } from './customer'

interface SalePaymentBlockProps {
  value:    SalePayment
  onChange: (p: SalePayment) => void
  total:    number
  errors?:  SalePaymentErrors
  disabled: boolean
}

/**
 * Last block of Record sale (Advance & Udhaar on): "Full payment received?"
 * No → cash received now, live Baqi and the customer.
 */
export default function SalePaymentBlock({ value, onChange, total, errors, disabled }: SalePaymentBlockProps) {
  const uid = useId()
  const received = receivedValue(value)
  const baqi = Math.max(0, subMoney(total, received))
  const fullyPaid = !value.full && total > 0 && toPaisa(received) === toPaisa(total)

  const choice = (full: boolean, label: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value.full === full}
      onClick={() => onChange({ ...value, full })}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-2 min-h-12 px-4 rounded-2xl border text-base font-semibold',
        'active:scale-[0.97] transition-all duration-150 disabled:opacity-50',
        value.full === full ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted/60',
      )}
    >
      {value.full === full && <Check size={18} aria-hidden />} {label}
    </button>
  )

  return (
    <div role="group" aria-labelledby={`${uid}-q`} className="flex flex-col gap-3 p-3.5 rounded-3xl border border-border/70 bg-muted/25">
      <p id={`${uid}-q`} className={fieldLabel}>Full payment received?</p>
      <div className="flex gap-2.5">
        {choice(true, 'Yes')}
        {choice(false, 'No')}
      </div>

      {!value.full && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-received`} className={fieldLabel}>Received now</label>
            <AmountInput
              id={`${uid}-received`}
              value={value.received}
              onChange={(received) => onChange({ ...value, received })}
              invalid={Boolean(errors?.received)}
              disabled={disabled}
              aria-describedby={errors?.received ? `${uid}-received-err` : undefined}
            />
            {errors?.received && (
              <p id={`${uid}-received-err`} className={fieldError} role="alert">
                <AlertCircle size={16} /> {errors.received}
              </p>
            )}
            {fullyPaid ? (
              <p className="flex items-start gap-2 text-[15px] font-medium text-muted-foreground" role="status">
                <Info size={16} className="shrink-0 mt-0.5" aria-hidden />
                Fully paid. This saves as a normal sale.
              </p>
            ) : total > 0 && toPaisa(received) < toPaisa(total) ? (
              <p className="text-lg font-bold text-negative" aria-live="polite">
                Baqi: <Amount value={baqi} />
              </p>
            ) : null}
          </div>

          {!fullyPaid && (
            <CustomerField
              value={value.customer}
              onChange={(customer) => onChange({ ...value, customer })}
              disabled={disabled}
              error={errors?.customer}
            />
          )}
        </>
      )}
    </div>
  )
}
