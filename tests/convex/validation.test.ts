import { describe, expect, it } from 'vitest'
import { ConvexError } from 'convex/values'
import {
  assertAmount,
  assertCategoryColor,
  assertEntryDate,
  assertItemCount,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../convex/lib/validation'
import {
  AMOUNT_MAX,
  CATEGORY_COLORS,
  FUTURE_SLACK_MS,
  MAX_SALE_ITEMS,
  MIN_DATE_MS,
  PRODUCT_NAME_MAX,
} from '../../convex/lib/limits'

function errorData(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected function to throw')
}

describe('assertAmount', () => {
  it('accepts positive finite amounts up to the max', () => {
    expect(assertAmount(1)).toBe(1)
    expect(assertAmount(0.5)).toBe(0.5)
    expect(assertAmount(AMOUNT_MAX)).toBe(AMOUNT_MAX)
  })

  it.each([0, -1, -0.01])('rejects %s as not greater than 0', (amount) => {
    expect(errorData(() => assertAmount(amount))).toEqual({
      code: 'VALIDATION',
      message: 'Amount must be greater than 0',
    })
  })

  it.each([NaN, Infinity, -Infinity])('rejects non-finite %s', (amount) => {
    expect(errorData(() => assertAmount(amount))).toEqual({
      code: 'VALIDATION',
      message: 'Amount must be a valid number',
    })
  })

  it('rejects amounts above the max', () => {
    expect(errorData(() => assertAmount(AMOUNT_MAX + 1))).toMatchObject({ code: 'VALIDATION' })
  })

  it('keeps the legacy expense message', () => {
    expect(errorData(() => assertAmount(0, 'Expense amount'))).toEqual({
      code: 'VALIDATION',
      message: 'Expense amount must be greater than 0',
    })
  })
})

describe('normalizeRequiredText', () => {
  it('trims and returns the value', () => {
    expect(normalizeRequiredText('  Chai  ', 'Product name', PRODUCT_NAME_MAX)).toBe('Chai')
  })

  it('rejects empty / whitespace-only', () => {
    expect(errorData(() => normalizeRequiredText('   ', 'Product name', 80))).toEqual({
      code: 'VALIDATION',
      message: 'Product name is required',
    })
  })

  it('enforces the max length after trimming', () => {
    expect(normalizeRequiredText(` ${'a'.repeat(80)} `, 'Name', 80)).toHaveLength(80)
    expect(errorData(() => normalizeRequiredText('a'.repeat(81), 'Name', 80))).toEqual({
      code: 'VALIDATION',
      message: 'Name must be 80 characters or fewer',
    })
  })
})

describe('normalizeOptionalText', () => {
  it('maps undefined / blank to undefined', () => {
    expect(normalizeOptionalText(undefined, 'Note', 100)).toBeUndefined()
    expect(normalizeOptionalText('   ', 'Note', 100)).toBeUndefined()
  })

  it('trims and enforces max', () => {
    expect(normalizeOptionalText('  paid cash ', 'Note', 100)).toBe('paid cash')
    expect(errorData(() => normalizeOptionalText('x'.repeat(101), 'Note', 100))).toMatchObject({
      code: 'VALIDATION',
    })
  })
})

describe('assertEntryDate', () => {
  const now = Date.UTC(2026, 10, 17, 12)

  it('accepts dates in range', () => {
    expect(assertEntryDate(now, 'Date', now)).toBe(now)
    expect(assertEntryDate(MIN_DATE_MS, 'Date', now)).toBe(MIN_DATE_MS)
    expect(assertEntryDate(now + FUTURE_SLACK_MS, 'Date', now)).toBe(now + FUTURE_SLACK_MS)
  })

  it('rejects too old, too far in future and non-finite', () => {
    expect(errorData(() => assertEntryDate(MIN_DATE_MS - 1, 'Date', now))).toMatchObject({ code: 'VALIDATION' })
    expect(errorData(() => assertEntryDate(now + FUTURE_SLACK_MS + 1, 'Date', now))).toEqual({
      code: 'VALIDATION',
      message: 'Date cannot be in the future',
    })
    expect(errorData(() => assertEntryDate(NaN, 'Date', now))).toMatchObject({ code: 'VALIDATION' })
  })

  it('defaults "now" to Date.now()', () => {
    expect(assertEntryDate(Date.now())).toBeGreaterThan(MIN_DATE_MS)
  })
})

describe('assertItemCount', () => {
  it('accepts 1..MAX_SALE_ITEMS', () => {
    expect(() => assertItemCount(1)).not.toThrow()
    expect(() => assertItemCount(MAX_SALE_ITEMS)).not.toThrow()
  })

  it('rejects 0 and MAX+1', () => {
    expect(errorData(() => assertItemCount(0))).toEqual({
      code: 'VALIDATION',
      message: 'At least one sale item is required',
    })
    expect(errorData(() => assertItemCount(MAX_SALE_ITEMS + 1))).toMatchObject({ code: 'VALIDATION' })
  })
})

describe('assertCategoryColor', () => {
  it('accepts palette colors case-insensitively and returns the canonical value', () => {
    for (const color of CATEGORY_COLORS) {
      expect(assertCategoryColor(color)).toBe(color)
      expect(assertCategoryColor(color.toLowerCase())).toBe(color)
    }
  })

  it('rejects colors outside the palette', () => {
    expect(errorData(() => assertCategoryColor('#123456'))).toMatchObject({ code: 'VALIDATION' })
    expect(errorData(() => assertCategoryColor('red'))).toMatchObject({ code: 'VALIDATION' })
  })
})
