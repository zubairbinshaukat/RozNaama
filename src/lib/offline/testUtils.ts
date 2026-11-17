/** Test helpers for the offline core (imported by *.test.ts only). */
import type { Id } from '../../../convex/_generated/dataModel'
import type { BroadcastLike, OutboxBroadcastMessage } from './platform'
import { OUTBOX_ENTRY_VERSION, type ExpenseOutboxEntry, type SaleOutboxEntry } from './types'

export const OWNER = 'user_a'

export function saleEntry(id: string, overrides: Partial<SaleOutboxEntry> = {}): SaleOutboxEntry {
  return {
    v: OUTBOX_ENTRY_VERSION,
    id,
    owner: OWNER,
    kind: 'sale',
    args: { items: [{ productName: 'Chai', amount: 50 }], sessionDate: Date.parse('2026-03-12T00:00:00+05:00') },
    dayKey: '2026-03-12',
    tz: 'Asia/Karachi',
    createdAt: 1,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    ...overrides,
  }
}

export function expenseEntry(id: string, overrides: Partial<ExpenseOutboxEntry> = {}): ExpenseOutboxEntry {
  return {
    v: OUTBOX_ENTRY_VERSION,
    id,
    owner: OWNER,
    kind: 'expense',
    args: { amount: 20, expenseDate: Date.parse('2026-03-12T00:00:00+05:00') },
    dayKey: '2026-03-12',
    tz: 'Asia/Karachi',
    createdAt: 1,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    ...overrides,
  }
}

export const saleResult = (n: number) => ({
  kind: 'sale' as const,
  result: { sessionId: `ss${n}` as Id<'saleSessions'>, totalAmount: 50, itemCount: 1 },
})

/** In-process broadcast bus: every member except the sender receives a message. */
export function createBus() {
  const members = new Set<(m: OutboxBroadcastMessage) => void>()
  return {
    member(): BroadcastLike {
      const own = new Set<(m: OutboxBroadcastMessage) => void>()
      const deliver = (m: OutboxBroadcastMessage) => { for (const l of own) l(m) }
      members.add(deliver)
      return {
        post(m) { for (const d of members) if (d !== deliver) d(m) },
        subscribe(l) { own.add(l); return () => { own.delete(l) } },
        close() { members.delete(deliver) },
      }
    },
  }
}

export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Let pending promise chains settle. */
export async function settle(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
