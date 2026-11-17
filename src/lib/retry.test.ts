import { describe, expect, it, vi } from 'vitest'
import { retryWithBackoff, USER_SYNC_RETRY_DELAYS_MS } from './retry'

function recordingSleep() {
  const waits: number[] = []
  const sleep = (ms: number) => {
    waits.push(ms)
    return Promise.resolve()
  }
  return { waits, sleep }
}

describe('retryWithBackoff', () => {
  it('resolves immediately without sleeping when the first try succeeds', async () => {
    const { waits, sleep } = recordingSleep()
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retryWithBackoff(fn, { delaysMs: [10, 20], sleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
  })

  it('retries with the given delays and resolves on a later success', async () => {
    const { waits, sleep } = recordingSleep()
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue(42)
    await expect(retryWithBackoff(fn, { delaysMs: USER_SYNC_RETRY_DELAYS_MS, sleep })).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([500, 1500])
  })

  it('gives up after 1 + delays.length attempts with the last error', async () => {
    const { waits, sleep } = recordingSleep()
    let n = 0
    const fn = vi.fn(() => Promise.reject(new Error(`fail ${++n}`)))
    await expect(retryWithBackoff(fn, { delaysMs: USER_SYNC_RETRY_DELAYS_MS, sleep })).rejects.toThrow('fail 4')
    expect(fn).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([500, 1500, 4000])
  })

  it('stops retrying when shouldAbort returns true', async () => {
    const { sleep } = recordingSleep()
    const fn = vi.fn(() => Promise.reject(new Error('x')))
    await expect(
      retryWithBackoff(fn, { delaysMs: [1, 1, 1], sleep, shouldAbort: () => true }),
    ).rejects.toThrow('x')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
