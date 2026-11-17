/**
 * Offline outbox engine (framework-free; every side effect injected).
 *
 * Semantics (OFFLINE-PLAN §3):
 * - One engine per owner (Clerk user id); it only reads / sends that owner's entries.
 * - FIFO, one entry at a time. An entry whose send promise is still pending
 *   (`inFlight`, shared per tab) is never sent again — the Convex client
 *   resends unanswered mutations itself after a reconnect.
 * - Success → entry deleted + broadcast. VALIDATION / NOT_FOUND → needsAttention
 *   (skipped until fixed). UNAUTHORIZED / USER_NOT_FOUND → paused until auth
 *   changes. FORBIDDEN → paused (shown). Server arg validation mentioning
 *   clientRequestId → paused (never resent without the id). Anything else →
 *   backoff min(2^n·2s, 5 min) ±20 %, and the queue waits (FIFO).
 * - Web Locks `rn-outbox:<owner>` (ifAvailable) → a single flusher across tabs.
 * - Unknown entry versions are skipped (never sent or deleted).
 */
import { backoffDelayMs, classifyError, type ErrorAction } from './classify'
import { createInTabLocks, createNoopBroadcast, type BroadcastLike, type LocksLike, type OutboxBroadcastMessage } from './platform'
import type { OutboxStore } from './outboxStore'
import {
  parseOutboxEntry,
  SEND_RESULT_KINDS,
  type OutboxEntry,
  type OutboxProblem,
  type SendResult,
  type StoredOutboxRecord,
} from './types'

export type PauseState = { reason: 'unauthorized' | 'forbidden' | 'missingBackend'; message: string }

export type OutboxEngineState = {
  owner:       string
  /** False until the store was read once. */
  loaded:      boolean
  /** Known-version entries of this owner, oldest first (just-sent ones excluded). */
  entries:     readonly OutboxEntry[]
  /** Stored records this build cannot read (newer / corrupt). Kept, not sent. */
  skippedCount: number
  paused:      PauseState | null
  /** Entry ids whose send is in progress. */
  sendingIds:  readonly string[]
}

export type WaitOutcome =
  | { status: 'saved'; result: SendResult }
  | { status: 'queued'; problem?: OutboxProblem }

export type OutboxEngineOptions = {
  owner:      string
  store:      OutboxStore
  send:       (entry: OutboxEntry) => Promise<SendResult>
  now?:       () => number
  random?:    () => number
  locks?:     LocksLike
  broadcast?: BroadcastLike
  /** Shared per tab so a remounted engine never resends a pending promise. */
  inFlight?:  Map<string, Promise<unknown>>
  setTimer?:  (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Called after each successful enqueue (e.g. navigator.storage.persist()). */
  onEnqueued?: (entry: OutboxEntry) => void
}

/** Retry delay when another tab holds the flush lock. */
export const LOCK_BUSY_RETRY_MS = 5000

const tabInFlight = new Map<string, Promise<unknown>>()

function isSendResult(value: unknown): value is SendResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { kind?: unknown; result?: unknown }
  return typeof v.kind === 'string' && SEND_RESULT_KINDS.includes(v.kind) && typeof v.result === 'object' && v.result !== null
}

export class OutboxEngine {
  private readonly opts: Required<Omit<OutboxEngineOptions, 'onEnqueued'>> & Pick<OutboxEngineOptions, 'onEnqueued'>
  private state: OutboxEngineState
  private readonly listeners = new Set<() => void>()
  private readonly waiters = new Map<string, Set<(o: WaitOutcome) => void>>()
  /** Sent successfully but maybe not yet deleted from the store. */
  private readonly sent = new Set<string>()
  private authReady = false
  private flushing = false
  private flushQueued = false
  private timer: unknown = null
  private timerAt = Infinity
  private disposed = false
  private unsubscribeBroadcast: (() => void) | null = null

  constructor(options: OutboxEngineOptions) {
    this.opts = {
      now:        () => Date.now(),
      random:     Math.random,
      locks:      createInTabLocks(),
      broadcast:  createNoopBroadcast(),
      inFlight:   tabInFlight,
      setTimer:   (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    }
    this.state = {
      owner: options.owner,
      loaded: false,
      entries: [],
      skippedCount: 0,
      paused: null,
      sendingIds: [],
    }
  }

  get owner(): string {
    return this.opts.owner
  }

  /** Subscribe to cross-tab messages and read the store. */
  start(): Promise<void> {
    this.unsubscribeBroadcast = this.opts.broadcast.subscribe((m) => this.onBroadcast(m))
    return this.refresh()
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeBroadcast?.()
    this.unsubscribeBroadcast = null
    this.clearTimer()
    for (const set of this.waiters.values()) for (const w of set) w({ status: 'queued' })
    this.waiters.clear()
    this.listeners.clear()
  }

  getState = (): OutboxEngineState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Convex auth state. Becoming ready clears an auth pause and flushes. */
  setAuthReady(ready: boolean): void {
    if (this.authReady === ready) return
    this.authReady = ready
    if (ready) {
      const reason = this.state.paused?.reason
      if (reason === 'unauthorized' || reason === 'forbidden') this.setState({ paused: null })
      this.trigger()
    }
  }

  /** Re-read entries from the store. */
  async refresh(): Promise<void> {
    if (this.disposed) return
    try {
      const records = await this.opts.store.list(this.opts.owner)
      this.applyRecords(records)
    } catch {
      if (!this.state.loaded) this.setState({ loaded: true })
    }
  }

  /** Persist a new entry, then flush in the background. Rejects if the store write failed. */
  async enqueue(entry: OutboxEntry): Promise<void> {
    if (entry.owner !== this.opts.owner) throw new Error('Outbox entry belongs to another user')
    await this.opts.store.put(entry as unknown as StoredOutboxRecord)
    if (this.disposed) return
    if (!this.state.entries.some((e) => e.id === entry.id)) {
      this.setState({ entries: [...this.state.entries, entry] })
    }
    this.opts.broadcast.post({ type: 'changed', owner: this.opts.owner })
    this.opts.onEnqueued?.(entry)
    this.trigger()
  }

  /** Fire-and-forget flush (online / visible / reconnect / interval triggers). */
  trigger(): void {
    void this.flush()
  }

  /**
   * Resolves `saved` when `id` syncs, else `queued` after `timeoutMs` or as soon
   * as it needs attention / the engine pauses.
   */
  waitFor(id: string, timeoutMs: number): Promise<WaitOutcome> {
    return new Promise((resolve) => {
      let done = false
      const finish = (o: WaitOutcome) => {
        if (done) return
        done = true
        this.opts.clearTimer(handle)
        this.waiters.get(id)?.delete(finish)
        resolve(o)
      }
      const handle = this.opts.setTimer(() => finish({ status: 'queued' }), timeoutMs)
      let set = this.waiters.get(id)
      if (!set) { set = new Set(); this.waiters.set(id, set) }
      set.add(finish)
      if (this.state.paused) finish({ status: 'queued', problem: { ...this.state.paused, at: this.opts.now() } })
    })
  }

  isSending(id: string): boolean {
    return this.opts.inFlight.has(id)
  }

  /** Delete an entry (not while it is being sent). */
  async discard(id: string): Promise<void> {
    if (this.isSending(id)) throw new Error('This entry is being sent right now. Try again in a moment.')
    await this.opts.store.delete(id)
    this.setState({ entries: this.state.entries.filter((e) => e.id !== id) })
    this.opts.broadcast.post({ type: 'changed', owner: this.opts.owner })
    await this.refresh()
  }

  /**
   * Replace an entry's content (same id = same clientRequestId), reset it to
   * pending and flush. Used by "Save for today" / "Save without category".
   */
  async update(id: string, change: (entry: OutboxEntry) => OutboxEntry): Promise<void> {
    if (this.isSending(id)) throw new Error('This entry is being sent right now. Try again in a moment.')
    const current = parseOutboxEntry(await this.opts.store.get(id))
    if (!current || current.owner !== this.opts.owner) throw new Error('Entry not found')
    const changed = change(current)
    const { lastError: _dropped, ...rest } = changed
    void _dropped
    const next = { ...rest, id: current.id, owner: current.owner, status: 'pending', attempts: 0, nextAttemptAt: 0 } as OutboxEntry
    await this.opts.store.put(next as unknown as StoredOutboxRecord)
    this.opts.broadcast.post({ type: 'changed', owner: this.opts.owner })
    await this.refresh()
    this.trigger()
  }

  /** Clear pauses and backoff, then flush now. */
  async retryNow(): Promise<void> {
    if (this.state.paused) this.setState({ paused: null })
    const now = this.opts.now()
    for (const e of this.state.entries) {
      if (e.status === 'pending' && e.nextAttemptAt > now && !this.isSending(e.id)) {
        try {
          await this.opts.store.put({ ...e, nextAttemptAt: 0 } as unknown as StoredOutboxRecord)
        } catch { /* best effort */ }
      }
    }
    await this.refresh()
    await this.flush()
  }

  /** Send due entries one at a time. Safe to call concurrently (coalesced). */
  async flush(): Promise<void> {
    if (this.disposed) return
    if (this.flushing) {
      this.flushQueued = true
      return
    }
    this.flushing = true
    try {
      do {
        this.flushQueued = false
        if (!this.canSend()) break
        await this.opts.locks.runExclusive(`rn-outbox:${this.opts.owner}`, async (acquired) => {
          if (!acquired) {
            // Another tab is flushing; it broadcasts its progress. Check again later.
            this.scheduleAt(this.opts.now() + LOCK_BUSY_RETRY_MS)
            return
          }
          await this.drain()
        })
      } while (this.flushQueued && !this.disposed)
    } finally {
      this.flushing = false
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private canSend(): boolean {
    return !this.disposed && this.authReady && this.state.paused === null
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (!this.canSend()) return
      let records: StoredOutboxRecord[]
      try {
        records = await this.opts.store.list(this.opts.owner)
      } catch {
        return
      }
      const entries = this.applyRecords(records)
      const next = entries.find((e) => e.status === 'pending')
      if (!next) return
      const pending = this.opts.inFlight.get(next.id)
      if (pending) {
        // Sent by an earlier engine instance in this tab: wait for it (FIFO).
        void pending.finally(() => this.trigger()).catch(() => {})
        return
      }
      const now = this.opts.now()
      if (next.nextAttemptAt > now) {
        this.scheduleAt(next.nextAttemptAt)
        return
      }
      const keepGoing = await this.sendOne(next)
      if (!keepGoing) return
    }
  }

  /** True when the queue may continue with the next entry. */
  private async sendOne(entry: OutboxEntry): Promise<boolean> {
    const promise = this.opts.send(entry)
    this.opts.inFlight.set(entry.id, promise)
    this.setState({ sendingIds: [...this.state.sendingIds, entry.id] })
    try {
      const result = await promise
      this.sent.add(entry.id)
      this.setState({ entries: this.state.entries.filter((e) => e.id !== entry.id) })
      this.resolveWaiters(entry.id, { status: 'saved', result })
      try {
        await this.opts.store.delete(entry.id)
        this.sent.delete(entry.id)
      } catch {
        // Stays excluded for this page; a later page resends it and the server
        // ledger returns the first result without writing again.
      }
      this.opts.broadcast.post({ type: 'sent', owner: this.opts.owner, id: entry.id, result })
      return true
    } catch (err) {
      return this.handleFailure(entry, classifyError(err, entry.kind))
    } finally {
      this.opts.inFlight.delete(entry.id)
      this.setState({ sendingIds: this.state.sendingIds.filter((id) => id !== entry.id) })
    }
  }

  private async handleFailure(entry: OutboxEntry, cls: ErrorAction): Promise<boolean> {
    const now = this.opts.now()
    let current: OutboxEntry | null = null
    try {
      current = parseOutboxEntry(await this.opts.store.get(entry.id))
    } catch {
      current = entry
    }
    if (!current) return true // discarded meanwhile
    const problem: OutboxProblem = { reason: cls.reason, message: cls.message, at: now }
    let updated: OutboxEntry
    if (cls.action === 'needsAttention') {
      updated = { ...current, status: 'needsAttention', attempts: current.attempts + 1, lastError: problem }
    } else if (cls.action === 'pause') {
      updated = { ...current, lastError: problem }
    } else {
      const attempts = current.attempts + 1
      updated = {
        ...current,
        attempts,
        nextAttemptAt: now + backoffDelayMs(attempts, this.opts.random),
        lastError: problem,
      }
    }
    try {
      await this.opts.store.put(updated as unknown as StoredOutboxRecord)
    } catch { /* keep in memory */ }
    this.setState({
      entries: this.state.entries.map((e) => (e.id === updated.id ? updated : e)),
      ...(cls.action === 'pause' ? { paused: { reason: cls.reason, message: cls.message } } : {}),
    })
    this.opts.broadcast.post({ type: 'changed', owner: this.opts.owner })

    if (cls.action === 'needsAttention') {
      this.resolveWaiters(entry.id, { status: 'queued', problem })
      return true
    }
    if (cls.action === 'pause') {
      for (const id of [...this.waiters.keys()]) this.resolveWaiters(id, { status: 'queued', problem })
      return false
    }
    this.scheduleAt(updated.nextAttemptAt)
    return false
  }

  private applyRecords(records: StoredOutboxRecord[]): OutboxEntry[] {
    const entries: OutboxEntry[] = []
    let skipped = 0
    for (const r of records) {
      const e = parseOutboxEntry(r)
      if (!e || e.owner !== this.opts.owner) { skipped += 1; continue }
      if (this.sent.has(e.id)) continue
      entries.push(e)
    }
    this.setState({ loaded: true, entries, skippedCount: skipped })
    return entries
  }

  private onBroadcast(message: OutboxBroadcastMessage): void {
    if (this.disposed || message.owner !== this.opts.owner) return
    if (message.type === 'sent' && isSendResult(message.result)) {
      this.resolveWaiters(message.id, { status: 'saved', result: message.result })
    }
    void this.refresh().then(() => this.trigger())
  }

  private resolveWaiters(id: string, outcome: WaitOutcome): void {
    const set = this.waiters.get(id)
    if (!set) return
    this.waiters.delete(id)
    for (const w of [...set]) w(outcome)
  }

  private scheduleAt(at: number): void {
    if (this.disposed) return
    if (this.timer !== null && this.timerAt <= at) return
    this.clearTimer()
    this.timerAt = at
    this.timer = this.opts.setTimer(() => {
      this.timer = null
      this.timerAt = Infinity
      this.trigger()
    }, Math.max(0, at - this.opts.now()))
  }

  private clearTimer(): void {
    if (this.timer !== null) this.opts.clearTimer(this.timer)
    this.timer = null
    this.timerAt = Infinity
  }

  private setState(patch: Partial<OutboxEngineState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const l of [...this.listeners]) l()
  }
}
