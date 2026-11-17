import { AMOUNT_MAX } from '@/lib/constants'

/** Max digits before the decimal point (AMOUNT_MAX has 10). */
const MAX_INT_DIGITS = 10
const MAX_DECIMALS = 2

/** Map Urdu / Arabic-Indic digits (common on Pakistani keyboards) to Latin. */
function toLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

/**
 * Typed text → canonical amount string ("1234.5"): digits plus at most one
 * dot, ≤ 2 decimals, no leading zeros, no grouping. Empty string = no amount.
 */
export function normalizeAmountInput(text: string): string {
  const latin = toLatinDigits(text).replace(/[٫،,]/g, (c) => (c === '٫' ? '.' : ''))
  let intPart = ''
  let decPart = ''
  let seenDot = false
  for (const ch of latin) {
    if (ch >= '0' && ch <= '9') {
      if (seenDot) {
        if (decPart.length < MAX_DECIMALS) decPart += ch
      } else if (intPart.length < MAX_INT_DIGITS) {
        intPart += ch
      }
    } else if (ch === '.' && !seenDot) {
      seenDot = true
    }
  }
  intPart = intPart.replace(/^0+(?=\d)/, '')
  if (seenDot) return `${intPart === '' ? '0' : intPart}.${decPart}`
  return intPart
}

/** Canonical amount string → display text with grouping: "1234.5" → "1,234.5". */
export function formatAmountInput(raw: string): string {
  if (raw === '') return ''
  const [intPart, decPart] = raw.split('.')
  const grouped = intPart === '' ? '0' : Number(intPart).toLocaleString('en-PK')
  return decPart === undefined ? grouped : `${grouped}.${decPart}`
}

/** Count of digits / dots before `caret` in `text` (grouping commas ignored). */
export function significantCharsBefore(text: string, caret: number): number {
  let n = 0
  for (let i = 0; i < Math.min(caret, text.length); i++) {
    const ch = text[i]!
    if (ch !== ',' && ch !== ' ') n++
  }
  return n
}

/** Caret index in `formatted` that sits after `count` significant chars. */
export function caretForSignificantCount(formatted: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] !== ',') seen++
    if (seen >= count) return i + 1
  }
  return formatted.length
}

export type AmountCheck = { ok: true; value: number } | { ok: false; message: string }

/** Plain-language validation shared by every amount field. */
export function checkAmount(raw: string, what = 'amount'): AmountCheck {
  const value = parseFloat(raw)
  if (raw.trim() === '' || Number.isNaN(value)) return { ok: false, message: `Enter the ${what}.` }
  if (value <= 0) return { ok: false, message: `The ${what} must be more than 0.` }
  if (value > AMOUNT_MAX) return { ok: false, message: `That ${what} is too large. Check the number.` }
  return { ok: true, value }
}
