/**
 * Thin, injectable wrappers over browser APIs the outbox uses (Web Locks,
 * BroadcastChannel, storage persistence), each with a fallback.
 */

export interface LocksLike {
  /**
   * Run `fn` holding the exclusive lock `name`, or call `fn(false)` right away
   * when another holder has it (`ifAvailable`).
   */
  runExclusive(name: string, fn: (acquired: boolean) => Promise<void>): Promise<void>
}

type NavigatorLocks = {
  request(
    name: string,
    options: { ifAvailable: boolean; mode: 'exclusive' },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<void>
}

/** In-tab fallback (no navigator.locks): one holder per name within this page. */
export function createInTabLocks(): LocksLike {
  const held = new Set<string>()
  return {
    async runExclusive(name, fn) {
      if (held.has(name)) return fn(false)
      held.add(name)
      try {
        await fn(true)
      } finally {
        held.delete(name)
      }
    },
  }
}

/**
 * Web Locks when available (one flusher across tabs); otherwise an in-tab
 * lock. Without Web Locks two tabs may both send an entry; the server's
 * clientRequestId ledger makes that harmless.
 */
export function createLocks(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): LocksLike {
  const locks = (nav as { locks?: NavigatorLocks } | undefined)?.locks
  if (!locks || typeof locks.request !== 'function') return createInTabLocks()
  return {
    runExclusive(name, fn) {
      return locks.request(name, { ifAvailable: true, mode: 'exclusive' }, (lock) => fn(lock !== null))
    },
  }
}

export type OutboxBroadcastMessage =
  | { type: 'changed'; owner: string }
  | { type: 'sent'; owner: string; id: string; result: unknown }

export interface BroadcastLike {
  post(message: OutboxBroadcastMessage): void
  subscribe(listener: (message: OutboxBroadcastMessage) => void): () => void
  close(): void
}

export const OUTBOX_CHANNEL = 'rn-outbox'
const STORAGE_PING_KEY = 'rn-outbox-ping'

function isMessage(value: unknown): value is OutboxBroadcastMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as { type?: unknown; owner?: unknown; id?: unknown }
  if (typeof m.owner !== 'string') return false
  return m.type === 'changed' || (m.type === 'sent' && typeof m.id === 'string')
}

export function createNoopBroadcast(): BroadcastLike {
  return { post() {}, subscribe: () => () => {}, close() {} }
}

/** BroadcastChannel, else `storage` events on a localStorage ping key, else a no-op. */
export function createBroadcast(): BroadcastLike {
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(OUTBOX_CHANNEL)
    const listeners = new Set<(m: OutboxBroadcastMessage) => void>()
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isMessage(event.data)) for (const l of listeners) l(event.data)
    }
    return {
      post(message) {
        try { channel.postMessage(message) } catch { /* closed */ }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      close() {
        listeners.clear()
        channel.close()
      },
    }
  }
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const listeners = new Set<(m: OutboxBroadcastMessage) => void>()
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_PING_KEY || !event.newValue) return
      try {
        const parsed: unknown = JSON.parse(event.newValue)
        const message = (parsed as { message?: unknown }).message
        if (isMessage(message)) for (const l of listeners) l(message)
      } catch { /* ignore */ }
    }
    window.addEventListener('storage', onStorage)
    return {
      post(message) {
        try {
          localStorage.setItem(STORAGE_PING_KEY, JSON.stringify({ message, nonce: Math.random() }))
        } catch { /* storage unavailable */ }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      close() {
        listeners.clear()
        window.removeEventListener('storage', onStorage)
      },
    }
  }
  return createNoopBroadcast()
}

let persistRequested = false

/** Ask the browser not to evict our storage (once per page; result ignored). */
export function requestPersistentStorage(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): void {
  if (persistRequested) return
  persistRequested = true
  const storage = (nav as { storage?: { persist?: () => Promise<boolean> } } | undefined)?.storage
  try {
    void storage?.persist?.().catch(() => {})
  } catch {
    // unsupported
  }
}

/** Tests only. */
export function resetPersistRequestForTests(): void {
  persistRequested = false
}
