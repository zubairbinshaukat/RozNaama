import { describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { getErrorMessage } from '@/lib/errors'
import { isPermanentSyncError, retryTransient } from './syncRetry'

const sleep = () => Promise.resolve()
const CONFLICT = {
  code: 'FORBIDDEN',
  message: 'This email is linked to a different account. Please contact support.',
}

describe('isPermanentSyncError', () => {
  it('treats ConvexErrors as permanent and network errors as transient', () => {
    expect(isPermanentSyncError(new ConvexError(CONFLICT))).toBe(true)
    expect(isPermanentSyncError(Object.assign(new Error('x'), { name: 'ConvexError' }))).toBe(true)
    expect(isPermanentSyncError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isPermanentSyncError(new Error('[CONVEX M(users:upsertUser)] Server Error'))).toBe(false)
  })
})

describe('retryTransient', () => {
  it('does not retry a FORBIDDEN ConvexError and surfaces its message', async () => {
    const fn = vi.fn().mockRejectedValue(new ConvexError(CONFLICT))
    const err: unknown = await retryTransient(fn, { delaysMs: [1, 1, 1], sleep }).catch((e: unknown) => e)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getErrorMessage(err, 'fallback')).toBe(CONFLICT.message)
  })

  it('retries transient errors until success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Server Error'))
      .mockResolvedValue('ok')
    await expect(retryTransient(fn, { delaysMs: [1, 1, 1], sleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops on a permanent error after transient ones, and honours shouldAbort', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValue(new ConvexError(CONFLICT))
    await expect(retryTransient(fn, { delaysMs: [1, 1, 1], sleep })).rejects.toBeInstanceOf(ConvexError)
    expect(fn).toHaveBeenCalledTimes(2)

    const aborted = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(retryTransient(aborted, { delaysMs: [1, 1], sleep, shouldAbort: () => true })).rejects.toThrow()
    expect(aborted).toHaveBeenCalledTimes(1)
  })
})
