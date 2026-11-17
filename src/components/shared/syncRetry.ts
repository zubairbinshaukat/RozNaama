import { ConvexError } from 'convex/values'
import { retryWithBackoff, type RetryOptions } from '@/lib/retry'

/**
 * True for errors the server raised on purpose (a `ConvexError`, e.g.
 * FORBIDDEN "This email is linked to a different account…"). Retrying those
 * cannot help; only transient failures (network, server hiccups) are retried.
 */
export function isPermanentSyncError(err: unknown): boolean {
  if (err instanceof ConvexError) return true
  // Duck-typed in case the error crossed a module boundary.
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'ConvexError'
}

/** `retryWithBackoff` that gives up immediately on a permanent (ConvexError) failure. */
export async function retryTransient<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let permanent = false
  return retryWithBackoff(
    async () => {
      try {
        return await fn()
      } catch (err) {
        if (isPermanentSyncError(err)) permanent = true
        throw err
      }
    },
    { ...options, shouldAbort: () => permanent || (options.shouldAbort?.() ?? false) },
  )
}
