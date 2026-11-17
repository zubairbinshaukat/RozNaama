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
  CUSTOMER_NAME_MAX,
  DUE_DATE_MAX_AHEAD_MS,
  FUTURE_SLACK_MS,
  MAX_SALE_ITEMS,
  MIN_DATE_MS,
  PHONE_MAX,
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

// ─── Khata money / customer validation ──────────────────────────────────────

/** True when `amount` has at most 2 decimal places (paisa precision). */
function hasAtMostTwoDecimals(amount: number): boolean {
  const paisa = amount * 100
  return Math.abs(paisa - Math.round(paisa)) < 1e-6
}

/** assertAmount + at most 2 decimals. Returns the amount. */
export function assertMoney(amount: number, label = 'Amount'): number {
  assertAmount(amount, label)
  if (!hasAtMostTwoDecimals(amount)) throw validationError(`${label} can have at most 2 decimals`)
  return amount
}

/** Like assertMoney but 0 is allowed (e.g. "Received now"). Returns the amount. */
export function assertMoneyOrZero(amount: number, label = 'Amount'): number {
  if (typeof amount === 'number' && amount === 0) return 0
  return assertMoney(amount, label)
}

/** Trim, collapse inner whitespace; required, ≤ CUSTOMER_NAME_MAX. */
export function normalizeCustomerName(value: string): string {
  return normalizeRequiredText(value.replace(/\s+/g, ' '), 'Customer name', CUSTOMER_NAME_MAX)
}

/** Lookup key for a (normalized) customer name: lowercased, single spaces. */
export function customerNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Phone: spaces, dashes, dots and brackets are dropped; the rest must be
 * digits with an optional leading '+', ≤ PHONE_MAX. Empty → undefined.
 */
export function normalizePhone(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const compact = value.replace(/[\s\-().]/g, '')
  if (compact.length === 0) return undefined
  if (!/^\+?\d+$/.test(compact)) throw validationError('Phone number can only have digits and +')
  if (compact.length > PHONE_MAX) {
    throw validationError(`Phone number must be ${PHONE_MAX} characters or fewer`)
  }
  return compact
}

/** Due date: valid ms, ≥ MIN_DATE_MS and ≤ now + DUE_DATE_MAX_AHEAD_MS. */
export function assertDueDate(ms: number, now: number = Date.now()): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) throw validationError('Due date is not valid')
  if (ms < MIN_DATE_MS) throw validationError('Due date is too far in the past')
  if (ms > now + DUE_DATE_MAX_AHEAD_MS) throw validationError('Due date can be at most 2 years ahead')
  return ms
}

/** Color must be one of CATEGORY_COLORS (case-insensitive). Returns the canonical palette value. */
export function assertCategoryColor(color: string): CategoryColor {
  const wanted = color.trim().toUpperCase()
  const match = CATEGORY_COLORS.find((c) => c === wanted)
  if (!match) throw validationError('Please choose one of the available colors')
  return match
}
