/**
 * Input validation for NEW writes and CHANGED fields only.
 * Reads must never call these (existing prod rows may violate them).
 * Every failure throws `ConvexError({ code: 'VALIDATION', message })`.
 */
import { validationError } from './errors'
import {
  AMOUNT_MAX,
  CATEGORY_COLORS,
  CLIENT_REQUEST_ID_RE,
  FUTURE_SLACK_MS,
  MAX_SALE_ITEMS,
  MIN_DATE_MS,
  type CategoryColor,
} from './limits'

/**
 * Amount must be finite, > 0 and ≤ AMOUNT_MAX. Returns the amount.
 * `label` prefixes messages, e.g. 'Expense amount' → 'Expense amount must be greater than 0'.
 */
export function assertAmount(amount: number, label = 'Amount'): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw validationError(`${label} must be a valid number`)
  }
  if (amount <= 0) throw validationError(`${label} must be greater than 0`)
  if (amount > AMOUNT_MAX) throw validationError(`${label} is too large`)
  return amount
}

/** Trim; must be non-empty and ≤ max characters. Returns the trimmed text. */
export function normalizeRequiredText(value: string, field: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw validationError(`${field} is required`)
  if (trimmed.length > max) throw validationError(`${field} must be ${max} characters or fewer`)
  return trimmed
}

/** Trim; empty/whitespace → undefined; must be ≤ max characters. */
export function normalizeOptionalText(
  value: string | undefined,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > max) throw validationError(`${field} must be ${max} characters or fewer`)
  return trimmed
}

/**
 * Entry date (Unix ms) must be finite, ≥ MIN_DATE_MS (2000-01-01 UTC) and
 * ≤ now + FUTURE_SLACK_MS (36h). Returns the date.
 */
export function assertEntryDate(ms: number, label = 'Date', now: number = Date.now()): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw validationError(`${label} is not valid`)
  }
  if (ms < MIN_DATE_MS) throw validationError(`${label} is too far in the past`)
  if (ms > now + FUTURE_SLACK_MS) throw validationError(`${label} cannot be in the future`)
  return ms
}

/** 1 ≤ count ≤ MAX_SALE_ITEMS. */
export function assertItemCount(count: number): void {
  if (count < 1) throw validationError('At least one sale item is required')
  if (count > MAX_SALE_ITEMS) {
    throw validationError(`You can add up to ${MAX_SALE_ITEMS} items at a time`)
  }
}

/** Idempotency key must match CLIENT_REQUEST_ID_RE (no trimming: it is an opaque id). Returns it. */
export function assertClientRequestId(id: string): string {
  if (typeof id !== 'string' || !CLIENT_REQUEST_ID_RE.test(id)) {
    throw validationError('clientRequestId is not valid')
  }
  return id
}

/** Color must be one of CATEGORY_COLORS (case-insensitive). Returns the canonical palette value. */
export function assertCategoryColor(color: string): CategoryColor {
  const wanted = color.trim().toUpperCase()
  const match = CATEGORY_COLORS.find((c) => c === wanted)
  if (!match) throw validationError('Please choose one of the available colors')
  return match
}
