/** Delays (ms) between attempts: 1 initial try + one retry per entry. */
export const USER_SYNC_RETRY_DELAYS_MS = [500, 1500, 4000] as const

export type RetryOptions = {
  /** Wait before each retry; length = max number of retries. */
  delaysMs: readonly number[]
  /** Injectable for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Return true to stop retrying (e.g. component unmounted). */
  shouldAbort?: () => boolean
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs `fn`, retrying on rejection after each delay in `delaysMs`.
 * Rejects with the last error once retries are exhausted (or aborted).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { delaysMs, sleep = defaultSleep, shouldAbort }: RetryOptions,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      const delay = delaysMs[attempt]
      if (delay === undefined || shouldAbort?.()) throw err
      attempt += 1
      await sleep(delay)
      if (shouldAbort?.()) throw err
    }
  }
}
