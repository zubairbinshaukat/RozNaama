import { useId, useMemo } from 'react'
import { AlertCircle, Phone, Plus, UserPlus, X } from 'lucide-react'
import SuggestionChips from '@/components/shared/SuggestionChips'
import { useCustomerSearch } from '@/hooks/useKhata'
import { cn } from '@/lib/utils'
import { fieldError, fieldLabel, inputBase, inputInvalid } from '@/lib/ui'
import { CUSTOMER_NAME_MAX, PHONE_MAX, customerNameKey } from '@/lib/khata'
import { customerChipLabel, isNewName, rankCustomers, type CustomerFieldValue } from './customer'

interface CustomerFieldProps {
  value:     CustomerFieldValue
  onChange:  (v: CustomerFieldValue) => void
  disabled?: boolean
  error?:    string | null
  label?:    string
}

/**
 * "Customer name (optional)": one text field with saved customers as chips
 * underneath (recent when empty, filtered while typing), like product chips.
 * Tap a chip = that customer. A name that matches no chip becomes a new
 * customer on save (phone optional behind "+ Add phone"). Blank = no name.
 */
export default function CustomerField({
  value,
  onChange,
  disabled = false,
  error,
  label = 'Customer name',
}: CustomerFieldProps) {
  const uid = useId()
  const typing = value.picked === null ? value.text.trim() : ''
  const recent = useCustomerSearch('')
  const prefix = useCustomerSearch(typing)
  const ranked = useMemo(
    () => (value.picked ? [] : rankCustomers(typing ? prefix : recent, recent, typing)),
    [value.picked, typing, prefix, recent],
  )
  const labels = useMemo(() => ranked.map(customerChipLabel), [ranked])
  const exact = typing !== '' && ranked.some((c) => c.normalizedName === customerNameKey(typing))
  const isNew = isNewName(value) && !exact
  const errId = `${uid}-err`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${uid}-name`} className={fieldLabel}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <div className="relative">
        <input
          id={`${uid}-name`}
          type="text"
          value={value.picked ? value.picked.name : value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value, picked: null })}
          placeholder="e.g. Ali"
          maxLength={CUSTOMER_NAME_MAX}
          autoComplete="off"
          enterKeyHint="next"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={cn(inputBase, (value.text || value.picked) && 'pr-12', value.picked && 'font-bold', error && inputInvalid)}
        />
        {(value.text !== '' || value.picked) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ text: '', picked: null, phone: '', phoneOpen: false })}
            aria-label="Clear customer name"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {!value.picked && (
        <SuggestionChips
          items={labels}
          query={value.text}
          disabled={disabled}
          onPick={(l) => {
            const c = ranked[labels.indexOf(l)]
            if (c) onChange({ text: c.name, picked: { id: c._id, name: c.name, ...(c.phone ? { phone: c.phone } : {}) }, phone: '', phoneOpen: false })
          }}
          aria-label={typing ? 'Matching customers' : 'Recent customers'}
        />
      )}
      {isNew && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground" data-testid="new-customer-hint">
            <UserPlus size={14} aria-hidden /> New customer
          </span>
          {!value.phoneOpen && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, phoneOpen: true })}
              className="inline-flex items-center gap-1 min-h-11 px-2 -ml-2 rounded-xl text-sm font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all"
            >
              <Plus size={16} /> Add phone
            </button>
          )}
        </div>
      )}
      {isNew && value.phoneOpen && (
        <div className="relative">
          <label htmlFor={`${uid}-phone`} className="sr-only">Phone (optional)</label>
          <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={`${uid}-phone`}
            type="tel"
            inputMode="tel"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            placeholder="Phone (optional) 03xx xxxxxxx"
            maxLength={PHONE_MAX + 6}
            autoComplete="off"
            disabled={disabled}
            className={cn(inputBase, 'pl-11')}
          />
        </div>
      )}
      {error && (
        <p id={errId} className={fieldError} role="alert"><AlertCircle size={16} /> {error}</p>
      )}
    </div>
  )
}
