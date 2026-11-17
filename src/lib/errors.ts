import { ConvexError } from 'convex/values'
import { ERROR_CODES } from '../../convex/lib/errors'
import type { ErrorCode } from '../../convex/lib/errors'

export { ERROR_CODES }
export type { ErrorCode }

/** Legacy plain-string ConvexError payloads, mapped to their codes. */
const LEGACY_MESSAGE_CODES: Record<string, ErrorCode> = {
  'Unauthorized': ERROR_CODES.UNAUTHORIZED,
  'Forbidden': ERROR_CODES.FORBIDDEN,
  'User not found': ERROR_CODES.USER_NOT_FOUND,
  'User not found — please sign in again': ERROR_CODES.USER_NOT_FOUND,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Returns the ConvexError payload (`data`) or `undefined` when `err` is not a
 * ConvexError. Duck-typed as a fallback in case the error crossed a module
 * boundary where `instanceof` fails.
 */
function getConvexErrorData(err: unknown): unknown {
  if (err instanceof ConvexError) {
    const data: unknown = err.data
    return data
  }
  if (isRecord(err) && err.name === 'ConvexError' && 'data' in err) return err.data
  return undefined
}

/**
 * A user-facing message for a failed mutation/query. Only messages the server
 * deliberately put in a ConvexError payload are shown; raw `Error.message`
 * (network errors, server stack traces) is never surfaced — `fallback` is used.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  const data = getConvexErrorData(err)
  if (typeof data === 'string' && data.trim()) return data
  if (isRecord(data) && typeof data.message === 'string' && data.message.trim()) {
    return data.message
  }
  return fallback
}

/** The structured error code (`data.code`, or mapped from a legacy string payload), else null. */
export function getErrorCode(err: unknown): string | null {
  const data = getConvexErrorData(err)
  if (isRecord(data)) {
    if (typeof data.code === 'string' && data.code) return data.code
    if (typeof data.message === 'string') return LEGACY_MESSAGE_CODES[data.message] ?? null
    return null
  }
  if (typeof data === 'string') return LEGACY_MESSAGE_CODES[data] ?? null
  return null
}

/** True when an admin "view as" target is no longer valid (forbidden or user gone). */
export function isViewAsInvalidError(err: unknown): boolean {
  const code = getErrorCode(err)
  return code === ERROR_CODES.FORBIDDEN || code === ERROR_CODES.USER_NOT_FOUND
}
