/**
 * Offline outbox entry shapes (stored in IndexedDB `outbox`).
 *
 * Entries carry a version `v`. A build only processes versions it knows
 * (`OUTBOX_ENTRY_VERSION`); unknown versions (written by a newer build that was
 * later rolled back, or a corrupt row) are left untouched — never sent, never
 * deleted. Bump `v` (and add a migration in `parseOutboxEntry`) when the shape
 * changes; bump the DB version only for store/index changes (`db.ts` upgrade).
 *
 * Khata kinds (`khataSale` / `khataAdvance` / `khataPayment`) are written with
 * `v: KHATA_OUTBOX_ENTRY_VERSION` (2). Builds from before khata only accept
 * `v: 1`, so they skip these entries (kept in the store, never sent or
 * deleted) while still syncing their own v1 sales / expenses.
 */
import type { Id } from '../../../convex/_generated/dataModel'

export const OUTBOX_ENTRY_VERSION = 1
export const KHATA_OUTBOX_ENTRY_VERSION = 2

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

export type Recognition = 'delivery' | 'cash'

/** An existing customer, or find-or-create by name (server side). Omitted = a record without a name. */
export type KhataCustomerArg = { id: Id<'customers'> } | { name: string; phone?: string }

/** `khata.recordSale` args without `clientRequestId`. `recognition` is always sent. */
export type KhataSaleArgs = {
  customer?:   KhataCustomerArg
  items:       SaleItemArgs[]
  sessionDate: number
  receivedNow: number
  recognition: Recognition
}

/** `khata.openAdvance` args without `clientRequestId`. */
export type KhataAdvanceArgs = {
  customer?:   KhataCustomerArg
  amount:      number
  receivedAt:  number
  total?:      number
  itemLabel?:  string
  dueDate?:    number
  note?:       string
  recognition: Recognition
}

/** `khata.receivePayment` args without `clientRequestId` (server-known entries only). */
export type KhataPaymentArgs = {
  entryId:    Id<'khataEntries'>
  amount:     number
  receivedAt: number
}

/**
 * Display data saved with a khata entry at enqueue time (never sent):
 * the customer name and how much the write adds to SALES (`countedAmount`,
 * from the cached recognition), so totals stay right while it waits.
 */
export type KhataMeta = {
  /** Absent / empty = a record without a name (shown as 'No name'). */
  customerName?:  string
  countedAmount:  number
  /** Kind of the record a payment is for (names the pending sale row). */
  entryKind?:     'udhaar' | 'advance'
  customerId?:    string
}

export type KhataSaleResult = {
  entryId:    Id<'khataEntries'>
  sessionId?: Id<'saleSessions'>
  remaining:  number
}
export type KhataAdvanceResult = { entryId: Id<'khataEntries'> }
export type KhataPaymentResult = {
  paymentId: Id<'khataPayments'>
  remaining: number | null
  status:    'booked' | 'due' | 'settled' | 'cancelled'
}

export type EntryKind = 'sale' | 'expense' | 'khataSale' | 'khataAdvance' | 'khataPayment'
export const KHATA_ENTRY_KINDS = ['khataSale', 'khataAdvance', 'khataPayment'] as const

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

type OutboxEntryBase<V extends number = typeof OUTBOX_ENTRY_VERSION> = {
  v:             V
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
type KhataBase = OutboxEntryBase<typeof KHATA_OUTBOX_ENTRY_VERSION> & { khata: KhataMeta }
export type KhataSaleOutboxEntry = KhataBase & { kind: 'khataSale'; args: KhataSaleArgs }
export type KhataAdvanceOutboxEntry = KhataBase & { kind: 'khataAdvance'; args: KhataAdvanceArgs }
export type KhataPaymentOutboxEntry = KhataBase & { kind: 'khataPayment'; args: KhataPaymentArgs }
export type KhataOutboxEntry = KhataSaleOutboxEntry | KhataAdvanceOutboxEntry | KhataPaymentOutboxEntry
export type OutboxEntry = SaleOutboxEntry | ExpenseOutboxEntry | KhataOutboxEntry

export function isKhataEntry(entry: OutboxEntry): entry is KhataOutboxEntry {
  return entry.kind === 'khataSale' || entry.kind === 'khataAdvance' || entry.kind === 'khataPayment'
}

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
  | { kind: 'khataSale'; result: KhataSaleResult }
  | { kind: 'khataAdvance'; result: KhataAdvanceResult }
  | { kind: 'khataPayment'; result: KhataPaymentResult }

export const SEND_RESULT_KINDS: readonly string[] = ['sale', 'expense', ...KHATA_ENTRY_KINDS]

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

const isRecognitionValue = (v: unknown): v is Recognition => v === 'delivery' || v === 'cash'
const isOptionalNumber = (v: unknown) => v === undefined || isFiniteNumber(v)

function isOptionalCustomerArg(v: unknown): v is KhataCustomerArg | undefined {
  if (v === undefined) return true
  if (!isRecord(v)) return false
  if (typeof v.id === 'string') return true
  return typeof v.name === 'string' && isOptionalString(v.phone)
}

function isKhataMeta(v: unknown): v is KhataMeta {
  return isRecord(v) && isOptionalString(v.customerName) && isFiniteNumber(v.countedAmount) &&
    (v.entryKind === undefined || v.entryKind === 'udhaar' || v.entryKind === 'advance') &&
    isOptionalString(v.customerId)
}

function isKhataSaleArgs(v: unknown): v is KhataSaleArgs {
  return isRecord(v) && isOptionalCustomerArg(v.customer) && isSaleArgs({ items: v.items, sessionDate: v.sessionDate }) &&
    isFiniteNumber(v.receivedNow) && isRecognitionValue(v.recognition)
}

function isKhataAdvanceArgs(v: unknown): v is KhataAdvanceArgs {
  return isRecord(v) && isOptionalCustomerArg(v.customer) && isFiniteNumber(v.amount) && isFiniteNumber(v.receivedAt) &&
    isOptionalNumber(v.total) && isOptionalString(v.itemLabel) && isOptionalNumber(v.dueDate) &&
    isOptionalString(v.note) && isRecognitionValue(v.recognition)
}

function isKhataPaymentArgs(v: unknown): v is KhataPaymentArgs {
  return isRecord(v) && typeof v.entryId === 'string' && isFiniteNumber(v.amount) && isFiniteNumber(v.receivedAt)
}

/**
 * A stored record → an entry this build can process, or null (unknown `v`,
 * unknown kind, missing fields). Null records are skipped, never deleted.
 */
export function parseOutboxEntry(raw: unknown): OutboxEntry | null {
  if (!isRecord(raw)) return null
  if (raw.v !== OUTBOX_ENTRY_VERSION && raw.v !== KHATA_OUTBOX_ENTRY_VERSION) return null
  if (typeof raw.id !== 'string' || typeof raw.owner !== 'string') return null
  if (typeof raw.dayKey !== 'string' || typeof raw.tz !== 'string') return null
  if (!isFiniteNumber(raw.createdAt) || !isFiniteNumber(raw.attempts) || !isFiniteNumber(raw.nextAttemptAt)) return null
  if (raw.status !== 'pending' && raw.status !== 'needsAttention') return null
  if (raw.v === OUTBOX_ENTRY_VERSION) {
    if (raw.kind === 'sale' && isSaleArgs(raw.args)) return raw as unknown as SaleOutboxEntry
    if (raw.kind === 'expense' && isExpenseArgs(raw.args)) return raw as unknown as ExpenseOutboxEntry
    return null
  }
  if (!isKhataMeta(raw.khata)) return null
  if (raw.kind === 'khataSale' && isKhataSaleArgs(raw.args)) return raw as unknown as KhataSaleOutboxEntry
  if (raw.kind === 'khataAdvance' && isKhataAdvanceArgs(raw.args)) return raw as unknown as KhataAdvanceOutboxEntry
  if (raw.kind === 'khataPayment' && isKhataPaymentArgs(raw.args)) return raw as unknown as KhataPaymentOutboxEntry
  return null
}

/** Entry date (ms) used for day / period placement. */
export function entryDateMs(entry: OutboxEntry): number {
  switch (entry.kind) {
    case 'sale':
    case 'khataSale':
      return entry.args.sessionDate
    case 'expense':
      return entry.args.expenseDate
    default:
      return entry.args.receivedAt
  }
}

/** "Ali · Udhaar", or just "Udhaar" for a record without a name. */
function khataItemName(name: string | undefined, label: string): string {
  const n = name?.trim()
  return n ? `${n} · ${label}` : label
}

/** The saved customer name of a khata entry, or null for a record without a name. */
export function khataEntryName(entry: KhataOutboxEntry): string | null {
  return entry.khata.customerName?.trim() || null
}

/**
 * Sale items this entry adds to the day list while it waits (what the
 * server will record as a sale session):
 * - sale: its items;
 * - khataSale: 'delivery' → the whole bill's items; 'cash' → one item
 *   "Ali · Udhaar" of the cash received now (none when 0);
 * - khataAdvance / khataPayment: 'cash' → one item of the amount, else none.
 */
export function entryOverlayItems(entry: OutboxEntry): SaleItemArgs[] {
  switch (entry.kind) {
    case 'sale':
      return entry.args.items
    case 'expense':
      return []
    case 'khataSale': {
      if (entry.args.recognition === 'delivery') return entry.args.items
      const amount = entry.khata.countedAmount
      if (!(amount > 0)) return []
      const first = entry.args.items[0]?.categoryId
      const shared = first !== undefined && entry.args.items.every((i) => i.categoryId === first) ? first : undefined
      return [{ productName: khataItemName(entry.khata.customerName, 'Udhaar'), amount, ...(shared ? { categoryId: shared } : {}) }]
    }
    default: {
      const amount = entry.khata.countedAmount
      if (!(amount > 0)) return []
      const label = entry.kind === 'khataAdvance' || entry.khata.entryKind === 'advance' ? 'Advance' : 'Udhaar'
      return [{ productName: khataItemName(entry.khata.customerName, label), amount }]
    }
  }
}

/** What the entry adds to sales (sale items, or a khata entry's `countedAmount`). */
export function entrySalesTotal(entry: OutboxEntry): number {
  return entryOverlayItems(entry).reduce((s, i) => s + i.amount, 0)
}

export function entryExpenseTotal(entry: OutboxEntry): number {
  return entry.kind === 'expense' ? entry.args.amount : 0
}

/** The money shown for an entry: sale total, expense, bill, advance or payment. */
export function entryAmount(entry: OutboxEntry): number {
  switch (entry.kind) {
    case 'sale':
    case 'khataSale':
      return entry.args.items.reduce((s, i) => s + i.amount, 0)
    default:
      return entry.args.amount
  }
}
