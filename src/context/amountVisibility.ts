import { createContext, useCallback, useContext } from 'react'
import { formatAmount, formatCurrency } from '@/lib/utils'

export const AMOUNT_VISIBILITY_KEY = 'roznaama-amounts-hidden'

/** What hidden money looks like everywhere (banking-app style). */
export const HIDDEN_DIGITS = '••••'

export type AmountVisibility = {
  hidden: boolean
  toggle: () => void
}

/**
 * Null outside the dashboard (landing, unit tests) → amounts are shown.
 * Inside the dashboard the provider defaults to hidden.
 */
export const AmountVisibilityContext = createContext<AmountVisibility | null>(null)

export function useAmountVisibility(): AmountVisibility {
  return useContext(AmountVisibilityContext) ?? { hidden: false, toggle: () => {} }
}

/** Read the per-device preference; anything unexpected (or no storage) → hidden. */
export function readAmountsHidden(): boolean {
  try {
    return localStorage.getItem(AMOUNT_VISIBILITY_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeAmountsHidden(hidden: boolean): void {
  try {
    localStorage.setItem(AMOUNT_VISIBILITY_KEY, hidden ? 'true' : 'false')
  } catch {
    /* private mode / blocked storage: keep in memory only */
  }
}

export type MoneyFormatOptions = {
  /** Prefix a minus sign for negatives and show the absolute value ("−PKR 1,210"). */
  signed?: boolean
  /** No "PKR " prefix (for big numbers with a separate PKR label). */
  bare?: boolean
}

/** Plain formatter (no hiding). U+2212 minus so it reads as a real minus sign. */
export function formatMoney(value: number, { signed = false, bare = false }: MoneyFormatOptions = {}): string {
  const negative = signed && value < 0
  const abs = signed ? Math.abs(value) : value
  const text = bare ? formatAmount(abs) : formatCurrency(abs)
  return negative ? `−${text}` : text
}

/**
 * Formatter for strings (aria-labels, confirm messages, chart summaries) that
 * respects the hide-amounts switch.
 */
export function useFormatMoney(): (value: number, options?: MoneyFormatOptions) => string {
  const { hidden } = useAmountVisibility()
  return useCallback(
    (value: number, options: MoneyFormatOptions = {}) =>
      hidden ? (options.bare ? HIDDEN_DIGITS : `PKR ${HIDDEN_DIGITS}`) : formatMoney(value, options),
    [hidden],
  )
}
