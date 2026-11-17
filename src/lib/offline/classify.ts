/**
 * Outbox error classification and retry timing (pure).
 */
import { ERROR_CODES, getErrorCode, getErrorMessage } from '@/lib/errors'
import type { EntryKind, OutboxProblemReason } from './types'

export type ErrorAction =
  /** Entry → needsAttention; the user fixes or discards it. */
  | { action: 'needsAttention'; reason: 'validation' | 'notFound' | 'clock'; message: string }
  /** Stop sending for this owner until auth changes / retryNow. */
  | { action: 'pause'; reason: 'unauthorized' | 'forbidden' | 'missingBackend'; message: string }
  /** Try again later with backoff. */
  | { action: 'retry'; reason: 'transient'; message: string }

export const CLOCK_MESSAGE = "Your phone's date looks wrong. Save it for today instead?"
export const NOT_FOUND_MESSAGE = 'Its category was deleted. Save it without a category?'
export const MISSING_BACKEND_MESSAGE = 'The app needs an update before these entries can sync.'
export const TRANSIENT_MESSAGE = 'Could not sync yet. Will try again.'

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return ''
}

/**
 * Server-side argument validation that mentions `clientRequestId` means the
 * deployed backend does not accept the idempotency key yet. Never retry such
 * an entry without the id (that could double-record): pause instead.
 */
export function isMissingClientRequestIdSupport(err: unknown): boolean {
  const msg = rawMessage(err)
  // "Object contains extra field `clientRequestId` that is not in the validator."
  return /ArgumentValidationError/i.test(msg) && /extra field\W+clientRequestId/.test(msg)
}

/**
 * `kind` = the outbox entry kind. Khata entries keep the server's NOT_FOUND
 * text ("This record was cancelled", "Record not found") unless it is about a
 * deleted category, which gets the usual "Save it without a category?".
 */
export function classifyError(err: unknown, kind?: EntryKind): ErrorAction {
  const code = getErrorCode(err)
  if (code === null) {
    if (isMissingClientRequestIdSupport(err)) {
      return { action: 'pause', reason: 'missingBackend', message: MISSING_BACKEND_MESSAGE }
    }
    if (/ArgumentValidationError/i.test(rawMessage(err))) {
      // Malformed entry: resending the same args can never succeed.
      return { action: 'needsAttention', reason: 'validation', message: 'This entry could not be saved.' }
    }
    // Network failures, "Server Error", timeouts: transient.
    return { action: 'retry', reason: 'transient', message: TRANSIENT_MESSAGE }
  }
  const message = getErrorMessage(err, 'This entry could not be saved.')
  switch (code) {
    case ERROR_CODES.VALIDATION:
      if (/future/i.test(message)) return { action: 'needsAttention', reason: 'clock', message: CLOCK_MESSAGE }
      return { action: 'needsAttention', reason: 'validation', message }
    case ERROR_CODES.NOT_FOUND:
      if (kind !== undefined && kind !== 'sale' && kind !== 'expense' && !/category/i.test(message)) {
        return { action: 'needsAttention', reason: 'notFound', message }
      }
      return { action: 'needsAttention', reason: 'notFound', message: NOT_FOUND_MESSAGE }
    case ERROR_CODES.UNAUTHORIZED:
    case ERROR_CODES.USER_NOT_FOUND:
      return { action: 'pause', reason: 'unauthorized', message: 'Waiting for sign-in to sync.' }
    case ERROR_CODES.FORBIDDEN:
      return { action: 'pause', reason: 'forbidden', message }
    default:
      return { action: 'retry', reason: 'transient', message: TRANSIENT_MESSAGE }
  }
}

export const BACKOFF_BASE_MS = 2000
export const BACKOFF_MAX_MS = 5 * 60 * 1000
export const BACKOFF_JITTER = 0.2

/**
 * Delay before retry number `attempts` (1 = first retry):
 * min(2^(attempts-1) · 2s, 5 min) ± 20 %. `random` in [0, 1).
 */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempts))
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS)
  const jitter = 1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * random()
  return Math.round(base * jitter)
}

export function isPauseReason(reason: OutboxProblemReason): reason is 'unauthorized' | 'forbidden' | 'missingBackend' {
  return reason === 'unauthorized' || reason === 'forbidden' || reason === 'missingBackend'
}
