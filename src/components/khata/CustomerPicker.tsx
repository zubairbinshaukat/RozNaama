import { useId, useMemo, useState } from 'react'
import { AlertCircle, Phone, UserPlus, UserRound, X } from 'lucide-react'
import SuggestionChips from '@/components/shared/SuggestionChips'
import { useCustomerSearch } from '@/hooks/useKhata'
import { cn } from '@/lib/utils'
import { fieldError, fieldHint, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { CUSTOMER_NAME_MAX, PHONE_MAX, customerNameKey, phoneTail } from '@/lib/khata'
import { customerChipLabel, pickedName, type PickedCustomer } from './customer'

interface CustomerPickerProps {
  value:     PickedCustomer | null
  onChange:  (c: PickedCustomer | null) => void
  disabled?: boolean
  /** Validation message (e.g. "Choose the customer."). */
  error?:    string | null
  /** Only customers with open records (Receive payment). New customers are not offered. */
  openOnly?: boolean
  label?:    string
}

/**
 * Customer field: recent / matching customers as chips (tap = choose),
 * "+ New customer" with Name (required) and Phone (optional).
 */
export default function CustomerPicker({
  value,
  onChange,
  disabled = false,
  error,
  openOnly = false,
  label = 'Customer',
}: CustomerPickerProps) {
  const uid = useId()
  const [search, setSearch] = useState('')
  const found = useCustomerSearch(search)
  const results = useMemo(
    () => (found ?? []).filter((c) => !openOnly || c.openCount > 0),
    [found, openOnly],
  )
  const labels = useMemo(() => results.map(customerChipLabel), [results])
  const exact = results.find((c) => c.normalizedName === customerNameKey(search))
  const errId = `${uid}-err`

  if (value) {
    const tail = phoneTail(value.phone)
    return (
      <div className="flex flex-col gap-1.5">
        <span className={fieldLabel}>{label}</span>
        <div className="flex items-center gap-3 min-h-14 pl-3 pr-1 rounded-2xl border border-primary/40 bg-primary/5">
          <span className="w-9 h-9 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0" aria-hidden>
            {value.kind === 'new' ? <UserPlus size={18} /> : <UserRound size={18} />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base font-bold text-foreground truncate">{pickedName(value)}</span>
            <span className="block text-[13px] text-muted-foreground">
              {value.kind === 'new' ? 'New customer' : tail ? `Phone ··${tail}` : 'Customer'}
            </span>
          </span>
          {value.kind === 'new' ? null : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null)}
              aria-label={`Change customer (${pickedName(value)})`}
              className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {value.kind === 'new' && (
          <NewCustomerFields
            value={value}
            onChange={onChange}
            disabled={disabled}
            error={error}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${uid}-search`} className={fieldLabel}>{label}</label>
      <input
        id={`${uid}-search`}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={openOnly ? 'Search customer' : 'Customer name'}
        maxLength={CUSTOMER_NAME_MAX}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={cn(inputBase, error && inputInvalid)}
      />
      {found === undefined ? (
        <div className="flex gap-2" aria-hidden>
          <div className="skeleton h-11 w-24 rounded-full" />
          <div className="skeleton h-11 w-20 rounded-full" />
        </div>
      ) : (
        <SuggestionChips
          items={labels}
          query={search}
          disabled={disabled}
          onPick={(l) => {
            const c = results[labels.indexOf(l)]
            if (c) onChange({ kind: 'existing', id: c._id, name: c.name, ...(c.phone ? { phone: c.phone } : {}) })
          }}
          aria-label={search.trim() ? 'Matching customers' : 'Recent customers'}
        />
      )}
      {!openOnly && !exact && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ kind: 'new', name: search.trim(), phone: '' })}
          className="self-start flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-2xl text-base font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all"
        >
          <UserPlus size={18} /> {search.trim() ? `New customer "${search.trim()}"` : 'New customer'}
        </button>
      )}
      {openOnly && found !== undefined && results.length === 0 && (
        <p className={fieldHint}>{search.trim() ? 'No customer with Baqi or advance by that name.' : 'No customer has Baqi or an advance.'}</p>
      )}
      {error && (
        <p id={errId} className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>
      )}
    </div>
  )
}

function NewCustomerFields({
  value,
  onChange,
  disabled,
  error,
}: {
  value: Extract<PickedCustomer, { kind: 'new' }>
  onChange: (c: PickedCustomer | null) => void
  disabled: boolean
  error?: string | null
}) {
  const uid = useId()
  return (
    <div className="flex flex-col gap-3 p-3.5 rounded-3xl border border-border/70 bg-muted/25">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-name`} className={fieldLabel}>Name</label>
        <input
          id={`${uid}-name`}
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="e.g. Ali"
          maxLength={CUSTOMER_NAME_MAX}
          autoComplete="off"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={cn(inputBase, error && inputInvalid)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-phone`} className={fieldLabel}>
          Phone <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="relative">
          <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={`${uid}-phone`}
            type="tel"
            inputMode="tel"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder="03xx xxxxxxx"
            maxLength={PHONE_MAX + 6}
            autoComplete="off"
            disabled={disabled}
            className={cn(inputBase, 'pl-11')}
          />
        </div>
      </div>
      {error && <p className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className="self-start min-h-11 px-3 -ml-1 rounded-2xl text-sm font-semibold text-muted-foreground hover:bg-muted active:scale-[0.97] transition-all"
      >
        Choose a saved customer instead
      </button>
    </div>
  )
}
