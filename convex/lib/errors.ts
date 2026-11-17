import { ConvexError } from 'convex/values'

/**
 * Error codes carried in `ConvexError` payloads. The frontend maps these
 * (and legacy plain-string payloads) via `getErrorCode`.
 */
export const ERROR_CODES = {
  UNAUTHORIZED:   'UNAUTHORIZED',
  FORBIDDEN:      'FORBIDDEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  NOT_FOUND:      'NOT_FOUND',
  VALIDATION:     'VALIDATION',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export type AppErrorData = { code: ErrorCode; message: string }

/** Build a structured ConvexError: `{ code, message }`. */
export function appError(code: ErrorCode, message: string): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({ code, message })
}

/** Legacy message texts are kept so older clients still recognise them. */
export const unauthorizedError = () => appError(ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
export const forbiddenError = () => appError(ERROR_CODES.FORBIDDEN, 'Forbidden')
export const userNotFoundError = (message = 'User not found') =>
  appError(ERROR_CODES.USER_NOT_FOUND, message)
export const notFoundError = (message: string) => appError(ERROR_CODES.NOT_FOUND, message)
export const validationError = (message: string) => appError(ERROR_CODES.VALIDATION, message)
