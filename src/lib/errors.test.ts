import { describe, expect, it } from 'vitest'
import { ConvexError } from 'convex/values'
import { getErrorCode, getErrorMessage, isViewAsInvalidError } from './errors'

const FALLBACK = 'Could not save. Try again.'

describe('getErrorMessage', () => {
  it('uses a ConvexError string payload', () => {
    expect(getErrorMessage(new ConvexError('Expense amount must be greater than 0'), FALLBACK))
      .toBe('Expense amount must be greater than 0')
  })

  it('uses a ConvexError { code, message } payload', () => {
    const err = new ConvexError({ code: 'VALIDATION', message: 'Product name is too long' })
    expect(getErrorMessage(err, FALLBACK)).toBe('Product name is too long')
  })

  it('never surfaces a raw Error.message', () => {
    expect(getErrorMessage(new Error('[CONVEX M(sales:record)] Server Error'), FALLBACK)).toBe(FALLBACK)
    expect(getErrorMessage(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK)
  })

  it('falls back for non-errors and empty/unusable payloads', () => {
    expect(getErrorMessage(undefined, FALLBACK)).toBe(FALLBACK)
    expect(getErrorMessage('boom', FALLBACK)).toBe(FALLBACK)
    expect(getErrorMessage(new ConvexError(''), FALLBACK)).toBe(FALLBACK)
    expect(getErrorMessage(new ConvexError({ code: 'VALIDATION' }), FALLBACK)).toBe(FALLBACK)
    expect(getErrorMessage(new ConvexError({ message: 42 }), FALLBACK)).toBe(FALLBACK)
  })

  it('accepts a duck-typed ConvexError (cross-bundle instance)', () => {
    const err = { name: 'ConvexError', data: { code: 'NOT_FOUND', message: 'Sale not found' } }
    expect(getErrorMessage(err, FALLBACK)).toBe('Sale not found')
  })
})

describe('getErrorCode', () => {
  it('reads data.code', () => {
    expect(getErrorCode(new ConvexError({ code: 'FORBIDDEN', message: 'Forbidden' }))).toBe('FORBIDDEN')
    expect(getErrorCode(new ConvexError({ code: 'VALIDATION', message: 'x' }))).toBe('VALIDATION')
  })

  it('maps legacy string payloads', () => {
    expect(getErrorCode(new ConvexError('Unauthorized'))).toBe('UNAUTHORIZED')
    expect(getErrorCode(new ConvexError('Forbidden'))).toBe('FORBIDDEN')
    expect(getErrorCode(new ConvexError('User not found'))).toBe('USER_NOT_FOUND')
    expect(getErrorCode(new ConvexError('User not found — please sign in again'))).toBe('USER_NOT_FOUND')
  })

  it('maps a legacy message inside an object payload without a code', () => {
    expect(getErrorCode(new ConvexError({ message: 'Forbidden' }))).toBe('FORBIDDEN')
  })

  it('returns null for unknown strings and non-ConvexErrors', () => {
    expect(getErrorCode(new ConvexError('Something else'))).toBeNull()
    expect(getErrorCode(new Error('Forbidden'))).toBeNull()
    expect(getErrorCode(null)).toBeNull()
  })
})

describe('isViewAsInvalidError', () => {
  it('is true for FORBIDDEN and USER_NOT_FOUND (structured and legacy)', () => {
    expect(isViewAsInvalidError(new ConvexError({ code: 'FORBIDDEN', message: 'Forbidden' }))).toBe(true)
    expect(isViewAsInvalidError(new ConvexError({ code: 'USER_NOT_FOUND', message: 'User not found' }))).toBe(true)
    expect(isViewAsInvalidError(new ConvexError('Forbidden'))).toBe(true)
    expect(isViewAsInvalidError(new ConvexError('User not found'))).toBe(true)
  })

  it('is false for other errors', () => {
    expect(isViewAsInvalidError(new ConvexError('Unauthorized'))).toBe(false)
    expect(isViewAsInvalidError(new ConvexError({ code: 'VALIDATION', message: 'x' }))).toBe(false)
    expect(isViewAsInvalidError(new Error('Forbidden'))).toBe(false)
  })
})
