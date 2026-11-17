/**
 * Khata balances: paisa math, an entry's contribution to the stored
 * aggregates, and the entry write primitives that keep `customers` and
 * `khataTotals` in sync in the SAME mutation (like the sales totals hooks).
 *
 * Every `khataEntries` insert/patch/delete goes through insertEntry /
 * patchEntry / deleteEntry. Must not import model/sales (see model/khataLinks).
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type ReadCtx = QueryCtx | MutationCtx

export type KhataEntry = Doc<'khataEntries'>
export type KhataStatus = KhataEntry['status']

// ─── Money ──────────────────────────────────────────────────────────────────

/** PKR → integer paisa. Legacy-safe: non-finite → 0. */
export function toPaisa(x: number | undefined): number {
  if (x === undefined || !Number.isFinite(x)) return 0
  return Math.round(x * 100)
}

/** Integer paisa → PKR. */
export function fromPaisa(paisa: number): number {
  return paisa / 100
}

/** Round a PKR sum to paisa (keeps stored aggregates free of float drift). */
export function roundMoney(x: number): number {
  return fromPaisa(toPaisa(x))
}

/** "PKR 1,234" / "PKR 1,234.5" for error messages (matches the app's formatCurrency style). */
export function formatPkr(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  return `PKR ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

// ─── Balances ───────────────────────────────────────────────────────────────

/** total − paid − forgiven in paisa, or null when the entry has no total (open advance). */
export function remainingPaisa(entry: Pick<KhataEntry, 'total' | 'paid' | 'forgiven'>): number | null {
  if (entry.total === undefined) return null
  return toPaisa(entry.total) - toPaisa(entry.paid) - toPaisa(entry.forgiven)
}

/** Remaining in PKR (never negative), or null without a total. */
export function remainingOf(entry: Pick<KhataEntry, 'total' | 'paid' | 'forgiven'>): number | null {
  const r = remainingPaisa(entry)
  return r === null ? null : fromPaisa(Math.max(0, r))
}

/** 'due' while something is left of a delivered bill, else 'settled'. */
export function deliveredStatus(entry: Pick<KhataEntry, 'total' | 'paid' | 'forgiven'>): 'due' | 'settled' {
  const r = remainingPaisa(entry)
  return r !== null && r > 0 ? 'due' : 'settled'
}

export function isOpen(status: KhataStatus): boolean {
  return status === 'booked' || status === 'due'
}

/** What one entry adds to its customer's / user's aggregates (amounts in paisa). */
export type Contribution = {
  duePaisa:  number
  dueCount:  number
  heldPaisa: number
  heldCount: number
  openCount: number
}

const ZERO: Contribution = { duePaisa: 0, dueCount: 0, heldPaisa: 0, heldCount: 0, openCount: 0 }

export function contributionOf(entry: KhataEntry | null): Contribution {
  if (!entry) return ZERO
  if (entry.status === 'due') {
    return {
      ...ZERO,
      duePaisa:  Math.max(0, remainingPaisa(entry) ?? 0),
      dueCount:  1,
      openCount: 1,
    }
  }
  if (entry.status === 'booked') {
    return { ...ZERO, heldPaisa: toPaisa(entry.paid), heldCount: 1, openCount: 1 }
  }
  return ZERO
}

function diff(a: Contribution, b: Contribution): Contribution {
  return {
    duePaisa:  b.duePaisa - a.duePaisa,
    dueCount:  b.dueCount - a.dueCount,
    heldPaisa: b.heldPaisa - a.heldPaisa,
    heldCount: b.heldCount - a.heldCount,
    openCount: b.openCount - a.openCount,
  }
}

function isZero(c: Contribution): boolean {
  return c.duePaisa === 0 && c.dueCount === 0 && c.heldPaisa === 0 && c.heldCount === 0 && c.openCount === 0
}

// ─── Aggregate rows ─────────────────────────────────────────────────────────

export function getKhataTotalsRow(ctx: ReadCtx, userId: Id<'users'>): Promise<Doc<'khataTotals'> | null> {
  return ctx.db
    .query('khataTotals')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
}

async function addToKhataTotals(ctx: MutationCtx, userId: Id<'users'>, d: Contribution): Promise<void> {
  const row = await getKhataTotalsRow(ctx, userId)
  const next = {
    dueTotal:  fromPaisa(toPaisa(row?.dueTotal) + d.duePaisa),
    dueCount:  (row?.dueCount ?? 0) + d.dueCount,
    heldTotal: fromPaisa(toPaisa(row?.heldTotal) + d.heldPaisa),
    heldCount: (row?.heldCount ?? 0) + d.heldCount,
  }
  if (row) await ctx.db.patch('khataTotals', row._id, next)
  else await ctx.db.insert('khataTotals', { userId, ...next })
}

async function applyToCustomer(
  ctx: MutationCtx,
  customerId: Id<'customers'>,
  d: Contribution,
  now: number,
): Promise<void> {
  const customer = await ctx.db.get('customers', customerId)
  if (!customer) return
  await ctx.db.patch('customers', customerId, {
    dueTotal:       fromPaisa(toPaisa(customer.dueTotal) + d.duePaisa),
    heldTotal:      fromPaisa(toPaisa(customer.heldTotal) + d.heldPaisa),
    openCount:      customer.openCount + d.openCount,
    lastActivityAt: Math.max(customer.lastActivityAt, now),
  })
}

/**
 * Aggregate hook for every khataEntries write: patches the customer
 * (balances + lastActivityAt) and khataTotals by the contribution diff.
 */
export async function onEntryChange(
  ctx: MutationCtx,
  before: KhataEntry | null,
  after: KhataEntry | null,
): Promise<void> {
  const entry = after ?? before
  if (!entry) return
  const d = diff(contributionOf(before), contributionOf(after))
  await applyToCustomer(ctx, entry.customerId, d, Date.now())
  if (!isZero(d)) await addToKhataTotals(ctx, entry.userId, d)
}

// ─── Entry write primitives (each fires onEntryChange) ──────────────────────

export type EntryPatch = Partial<Omit<KhataEntry, '_id' | '_creationTime' | 'userId' | 'customerId' | 'kind' | 'recognition' | 'createdAt'>>

export async function insertEntry(
  ctx: MutationCtx,
  fields: Omit<KhataEntry, '_id' | '_creationTime'>,
): Promise<Id<'khataEntries'>> {
  const id = await ctx.db.insert('khataEntries', fields)
  await onEntryChange(ctx, null, await ctx.db.get('khataEntries', id))
  return id
}

/** Patch an entry (always bumps updatedAt). Returns the entry after the write. */
export async function patchEntry(ctx: MutationCtx, before: KhataEntry, patch: EntryPatch): Promise<KhataEntry> {
  await ctx.db.patch('khataEntries', before._id, { ...patch, updatedAt: Date.now() })
  const after = await ctx.db.get('khataEntries', before._id)
  await onEntryChange(ctx, before, after)
  return after ?? before
}

export async function deleteEntry(ctx: MutationCtx, before: KhataEntry): Promise<void> {
  await ctx.db.delete('khataEntries', before._id)
  await onEntryChange(ctx, before, null)
}

// ─── Verify / rebuild (internal khata:verifyUser / khata:rebuildUser) ───────

/** Entries examined per user by verify/rebuild. */
export const KHATA_VERIFY_ENTRY_LIMIT = 5000
/** Payments examined per entry (≥ MAX_KHATA_PAYMENTS_PER_ENTRY + refunds). */
export const KHATA_VERIFY_PAYMENT_LIMIT = 250
/** Customers examined per user. */
export const KHATA_VERIFY_CUSTOMER_LIMIT = 5000
const MAX_REPORTED_MISMATCHES = 50

type EntryFix = { entry: KhataEntry; patch: Pick<KhataEntry, 'paid' | 'status' | 'total'> & { refunded?: number } }
type CustomerFix = { customer: Doc<'customers'>; dueTotal: number; heldTotal: number; openCount: number }
type TotalsValue = Pick<Doc<'khataTotals'>, 'dueTotal' | 'dueCount' | 'heldTotal' | 'heldCount'>

export type KhataCheck = {
  entriesChecked: number
  capped:         boolean
  mismatches:     string[]
  entryFixes:     EntryFix[]
  customerFixes:  CustomerFix[]
  totals:         { expected: TotalsValue; actual: TotalsValue | null; differs: boolean }
}

/**
 * Recompute every entry's paid / refunded / status (and a delivery-mode
 * total from its sale session) from source rows, then the customer and user
 * aggregates from the recomputed entries; compare with what is stored.
 */
export async function checkKhata(ctx: ReadCtx, userId: Id<'users'>): Promise<KhataCheck> {
  const mismatches: string[] = []
  const note = (m: string) => {
    if (mismatches.length < MAX_REPORTED_MISMATCHES) mismatches.push(m)
  }

  const rawEntries = await ctx.db
    .query('khataEntries')
    .withIndex('by_userId_status_openedAt', (q) => q.eq('userId', userId))
    .take(KHATA_VERIFY_ENTRY_LIMIT + 1)
  let capped = rawEntries.length > KHATA_VERIFY_ENTRY_LIMIT
  const entries = rawEntries.slice(0, KHATA_VERIFY_ENTRY_LIMIT)

  const entryFixes: EntryFix[] = []
  const byCustomer = new Map<Id<'customers'>, Contribution>()
  const sum: Contribution = { ...ZERO }

  for (const entry of entries) {
    const payments = await ctx.db
      .query('khataPayments')
      .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entry._id))
      .take(KHATA_VERIFY_PAYMENT_LIMIT + 1)
    if (payments.length > KHATA_VERIFY_PAYMENT_LIMIT) capped = true
    let paidP = 0
    let refundedP = 0
    for (const p of payments.slice(0, KHATA_VERIFY_PAYMENT_LIMIT)) {
      if (p.userId !== userId) continue
      if (p.kind === 'payment') paidP += toPaisa(p.amount)
      else refundedP += toPaisa(p.amount)
    }

    let total = entry.total
    const delivered = entry.status === 'due' || entry.status === 'settled'
    if (delivered && entry.recognition === 'delivery' && entry.saleSessionId !== undefined) {
      const session = await ctx.db.get('saleSessions', entry.saleSessionId)
      if (session && session.userId === userId) total = session.totalAmount
    }
    const paid = fromPaisa(paidP)
    const status: KhataStatus = delivered ? deliveredStatus({ total, paid, forgiven: entry.forgiven }) : entry.status
    const expectedEntry: KhataEntry = { ...entry, paid, status, total }
    const refunded = entry.status === 'cancelled' && entry.refunded !== undefined ? fromPaisa(refundedP) : entry.refunded

    const entryDiffers =
      toPaisa(entry.paid) !== paidP ||
      entry.status !== status ||
      (total !== undefined && toPaisa(entry.total) !== toPaisa(total)) ||
      toPaisa(entry.refunded) !== toPaisa(refunded)
    if (entryDiffers) {
      note(`entry ${entry._id}: paid ${entry.paid}→${paid}, status ${entry.status}→${status}, total ${entry.total}→${total}, refunded ${entry.refunded}→${refunded}`)
      entryFixes.push({ entry, patch: { paid, status, total, ...(refunded !== undefined ? { refunded } : {}) } })
    }

    const c = contributionOf(expectedEntry)
    const acc = byCustomer.get(entry.customerId) ?? { ...ZERO }
    for (const k of Object.keys(c) as (keyof Contribution)[]) {
      acc[k] += c[k]
      sum[k] += c[k]
    }
    byCustomer.set(entry.customerId, acc)
  }

  const rawCustomers = await ctx.db
    .query('customers')
    .withIndex('by_userId_normalizedName', (q) => q.eq('userId', userId))
    .take(KHATA_VERIFY_CUSTOMER_LIMIT + 1)
  if (rawCustomers.length > KHATA_VERIFY_CUSTOMER_LIMIT) capped = true
  const customerFixes: CustomerFix[] = []
  for (const customer of rawCustomers.slice(0, KHATA_VERIFY_CUSTOMER_LIMIT)) {
    const c = byCustomer.get(customer._id) ?? ZERO
    if (toPaisa(customer.dueTotal) !== c.duePaisa || toPaisa(customer.heldTotal) !== c.heldPaisa ||
      customer.openCount !== c.openCount) {
      note(`customer ${customer._id}: due ${customer.dueTotal}→${fromPaisa(c.duePaisa)}, held ${customer.heldTotal}→${fromPaisa(c.heldPaisa)}, open ${customer.openCount}→${c.openCount}`)
      customerFixes.push({
        customer, dueTotal: fromPaisa(c.duePaisa), heldTotal: fromPaisa(c.heldPaisa), openCount: c.openCount,
      })
    }
  }

  const row = await getKhataTotalsRow(ctx, userId)
  const expected: TotalsValue = {
    dueTotal: fromPaisa(sum.duePaisa), dueCount: sum.dueCount,
    heldTotal: fromPaisa(sum.heldPaisa), heldCount: sum.heldCount,
  }
  const actual: TotalsValue | null = row
    ? { dueTotal: row.dueTotal, dueCount: row.dueCount, heldTotal: row.heldTotal, heldCount: row.heldCount }
    : null
  const a = actual ?? { dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 }
  const differs = toPaisa(a.dueTotal) !== sum.duePaisa || a.dueCount !== sum.dueCount ||
    toPaisa(a.heldTotal) !== sum.heldPaisa || a.heldCount !== sum.heldCount
  if (differs) note(`khataTotals: ${JSON.stringify(actual)} → ${JSON.stringify(expected)}`)

  return {
    entriesChecked: entries.length,
    capped,
    mismatches,
    entryFixes,
    customerFixes,
    totals: { expected, actual, differs },
  }
}

/** Apply a checkKhata result (raw writes, no hooks: aggregates are set absolutely). */
export async function applyKhataFixes(
  ctx: MutationCtx,
  userId: Id<'users'>,
  check: KhataCheck,
): Promise<{ entriesFixed: number; customersFixed: number; totalsFixed: boolean }> {
  const now = Date.now()
  for (const { entry, patch } of check.entryFixes) {
    const closedAt = patch.status === 'settled' || patch.status === 'cancelled' ? (entry.closedAt ?? now) : undefined
    await ctx.db.patch('khataEntries', entry._id, { ...patch, closedAt, updatedAt: now })
  }
  // Partial scans would write wrong sums: only fix aggregates from a complete scan.
  if (check.capped) return { entriesFixed: check.entryFixes.length, customersFixed: 0, totalsFixed: false }
  for (const fix of check.customerFixes) {
    await ctx.db.patch('customers', fix.customer._id, {
      dueTotal: fix.dueTotal, heldTotal: fix.heldTotal, openCount: fix.openCount,
    })
  }
  if (check.totals.differs) {
    const row = await getKhataTotalsRow(ctx, userId)
    if (row) await ctx.db.patch('khataTotals', row._id, check.totals.expected)
    else await ctx.db.insert('khataTotals', { userId, ...check.totals.expected })
  }
  return {
    entriesFixed:   check.entryFixes.length,
    customersFixed: check.customerFixes.length,
    totalsFixed:    check.totals.differs,
  }
}
