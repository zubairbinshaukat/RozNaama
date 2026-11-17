import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import { cn, formatCurrency } from '@/lib/utils'
import { chip, chipActive, chipIdle } from '@/lib/ui'
import {
  caretForSignificantCount,
  formatAmountInput,
  normalizeAmountInput,
  significantCharsBefore,
} from '@/lib/amount'

interface AmountInputProps {
  id?: string
  /** Canonical amount string ("1234.5"), '' when empty. */
  value: string
  onChange: (raw: string) => void
  /** `lg` = JazzCash-style hero field; `md` = inside a list row. */
  size?: 'md' | 'lg'
  invalid?: boolean
  disabled?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  inputRef?: Ref<HTMLInputElement>
  /** Optional one-tap amounts shown under the field. */
  quickAmounts?: readonly number[]
  /** Tint for the hero field (e.g. expense uses the negative colour). */
  tone?: 'brand' | 'negative'
}

/**
 * Big PKR amount field: decimal keypad on phones, live "1,234.50" grouping,
 * Urdu/Arabic digits accepted, caret stays where the user is typing.
 */
export default function AmountInput({
  id,
  value,
  onChange,
  size = 'md',
  invalid = false,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  inputRef,
  quickAmounts,
  tone = 'brand',
}: AmountInputProps) {
  const localRef = useRef<HTMLInputElement | null>(null)
  /** Significant-char count before the caret, applied after the next render. */
  const pendingCaret = useRef<number | null>(null)
  const display = formatAmountInput(value)

  useLayoutEffect(() => {
    const el = localRef.current
    const count = pendingCaret.current
    if (!el || count === null || document.activeElement !== el) return
    pendingCaret.current = null
    const pos = caretForSignificantCount(el.value, count)
    el.setSelectionRange(pos, pos)
  }, [display])

  // Expose the <input> to parents (focus on validation errors).
  useImperativeHandle(inputRef, () => localRef.current as HTMLInputElement, [])

  const isLg = size === 'lg'
  const numericValue = parseFloat(value)

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className={cn(
          'flex items-baseline gap-2 rounded-2xl border bg-background px-4 transition-shadow',
          'focus-within:ring-2 focus-within:ring-ring/60 focus-within:border-transparent',
          isLg ? 'py-3' : 'py-2',
          invalid ? 'border-negative focus-within:ring-negative/40' : 'border-input',
          disabled && 'opacity-50',
        )}
        onClick={() => localRef.current?.focus()}
      >
        <span
          className={cn(
            'font-semibold text-muted-foreground shrink-0 select-none',
            isLg ? 'text-lg' : 'text-base',
          )}
          aria-hidden
        >
          PKR
        </span>
        <input
          ref={localRef}
          id={id}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          value={display}
          disabled={disabled}
          placeholder="0"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            const el = e.target
            pendingCaret.current = significantCharsBefore(el.value, el.selectionStart ?? el.value.length)
            onChange(normalizeAmountInput(el.value))
          }}
          className={cn(
            'min-w-0 flex-1 bg-transparent border-0 p-0 font-bold tabular tracking-tight text-foreground',
            'placeholder:text-muted-foreground/40 focus:outline-none focus-visible:outline-none',
            isLg ? 'text-[2.5rem] leading-[1.1]' : 'text-[1.75rem] leading-tight',
            tone === 'negative' && value !== '' && 'text-negative',
          )}
        />
      </div>

      {quickAmounts && quickAmounts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Quick amounts">
          {quickAmounts.map((amt) => {
            const active = numericValue === amt
            return (
              <button
                key={amt}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onChange(String(amt))}
                className={cn(chip, active ? chipActive : chipIdle, 'tabular')}
              >
                {formatCurrency(amt)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
