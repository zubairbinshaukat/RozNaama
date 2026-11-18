import { useCallback, useMemo, useState, type ReactNode, type Ref } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AmountVisibilityContext,
  HIDDEN_DIGITS,
  formatMoney,
  readAmountsHidden,
  useAmountVisibility,
  writeAmountsHidden,
} from '@/context/amountVisibility'

interface AmountProps {
  value: number
  /** Negative → "−PKR 1,210" (minus sign, so loss is never colour-only). */
  signed?: boolean
  /** With `signed`: positive colour for ≥ 0, negative colour for < 0 (only while visible). */
  colored?: boolean
  /** Omit the "PKR " prefix. */
  bare?: boolean
  className?: string
}

/**
 * Every money figure in the dashboard goes through this, so the eye toggle
 * next to the greeting hides all of them at once ("PKR ••••").
 */
export default function Amount({ value, signed = false, colored = false, bare = false, className }: AmountProps) {
  const { hidden } = useAmountVisibility()
  if (hidden) {
    return (
      <span className={cn('tabular', className)} data-amount-hidden="">
        {bare ? HIDDEN_DIGITS : `PKR ${HIDDEN_DIGITS}`}
        <span className="sr-only"> (amount hidden)</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'tabular',
        colored && signed && (value < 0 ? 'text-negative' : 'text-positive'),
        className,
      )}
    >
      {formatMoney(value, { signed, bare })}
    </span>
  )
}

/** Holds the hide/show state for the dashboard; defaults to hidden, remembered per device. */
export function AmountVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readAmountsHidden)
  const toggle = useCallback(() => {
    setHidden((h) => {
      writeAmountsHidden(!h)
      return !h
    })
  }, [])
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle])
  return <AmountVisibilityContext.Provider value={value}>{children}</AmountVisibilityContext.Provider>
}

/** Eye button (dashboard greeting row): shows / hides every amount. */
export function AmountVisibilityToggle({ ref }: { ref?: Ref<HTMLButtonElement> }) {
  const { hidden, toggle } = useAmountVisibility()
  return (
    <button
      ref={ref}
      type="button"
      onClick={toggle}
      aria-pressed={!hidden}
      aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
      title={hidden ? 'Show amounts' : 'Hide amounts'}
      className="w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all duration-150"
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  )
}
