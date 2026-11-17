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

/** Plain-language khata messages (shown as-is by the UI). `X` amounts are "PKR 1,234". */
export const KHATA_MESSAGES = {
  PAYMENT_LOCK:      'This is an Udhaar/Advance payment. Change it in Khata.',
  DELIVERY_LOCK:     'This sale is linked to Udhaar/Advance. Cancel it from Khata.',
  KHATA_OFF_LOCK:    'Turn on Advance & Udhaar in Settings to change it.',
  FULLY_PAID:        'Fully paid, save as normal sale',
  BILL_BELOW_ADVANCE: "Bill can't be less than advance. Use Cancel & refund.",
  EDIT_ITEMS_IN_SALE: 'Edit the items in the sale',
  ENTRY_NOT_FOUND:   'Record not found',
  ENTRY_CANCELLED:   'This record was cancelled',
  ENTRY_CLOSED:      'This record is already closed',
  ALREADY_PAID:      'Already fully paid',
  NOT_BOOKED:        'This is not an open advance',
  NOT_DUE:           'There is no Baqi to forgive',
  PAYMENT_NOT_FOUND: 'Payment not found',
  CUSTOMER_NOT_FOUND: 'Customer not found',
  CUSTOMER_EXISTS:   'Another customer already has this name',
  TOO_MANY_PAYMENTS: 'This record has too many payments',
  BEFORE_OPENED:     "Date can't be before the record started",
} as const

/** Legacy message texts are kept so older clients still recognise them. */
export const unauthorizedError = () => appError(ERROR_CODES.UNAUTHORIZED, 'Unauthorized')
export const forbiddenError = () => appError(ERROR_CODES.FORBIDDEN, 'Forbidden')
export const userNotFoundError = (message = 'User not found') =>
  appError(ERROR_CODES.USER_NOT_FOUND, message)
export const notFoundError = (message: string) => appError(ERROR_CODES.NOT_FOUND, message)
export const validationError = (message: string) => appError(ERROR_CODES.VALIDATION, message)
