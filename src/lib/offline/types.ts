/**
 * Offline outbox entry shapes (stored in IndexedDB `outbox`).
 *
 * Entries carry a version `v`. A build only processes versions it knows
 * (`OUTBOX_ENTRY_VERSION`); unknown versions (written by a newer build that was
 * later rolled back, or a corrupt row) are left untouched — never sent, never
 * deleted. Bump `v` (and add a migration in `parseOutboxEntry`) when the shape
 * changes; bump the DB version only for store/index changes (`db.ts` upgrade).
 */
import type { Id } from '../../../convex/_generated/dataModel'

export const OUTBOX_ENTRY_VERSION = 1

export type SaleItemArgs = {
  productName: string
  amount:      number
  categoryId?: Id<'categories'>
  note?:       string
}

/** `saleSessions.record` args without `clientRequestId` (the entry id is sent as that). */
export type SaleArgs = {
  items:       SaleItemArgs[]
  sessionDate: number
}

/** `expenses.record` args without `clientRequestId`. */
export type ExpenseArgs = {
  amount:      number
  expenseDate: number
  note?:       string
}

export type SaleResult = {
  sessionId:   Id<'saleSessions'>
  totalAmount: number
  itemCount:   number
}

export type ExpenseResult = {
  expenseId: Id<'expenses'>
  amount:    number
}

export type EntryKind = 'sale' | 'expense'

/**
 * Why an entry is not syncing:
 * - `validation` / `notFound` / `clock` → entry is `needsAttention` (user action);
 * - `unauthorized` / `forbidden` / `missingBackend` → the engine is paused;
 * - `transient` → retried with backoff.
 */
export type OutboxProblemReason =
  | 'validation'
  | 'notFound'
  | 'clock'
  | 'unauthorized'
  | 'forbidden'
  | 'missingBackend'
  | 'transient'

export type OutboxProblem = {
  reason:  OutboxProblemReason
  /** Safe to show (server ConvexError message or our own text). */
  message: string
  at:      number
}

export type OutboxStatus = 'pending' | 'needsAttention'

type OutboxEntryBase = {
  v:             typeof OUTBOX_ENTRY_VERSION
  /** Also the `clientRequestId` sent to the server (idempotency key). */
  id:            string
  /** Clerk user id that created the entry. Only that user's session sends it. */
  owner:         string
  /** Local calendar day (YYYY-MM-DD, in `tz`) of the entry date, computed at enqueue. */
  dayKey:        string
  tz:            string
  createdAt:     number
  status:        OutboxStatus
  attempts:      number
  /** Earliest time (ms) the engine may send again (0 = now). */
  nextAttemptAt: number
  lastError?:    OutboxProblem
  /** categoryId → name at enqueue time, so pending rows can show the name offline. */
  categoryLabels?: Record<string, string>
}

export type SaleOutboxEntry = OutboxEntryBase & { kind: 'sale'; args: SaleArgs }
export type ExpenseOutboxEntry = OutboxEntryBase & { kind: 'expense'; args: ExpenseArgs }
export type OutboxEntry = SaleOutboxEntry | ExpenseOutboxEntry

/** What the stores persist: any versioned record keyed by id + owner. */
export type StoredOutboxRecord = {
  id:        string
  owner:     string
  createdAt: number
  v:         number
  [key: string]: unknown
}

export type SendResult =
  | { kind: 'sale'; result: SaleResult }
  | { kind: 'expense'; result: ExpenseResult }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isOptionalString = (v: unknown) => v === undefined || typeof v === 'string'

function isSaleArgs(v: unknown): v is SaleArgs {
  if (!isRecord(v) || !isFiniteNumber(v.sessionDate) || !Array.isArray(v.items)) return false
  return v.items.every((item: unknown) =>
    isRecord(item) &&
    typeof item.productName === 'string' &&
    isFiniteNumber(item.amount) &&
    isOptionalString(item.categoryId) &&
    isOptionalString(item.note))
}

function isExpenseArgs(v: unknown): v is ExpenseArgs {
  return isRecord(v) && isFiniteNumber(v.amount) && isFiniteNumber(v.expenseDate) && isOptionalString(v.note)
}

/**
 * A stored record → an entry this build can process, or null (unknown `v`,
 * missing fields). Null records are skipped, never deleted.
 */
export function parseOutboxEntry(raw: unknown): OutboxEntry | null {
  if (!isRecord(raw) || raw.v !== OUTBOX_ENTRY_VERSION) return null
  if (typeof raw.id !== 'string' || typeof raw.owner !== 'string') return null
  if (typeof raw.dayKey !== 'string' || typeof raw.tz !== 'string') return null
  if (!isFiniteNumber(raw.createdAt) || !isFiniteNumber(raw.attempts) || !isFiniteNumber(raw.nextAttemptAt)) return null
  if (raw.status !== 'pending' && raw.status !== 'needsAttention') return null
  if (raw.kind === 'sale' && isSaleArgs(raw.args)) return raw as unknown as SaleOutboxEntry
  if (raw.kind === 'expense' && isExpenseArgs(raw.args)) return raw as unknown as ExpenseOutboxEntry
  return null
}

/** Entry date (ms) used for day / period placement. */
export function entryDateMs(entry: OutboxEntry): number {
  return entry.kind === 'sale' ? entry.args.sessionDate : entry.args.expenseDate
}

/** Sum of a sale entry's item amounts (0 for expenses). */
export function entrySalesTotal(entry: OutboxEntry): number {
  return entry.kind === 'sale' ? entry.args.items.reduce((s, i) => s + i.amount, 0) : 0
}

export function entryExpenseTotal(entry: OutboxEntry): number {
  return entry.kind === 'expense' ? entry.args.amount : 0
}
