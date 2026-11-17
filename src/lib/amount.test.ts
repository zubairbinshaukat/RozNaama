import { describe, expect, it } from 'vitest'
import {
  caretForSignificantCount,
  checkAmount,
  formatAmountInput,
  normalizeAmountInput,
  significantCharsBefore,
} from './amount'
import { expenseDateFor } from './expenseDate'
import { startOfDay } from './utils'

describe('normalizeAmountInput', () => {
  it.each([
    ['1,234', '1234'],
    ['1234.567', '1234.56'],
    ['00012', '12'],
    ['.5', '0.5'],
    ['12..3', '12.3'],
    ['abc', ''],
    ['', ''],
    ['۱۲۳۴', '1234'],   // Urdu digits
    ['١٢٫٥', '12.5'],   // Arabic-Indic digits + Arabic decimal separator
    ['12345678901234', '1234567890'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAmountInput(input)).toBe(expected)
  })
})

describe('formatAmountInput', () => {
  it('groups thousands and keeps a trailing dot / decimals while typing', () => {
    expect(formatAmountInput('1234567')).toBe('1,234,567')
    expect(formatAmountInput('1234.')).toBe('1,234.')
    expect(formatAmountInput('1234.5')).toBe('1,234.5')
    expect(formatAmountInput('')).toBe('')
  })
})

describe('caret helpers', () => {
  it('keep the caret after the same digit when commas appear', () => {
    // User typed "1234" with the caret at the end → "1,234", caret still at the end.
    const count = significantCharsBefore('1234', 4)
    expect(caretForSignificantCount('1,234', count)).toBe(5)
    // Caret after the "2" in "12|34" → after "2" in "1,2|34".
    expect(caretForSignificantCount('1,234', significantCharsBefore('1234', 2))).toBe(3)
  })
})

describe('checkAmount', () => {
  it('explains what is wrong in plain words', () => {
    expect(checkAmount('')).toEqual({ ok: false, message: 'Enter the amount.' })
    expect(checkAmount('0')).toEqual({ ok: false, message: 'The amount must be more than 0.' })
    expect(checkAmount('2000000000', 'expense amount')).toEqual({
      ok: false,
      message: 'That expense amount is too large. Check the number.',
    })
    expect(checkAmount('12.5')).toEqual({ ok: true, value: 12.5 })
  })
})

describe('expenseDateFor', () => {
  it('sends "now" for today and local midnight for an earlier day', () => {
    const now = new Date(2026, 2, 15, 14, 30).getTime()
    expect(expenseDateFor(startOfDay(new Date(now)), now)).toBe(now)
    const earlier = new Date(2026, 2, 13).getTime()
    expect(expenseDateFor(earlier, now)).toBe(earlier)
  })
})
