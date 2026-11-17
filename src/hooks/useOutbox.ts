import { useCallback, useContext, useMemo } from 'react'
import { OutboxContext } from '@/lib/offline/context'
import type { PauseState } from '@/lib/offline/outboxEngine'
import { pendingEntryIdOf } from '@/lib/offline/overlay'
import type { OutboxEntry } from '@/lib/offline/types'
import { startOfDay, toLocalDateKey, getClientTimeZone } from '@/lib/utils'

export type OutboxApi = {
  /** The current Clerk user's queued entries, oldest first (also shown in admin view-as). */
  entries:             readonly OutboxEntry[]
  /** All entries still waiting (pending + needsAttention). */
  pendingCount:        number
  needsAttentionCount: number
  /** Set while syncing is paused (signed out / forbidden / backend too old). */
  paused:              PauseState | null
  /** False until the queue was read from this phone. */
  loaded:              boolean
  isSending:           (idOrRowId: string) => boolean
  /** Entry for an outbox id or a synthetic row id (`pending:<id>[:<i>]`). */
  getEntry:            (idOrRowId: string) => OutboxEntry | undefined
  discard:             (idOrRowId: string) => Promise<void>
  /** "Save for today": move the entry's date to today (same clientRequestId). */
  fixSaveForToday:     (idOrRowId: string) => Promise<void>
  /** "Save without category": drop category ids from a sale's items. */
  fixWithoutCategory:  (idOrRowId: string) => Promise<void>
  /** Queued payment: new amount (same clientRequestId), then sync. */
  fixPaymentAmount:    (idOrRowId: string, amount: number) => Promise<void>
  /** Clear pause / backoff and sync now. */
  retryNow:            () => Promise<void>
  /** "Try again" for one entry: back to pending (same clientRequestId), then sync. */
  retryEntry:          (idOrRowId: string) => Promise<void>
}

const EMPTY: readonly OutboxEntry[] = []
const resolveId = (idOrRowId: string) => pendingEntryIdOf(idOrRowId) ?? idOrRowId

/** Move an entry to today (local start of day), keeping everything else. */
export function moveEntryToToday(entry: OutboxEntry, now: number = Date.now()): OutboxEntry {
  const today = startOfDay(new Date(now))
  const dayKey = toLocalDateKey(today)
  const tz = getClientTimeZone()
  switch (entry.kind) {
    case 'sale':
    case 'khataSale':
      return { ...entry, dayKey, tz, args: { ...entry.args, sessionDate: today } } as OutboxEntry
    case 'expense':
      return { ...entry, dayKey, tz, args: { ...entry.args, expenseDate: today } }
    default:
      return { ...entry, dayKey, tz, args: { ...entry.args, receivedAt: today } } as OutboxEntry
  }
}

/** A sale (or Udhaar sale) without category ids (other kinds unchanged). */
export function dropEntryCategories(entry: OutboxEntry): OutboxEntry {
  if (entry.kind !== 'sale' && entry.kind !== 'khataSale') return entry
  const { categoryLabels: _labels, ...rest } = entry
  void _labels
  return {
    ...rest,
    args: {
      ...entry.args,
      items: entry.args.items.map(({ categoryId: _c, ...item }) => {
        void _c
        return item
      }),
    },
  } as OutboxEntry
}

/**
 * "Change amount" for a queued payment (e.g. after "More than Baqi"): new
 * amount, sales overlay (`countedAmount`) scaled to match. Other kinds unchanged.
 */
export function changePaymentAmount(entry: OutboxEntry, amount: number): OutboxEntry {
  if (entry.kind !== 'khataPayment') return entry
  const counted = entry.khata.countedAmount > 0 ? amount : 0
  return { ...entry, args: { ...entry.args, amount }, khata: { ...entry.khata, countedAmount: counted } }
}

/** Offline outbox for the current user (empty outside OutboxProvider). */
export function useOutbox(): OutboxApi {
  const ctx = useContext(OutboxContext)
  const engine = ctx?.engine ?? null
  const state = ctx?.state ?? null
  const entries = state?.entries ?? EMPTY

  const noEngine = useCallback(async () => {
    throw new Error('Offline queue is not available')
  }, [])

  const discard = useCallback(
    (id: string) => (engine ? engine.discard(resolveId(id)) : noEngine()),
    [engine, noEngine],
  )
  const fixSaveForToday = useCallback(
    (id: string) => (engine ? engine.update(resolveId(id), (e) => moveEntryToToday(e)) : noEngine()),
    [engine, noEngine],
  )
  const fixWithoutCategory = useCallback(
    (id: string) => (engine ? engine.update(resolveId(id), dropEntryCategories) : noEngine()),
    [engine, noEngine],
  )
  const fixPaymentAmount = useCallback(
    (id: string, amount: number) => (engine ? engine.update(resolveId(id), (e) => changePaymentAmount(e, amount)) : noEngine()),
    [engine, noEngine],
  )
  const retryNow = useCallback(() => (engine ? engine.retryNow() : Promise.resolve()), [engine])
  const retryEntry = useCallback(
    (id: string) => (engine ? engine.update(resolveId(id), (e) => e) : noEngine()),
    [engine, noEngine],
  )
  const isSending = useCallback((id: string) => engine?.isSending(resolveId(id)) ?? false, [engine])
  const getEntry = useCallback((id: string) => entries.find((e) => e.id === resolveId(id)), [entries])

  return useMemo(
    () => ({
      entries,
      pendingCount: entries.length,
      needsAttentionCount: entries.filter((e) => e.status === 'needsAttention').length,
      paused: state?.paused ?? null,
      loaded: state?.loaded ?? ctx === null,
      isSending,
      getEntry,
      discard,
      fixSaveForToday,
      fixWithoutCategory,
      fixPaymentAmount,
      retryNow,
      retryEntry,
    }),
    [entries, state, ctx, isSending, getEntry, discard, fixSaveForToday, fixWithoutCategory, fixPaymentAmount, retryNow, retryEntry],
  )
}
