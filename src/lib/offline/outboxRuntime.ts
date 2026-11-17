/**
 * App-wide outbox engines: one per owner (Clerk user id) for the page's
 * lifetime, sharing the IndexedDB store, Web Locks and the broadcast channel.
 * The Convex sender is configured by OutboxProvider.
 */
import { OutboxEngine } from './outboxEngine'
import { IdbOutboxStore, type OutboxStore } from './outboxStore'
import { createBroadcast, createLocks, requestPersistentStorage, type BroadcastLike } from './platform'
import type { OutboxEntry, SendResult } from './types'

export type OutboxSender = (entry: OutboxEntry) => Promise<SendResult>

let sender: OutboxSender | null = null
let store: OutboxStore | null = null
let broadcast: BroadcastLike | null = null
const engines = new Map<string, OutboxEngine>()
const started = new Set<string>()

/** Set the function that sends an entry to Convex (with clientRequestId = entry.id). */
export function configureOutboxSender(fn: OutboxSender | null): void {
  sender = fn
}

function send(entry: OutboxEntry): Promise<SendResult> {
  if (!sender) return Promise.reject(new Error('Outbox sender not configured'))
  return sender(entry)
}

/** The engine for `owner` (created on first use; started once). */
export function getOutboxEngine(owner: string): OutboxEngine {
  let engine = engines.get(owner)
  if (!engine) {
    store ??= new IdbOutboxStore()
    broadcast ??= createBroadcast()
    engine = new OutboxEngine({
      owner,
      store,
      send,
      locks: createLocks(),
      broadcast,
      onEnqueued: () => requestPersistentStorage(),
    })
    engines.set(owner, engine)
  }
  return engine
}

/** Idempotent: subscribe to cross-tab messages and read the store. */
export function startOutboxEngine(engine: OutboxEngine): void {
  if (started.has(engine.owner)) return
  started.add(engine.owner)
  void engine.start()
}

/** Tests only. */
export function resetOutboxRuntimeForTests(overrides: { store?: OutboxStore; broadcast?: BroadcastLike } = {}): void {
  for (const e of engines.values()) e.dispose()
  engines.clear()
  started.clear()
  sender = null
  store = overrides.store ?? null
  broadcast = overrides.broadcast ?? null
}
