/**
 * Advance & Udhaar (Khata) write logic.
 *
 * Accounting (see docs/convex-v2-rollout.md §8): every effect on sales goes
 * through model/sales (recordSaleSession / updateSaleItem /
 * removeSessionWithItems) and on expenses through model/expenses, so the
 * summary tables (dailyTotals / userTotals / categoryStats) are maintained by
 * their normal hooks. Entry balances are stored and patched with every change
 * via model/khataBalance (customers + khataTotals in the same mutation).
 *
 * Each entry freezes its `recognition` at creation:
 *  - 'delivery': the full bill is a sale on the sale / handover day
 *    (delivery link); payments create no sales.
 *  - 'cash': each payment received is a 1-item sale on its day (payment link).
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { KHATA_MESSAGES, notFoundError, validationError } from '../lib/errors'
import {
  KHATA_ITEM_LABEL_MAX,
  MAX_KHATA_PAYMENTS_PER_ENTRY,
  NOTE_MAX,
  PRODUCT_NAME_MAX,
} from '../lib/limits'
import { assertOwnedCategory, getOwned, requireOwned } from '../lib/ownership'
import { dateKeyInTimeZone, zonedStartOfDayMs } from '../lib/time'
import {
  assertClientRequestId,
  assertDueDate,
  assertEntryDate,
  assertItemCount,
  assertMoney,
  assertMoneyOrZero,
  customerNameKey,
  normalizeCustomerName,
  normalizeOptionalText,
  normalizePhone,
  normalizeRequiredText,
} from '../lib/validation'
import { recordExpense, removeExpense } from './expenses'
import { assertAppliedKind, findApplied, recordApplied } from './idempotency'
import {
  deleteEntry,
  deliveredStatus,
  formatPkr,
  fromPaisa,
  insertEntry,
  patchEntry,
  remainingOf,
  remainingPaisa,
  toPaisa,
  type EntryPatch,
  type KhataEntry,
  type KhataStatus,
} from './khataBalance'
import { deleteSessionLinks, insertLink } from './khataLinks'
import {
  getSessionWithItems,
  recordSaleSession,
  removeSessionWithItems,
  updateSaleItem,
  type SaleItemInput,
} from './sales'
import { getShopSettings, type Recognition } from './settings'
import { preferredBucketTimeZone } from './totals'

// ─── Shared helpers ─────────────────────────────────────────────────────────

export type CustomerInput = { id: Id<'customers'> } | { name: string; phone?: string }

type ValidCustomerInput =
  | { kind: 'id'; id: Id<'customers'> }
  | { kind: 'name'; name: string; key: string; phone: string | undefined }

/**
 * Validate an optional customer reference without writing (name/phone
 * normalised). No customer, or a name that is blank after trimming → null
 * (a nameless record; a phone without a name is dropped).
 */
function validateCustomerInput(input: CustomerInput | null | undefined): ValidCustomerInput | null {
  if (input === null || input === undefined) return null
  if ('id' in input) return { kind: 'id', id: input.id }
  if (input.name.trim().length === 0) return null
  const name = normalizeCustomerName(input.name)
  return { kind: 'name', name, key: customerNameKey(name), phone: normalizePhone(input.phone) }
}

export async function findCustomerByKey(
  ctx: MutationCtx,
  userId: Id<'users'>,
  key: string,
): Promise<Doc<'customers'> | null> {
  return ctx.db
    .query('customers')
    .withIndex('by_userId_normalizedName', (q) => q.eq('userId', userId).eq('normalizedName', key))
    .first()
}

/**
 * Existing customer by id (must be the user's) or find-or-create by exact
 * normalized name (phone added only when missing). An archived customer is
 * un-archived because it gets a new record.
 */
async function resolveCustomer(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: ValidCustomerInput | null,
  now: number,
): Promise<Doc<'customers'> | null> {
  if (input === null) return null
  let customer: Doc<'customers'> | null
  if (input.kind === 'id') {
    customer = await requireOwned(ctx, 'customers', input.id, userId, KHATA_MESSAGES.CUSTOMER_NOT_FOUND)
  } else {
    customer = await findCustomerByKey(ctx, userId, input.key)
    if (!customer) {
      const id = await ctx.db.insert('customers', {
        userId,
        name:           input.name,
        normalizedName: input.key,
        phone:          input.phone,
        dueTotal:       0,
        heldTotal:      0,
        openCount:      0,
        lastActivityAt: now,
        createdAt:      now,
      })
      return (await ctx.db.get('customers', id))!
    }
    if (customer.phone === undefined && input.phone !== undefined) {
      await ctx.db.patch('customers', customer._id, { phone: input.phone })
    }
  }
  if (customer.archivedAt !== undefined) {
    await ctx.db.patch('customers', customer._id, { archivedAt: undefined })
  }
  return (await ctx.db.get('customers', customer._id))!
}

async function requireEntry(
  ctx: MutationCtx,
  userId: Id<'users'>,
  entryId: Id<'khataEntries'>,
): Promise<KhataEntry> {
  return requireOwned(ctx, 'khataEntries', entryId, userId, KHATA_MESSAGES.ENTRY_NOT_FOUND)
}

/** The entry's customer, or null for a nameless entry (or a customer row that is gone). */
async function customerOf(ctx: MutationCtx, entry: KhataEntry): Promise<Doc<'customers'> | null> {
  if (entry.customerId === undefined) return null
  const customer = await ctx.db.get('customers', entry.customerId)
  return customer && customer.userId === entry.userId ? customer : null
}

/** "Ali · Udhaar" for a named record, "Udhaar" for a nameless one. */
function labelWithName(customer: Doc<'customers'> | null, label: string): string {
  return customer ? `${customer.name} · ${label}` : label
}

/** Dates of payments / handover / cancel may not be before the entry's opening day. */
function assertNotBeforeOpened(ms: number, entry: KhataEntry, user: Doc<'users'>): void {
  const tz = preferredBucketTimeZone(user)
  const dayStart = zonedStartOfDayMs(dateKeyInTimeZone(entry.openedAt, tz), tz)
  if (Number.isFinite(dayStart) && ms < dayStart) throw validationError(KHATA_MESSAGES.BEFORE_OPENED)
}

async function assertPaymentRoom(ctx: MutationCtx, entryId: Id<'khataEntries'>): Promise<void> {
  const rows = await ctx.db
    .query('khataPayments')
    .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entryId))
    .take(MAX_KHATA_PAYMENTS_PER_ENTRY)
  if (rows.length >= MAX_KHATA_PAYMENTS_PER_ENTRY) throw validationError(KHATA_MESSAGES.TOO_MANY_PAYMENTS)
}

function moreThanBaqi(remainingP: number): never {
  throw validationError(`More than Baqi (${formatPkr(fromPaisa(Math.max(0, remainingP)))})`)
}

/** entry.categoryId when it still belongs to the user (deleted categories are dropped lazily). */
async function liveCategory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'> | undefined,
): Promise<Id<'categories'> | undefined> {
  if (categoryId === undefined) return undefined
  return (await getOwned(ctx, 'categories', categoryId, userId)) ? categoryId : undefined
}

function cashSessionName(entry: Pick<KhataEntry, 'kind'>, customer: Doc<'customers'> | null): string {
  return labelWithName(customer, entry.kind === 'udhaar' ? 'Udhaar' : 'Advance')
}

/** One sale session (1 item) linked to an entry. Goes through recordSaleSession (totals hooks). */
async function createLinkedSession(
  ctx: MutationCtx,
  userId: Id<'users'>,
  link: { entryId: Id<'khataEntries'>; role: 'delivery' | 'payment'; paymentId?: Id<'khataPayments'> },
  item: SaleItemInput,
  sessionDate: number,
): Promise<Id<'saleSessions'>> {
  const { sessionId } = await recordSaleSession(ctx, userId, { items: [item], sessionDate })
  await insertLink(ctx, {
    userId,
    saleSessionId: sessionId,
    sessionDate,
    entryId:       link.entryId,
    paymentId:     link.paymentId,
    role:          link.role,
  })
  return sessionId
}

/**
 * Insert a 'payment' row for an entry; in cash mode also its 1-item sale
 * session + payment link. Does NOT patch entry.paid (callers do).
 */
async function insertPayment(
  ctx: MutationCtx,
  entry: KhataEntry,
  customer: Doc<'customers'> | null,
  amount: number,
  receivedAt: number,
): Promise<{ paymentId: Id<'khataPayments'>; sessionId?: Id<'saleSessions'> }> {
  const paymentId = await ctx.db.insert('khataPayments', {
    userId:     entry.userId,
    entryId:    entry._id,
    customerId: entry.customerId,
    kind:       'payment',
    amount,
    receivedAt,
    createdAt:  Date.now(),
  })
  if (entry.recognition !== 'cash') return { paymentId }
  const sessionId = await createLinkedSession(
    ctx,
    entry.userId,
    { entryId: entry._id, role: 'payment', paymentId },
    {
      productName: cashSessionName(entry, customer),
      amount,
      categoryId:  await liveCategory(ctx, entry.userId, entry.categoryId),
    },
    receivedAt,
  )
  await ctx.db.patch('khataPayments', paymentId, { saleSessionId: sessionId })
  return { paymentId, sessionId }
}

/** Delete one of the user's khata sessions with its items and links (hooks fire). */
async function removeKhataSession(
  ctx: MutationCtx,
  userId: Id<'users'>,
  sessionId: Id<'saleSessions'>,
): Promise<void> {
  await deleteSessionLinks(ctx, userId, sessionId)
  await removeSessionWithItems(ctx, userId, sessionId)
}

function addMoney(a: number, b: number): number {
  return fromPaisa(toPaisa(a) + toPaisa(b))
}

function closedAtFor(status: KhataStatus, entry: KhataEntry, now: number): number | undefined {
  return status === 'settled' || status === 'cancelled' ? (entry.closedAt ?? now) : undefined
}

function labelForItems(items: { productName: string }[]): string | undefined {
  const first = items[0]
  if (!first) return undefined
  const label = items.length === 1 ? first.productName : `${first.productName} +${items.length - 1}`
  return label.slice(0, KHATA_ITEM_LABEL_MAX)
}

// ─── recordSale (Udhaar) ────────────────────────────────────────────────────

export type RecordKhataSaleInput = {
  /** Optional: no customer / blank name → nameless record. */
  customer?:        CustomerInput | null
  items:            SaleItemInput[]
  sessionDate:      number
  receivedNow:      number
  recognition?:     Recognition
  clientRequestId?: string
}

export type RecordKhataSaleResult = {
  entryId:    Id<'khataEntries'>
  sessionId?: Id<'saleSessions'>
  remaining:  number
}

/** A sale where the customer paid less than the bill (0 ≤ receivedNow < total). */
export async function recordKhataSale(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: RecordKhataSaleInput,
): Promise<RecordKhataSaleResult> {
  const userId = user._id
  const clientRequestId =
    input.clientRequestId === undefined ? undefined : assertClientRequestId(input.clientRequestId)
  if (clientRequestId !== undefined) {
    const applied = await findApplied(ctx, userId, clientRequestId)
    if (applied) {
      assertAppliedKind(applied, 'khataSale')
      return {
        entryId:   applied.khataEntryId as Id<'khataEntries'>,
        ...(applied.sessionId !== undefined ? { sessionId: applied.sessionId } : {}),
        remaining: applied.khataRemaining ?? 0,
      }
    }
  }

  // Validate everything before the first write.
  assertItemCount(input.items.length)
  const sessionDate = assertEntryDate(input.sessionDate, 'Sale date')
  const checked = new Set<Id<'categories'>>()
  const items: SaleItemInput[] = []
  for (const item of input.items) {
    const amount = assertMoney(item.amount)
    const productName = normalizeRequiredText(item.productName, 'Product name', PRODUCT_NAME_MAX)
    const note = normalizeOptionalText(item.note, 'Note', NOTE_MAX)
    if (item.categoryId !== undefined && !checked.has(item.categoryId)) {
      await assertOwnedCategory(ctx, item.categoryId, userId)
      checked.add(item.categoryId)
    }
    items.push({ productName, amount, categoryId: item.categoryId, note })
  }
  const totalP = items.reduce((sum, i) => sum + toPaisa(i.amount), 0)
  const receivedNow = assertMoneyOrZero(input.receivedNow, 'Received amount')
  if (toPaisa(receivedNow) >= totalP) throw validationError(KHATA_MESSAGES.FULLY_PAID)
  const customerInput = validateCustomerInput(input.customer)
  const recognition = input.recognition ?? (await getShopSettings(ctx, userId)).udhaarRecognition

  const now = Date.now()
  const customer = await resolveCustomer(ctx, userId, customerInput, now)
  const total = fromPaisa(totalP)
  const firstCategory = items[0]?.categoryId
  const sharedCategory =
    firstCategory !== undefined && items.every((i) => i.categoryId === firstCategory) ? firstCategory : undefined

  let deliverySessionId: Id<'saleSessions'> | undefined
  if (recognition === 'delivery') {
    deliverySessionId = (await recordSaleSession(ctx, userId, { items, sessionDate })).sessionId
  }

  const entryId = await insertEntry(ctx, {
    userId,
    customerId:  customer?._id,
    kind:        'udhaar',
    status:      'due',
    recognition,
    total,
    paid:        receivedNow,
    itemLabel:   labelForItems(items),
    items:       recognition === 'cash'
      ? items.map((i) => ({ productName: i.productName, amount: i.amount, categoryId: i.categoryId }))
      : undefined,
    categoryId:  sharedCategory,
    openedAt:    sessionDate,
    deliveredAt: sessionDate,
    saleSessionId: deliverySessionId,
    createdAt:   now,
    updatedAt:   now,
  })
  const entry = (await ctx.db.get('khataEntries', entryId))!

  let sessionId = deliverySessionId
  if (deliverySessionId !== undefined) {
    await insertLink(ctx, {
      userId, saleSessionId: deliverySessionId, sessionDate, entryId, role: 'delivery',
    })
  }
  if (receivedNow > 0) {
    const payment = await insertPayment(ctx, entry, customer, receivedNow, sessionDate)
    sessionId ??= payment.sessionId
  }

  const remaining = fromPaisa(totalP - toPaisa(receivedNow))
  if (clientRequestId !== undefined) {
    await recordApplied(ctx, {
      userId,
      clientRequestId,
      kind:           'khataSale',
      khataEntryId:   entryId,
      sessionId,
      totalAmount:    total,
      itemCount:      items.length,
      khataRemaining: remaining,
    })
  }
  return { entryId, ...(sessionId !== undefined ? { sessionId } : {}), remaining }
}

// ─── openAdvance ────────────────────────────────────────────────────────────

export type OpenAdvanceInput = {
  /** Optional: no customer / blank name → nameless record. */
  customer?:        CustomerInput | null
  amount:           number
  receivedAt:       number
  total?:           number
  itemLabel?:       string
  dueDate?:         number
  note?:            string
  recognition?:     Recognition
  clientRequestId?: string
}

/** Money received before handover (a booking). Status 'booked'. */
export async function openAdvance(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: OpenAdvanceInput,
): Promise<{ entryId: Id<'khataEntries'> }> {
  const userId = user._id
  const clientRequestId =
    input.clientRequestId === undefined ? undefined : assertClientRequestId(input.clientRequestId)
  if (clientRequestId !== undefined) {
    const applied = await findApplied(ctx, userId, clientRequestId)
    if (applied) {
      assertAppliedKind(applied, 'khataAdvance')
      return { entryId: applied.khataEntryId as Id<'khataEntries'> }
    }
  }

  const amount = assertMoney(input.amount, 'Advance amount')
  const receivedAt = assertEntryDate(input.receivedAt, 'Date')
  const total = input.total === undefined ? undefined : assertMoney(input.total, 'Total')
  if (total !== undefined && toPaisa(amount) > toPaisa(total)) {
    throw validationError(`Advance can't be more than the total (${formatPkr(total)})`)
  }
  const itemLabel = normalizeOptionalText(input.itemLabel, 'Item', KHATA_ITEM_LABEL_MAX)
  const note = normalizeOptionalText(input.note, 'Note', NOTE_MAX)
  const dueDate = input.dueDate === undefined ? undefined : assertDueDate(input.dueDate)
  const customerInput = validateCustomerInput(input.customer)
  const recognition = input.recognition ?? (await getShopSettings(ctx, userId)).advanceRecognition

  const now = Date.now()
  const customer = await resolveCustomer(ctx, userId, customerInput, now)
  const entryId = await insertEntry(ctx, {
    userId,
    customerId: customer?._id,
    kind:       'advance',
    status:     'booked',
    recognition,
    total,
    paid:       amount,
    itemLabel,
    note,
    openedAt:   receivedAt,
    dueDate,
    createdAt:  now,
    updatedAt:  now,
  })
  const entry = (await ctx.db.get('khataEntries', entryId))!
  await insertPayment(ctx, entry, customer, amount, receivedAt)

  if (clientRequestId !== undefined) {
    await recordApplied(ctx, {
      userId,
      clientRequestId,
      kind:         'khataAdvance',
      khataEntryId: entryId,
      totalAmount:  amount,
      itemCount:    1,
    })
  }
  return { entryId }
}

// ─── receivePayment ─────────────────────────────────────────────────────────

export type ReceivePaymentInput = {
  entryId:          Id<'khataEntries'>
  amount:           number
  receivedAt:       number
  clientRequestId?: string
}

export type ReceivePaymentResult = {
  paymentId: Id<'khataPayments'>
  remaining: number | null
  status:    KhataStatus
}

/** Money received on an open entry ('booked' advance or 'due' Udhaar / completed order). */
export async function receivePayment(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: ReceivePaymentInput,
): Promise<ReceivePaymentResult> {
  const userId = user._id
  const clientRequestId =
    input.clientRequestId === undefined ? undefined : assertClientRequestId(input.clientRequestId)
  if (clientRequestId !== undefined) {
    const applied = await findApplied(ctx, userId, clientRequestId)
    if (applied) {
      assertAppliedKind(applied, 'khataPayment')
      return {
        paymentId: applied.khataPaymentId as Id<'khataPayments'>,
        remaining: applied.khataRemaining ?? null,
        status:    applied.khataStatus ?? 'due',
      }
    }
  }

  const entry = await requireEntry(ctx, userId, input.entryId)
  if (entry.status === 'cancelled') throw notFoundError(KHATA_MESSAGES.ENTRY_CANCELLED)
  if (entry.status === 'settled') throw validationError(KHATA_MESSAGES.ALREADY_PAID)
  const amount = assertMoney(input.amount, 'Payment amount')
  const receivedAt = assertEntryDate(input.receivedAt, 'Date')
  assertNotBeforeOpened(receivedAt, entry, user)
  const remainingP = remainingPaisa(entry)
  if (remainingP !== null && toPaisa(amount) > remainingP) moreThanBaqi(remainingP)
  await assertPaymentRoom(ctx, entry._id)

  const customer = await customerOf(ctx, entry)
  const { paymentId } = await insertPayment(ctx, entry, customer, amount, receivedAt)
  const paid = addMoney(entry.paid, amount)
  const status: KhataStatus =
    entry.status === 'booked' ? 'booked' : deliveredStatus({ total: entry.total, paid, forgiven: entry.forgiven })
  const after = await patchEntry(ctx, entry, {
    paid,
    status,
    closedAt: closedAtFor(status, entry, Date.now()),
  })
  const remaining = remainingOf(after)

  if (clientRequestId !== undefined) {
    await recordApplied(ctx, {
      userId,
      clientRequestId,
      kind:           'khataPayment',
      khataEntryId:   entry._id,
      khataPaymentId: paymentId,
      totalAmount:    amount,
      itemCount:      1,
      khataRemaining: remaining ?? undefined,
      khataStatus:    status,
    })
  }
  return { paymentId, remaining, status }
}

// ─── completeAdvance ────────────────────────────────────────────────────────

export type CompleteAdvanceInput = {
  entryId:     Id<'khataEntries'>
  finalTotal:  number
  receivedNow: number
  deliveredAt: number
  categoryId?: Id<'categories'>
}

export type CompleteAdvanceResult = {
  status:     KhataStatus
  remaining:  number
  sessionId?: Id<'saleSessions'>
}

/** Handover of a booked order: bill = finalTotal, receivedNow paid at handover. */
export async function completeAdvance(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: CompleteAdvanceInput,
): Promise<CompleteAdvanceResult> {
  const userId = user._id
  const entry = await requireEntry(ctx, userId, input.entryId)
  if (entry.status !== 'booked') throw validationError(KHATA_MESSAGES.NOT_BOOKED)
  const finalTotal = assertMoney(input.finalTotal, 'Bill')
  if (toPaisa(finalTotal) < toPaisa(entry.paid)) throw validationError(KHATA_MESSAGES.BILL_BELOW_ADVANCE)
  const receivedNow = assertMoneyOrZero(input.receivedNow, 'Received amount')
  const leftP = toPaisa(finalTotal) - toPaisa(entry.paid)
  if (toPaisa(receivedNow) > leftP) moreThanBaqi(leftP)
  const deliveredAt = assertEntryDate(input.deliveredAt, 'Date')
  assertNotBeforeOpened(deliveredAt, entry, user)
  if (input.categoryId !== undefined) await assertOwnedCategory(ctx, input.categoryId, userId)
  if (receivedNow > 0) await assertPaymentRoom(ctx, entry._id)
  const categoryId = input.categoryId ?? (await liveCategory(ctx, userId, entry.categoryId))
  const customer = await customerOf(ctx, entry)

  let deliverySessionId: Id<'saleSessions'> | undefined
  if (entry.recognition === 'delivery') {
    deliverySessionId = await createLinkedSession(
      ctx,
      userId,
      { entryId: entry._id, role: 'delivery' },
      { productName: entry.itemLabel ?? labelWithName(customer, 'Order'), amount: finalTotal, categoryId },
      deliveredAt,
    )
  }
  // Payment rows / cash sessions use the entry with its new category.
  const forPayment: KhataEntry = { ...entry, categoryId }
  let paymentSessionId: Id<'saleSessions'> | undefined
  if (receivedNow > 0) {
    paymentSessionId = (await insertPayment(ctx, forPayment, customer, receivedNow, deliveredAt)).sessionId
  }

  const paid = addMoney(entry.paid, receivedNow)
  const status = deliveredStatus({ total: finalTotal, paid, forgiven: entry.forgiven })
  const after = await patchEntry(ctx, entry, {
    total:         finalTotal,
    paid,
    status,
    deliveredAt,
    categoryId,
    saleSessionId: deliverySessionId,
    closedAt:      closedAtFor(status, entry, Date.now()),
  })
  const sessionId = deliverySessionId ?? paymentSessionId
  return { status, remaining: remainingOf(after) ?? 0, ...(sessionId !== undefined ? { sessionId } : {}) }
}

// ─── cancelAdvance ──────────────────────────────────────────────────────────

/**
 * Cancel a booked advance.
 *  - refund: a 'refund' row of everything paid (cash mode: plus an expense
 *    "Advance refund · Ali" on `at`, offsetting the payment sales).
 *  - keep (refund false): delivery mode books the kept money as a sale
 *    "Advance kept · Ali" on `at`; cash mode changes nothing in sales.
 */
export async function cancelAdvance(
  ctx: MutationCtx,
  user: Doc<'users'>,
  input: { entryId: Id<'khataEntries'>; refund: boolean; at: number },
): Promise<void> {
  const userId = user._id
  const entry = await requireEntry(ctx, userId, input.entryId)
  if (entry.status !== 'booked') throw validationError(KHATA_MESSAGES.NOT_BOOKED)
  const at = assertEntryDate(input.at, 'Date')
  assertNotBeforeOpened(at, entry, user)
  const customer = await customerOf(ctx, entry)
  const now = Date.now()
  const paid = entry.paid
  const patch: EntryPatch = { status: 'cancelled', closedAt: now }

  if (input.refund) {
    if (paid > 0) {
      let expenseId: Id<'expenses'> | undefined
      if (entry.recognition === 'cash') {
        expenseId = (await recordExpense(ctx, userId, {
          amount:      paid,
          expenseDate: at,
          note:        (customer ? `Advance refund · ${customer.name}` : 'Advance refund').slice(0, NOTE_MAX),
        })).expenseId
      }
      await ctx.db.insert('khataPayments', {
        userId,
        entryId:    entry._id,
        customerId: entry.customerId,
        kind:       'refund',
        amount:     paid,
        receivedAt: at,
        expenseId,
        createdAt:  now,
      })
    }
    patch.refunded = paid
  } else if (entry.recognition === 'delivery' && paid > 0) {
    patch.saleSessionId = await createLinkedSession(
      ctx,
      userId,
      { entryId: entry._id, role: 'delivery' },
      {
        productName: customer ? `Advance kept · ${customer.name}` : 'Advance kept',
        amount:      paid,
        categoryId:  await liveCategory(ctx, userId, entry.categoryId),
      },
      at,
    )
  }
  await patchEntry(ctx, entry, patch)
}

// ─── forgiveRemaining ───────────────────────────────────────────────────────

/** Write off what is left of a due entry. Sales are untouched. */
export async function forgiveRemaining(
  ctx: MutationCtx,
  userId: Id<'users'>,
  entryId: Id<'khataEntries'>,
): Promise<{ forgiven: number }> {
  const entry = await requireEntry(ctx, userId, entryId)
  const remainingP = remainingPaisa(entry)
  if (entry.status !== 'due' || remainingP === null || remainingP <= 0) {
    throw validationError(KHATA_MESSAGES.NOT_DUE)
  }
  await patchEntry(ctx, entry, {
    forgiven: fromPaisa(toPaisa(entry.forgiven) + remainingP),
    status:   'settled',
    closedAt: Date.now(),
  })
  return { forgiven: fromPaisa(remainingP) }
}

// ─── updateEntry ────────────────────────────────────────────────────────────

export type UpdateEntryInput = {
  entryId:    Id<'khataEntries'>
  total?:     number
  itemLabel?: string
  note?:      string
  /** null clears the due date. */
  dueDate?:   number | null
}

/**
 * Edit total / label / note / due date. Only changed fields are validated.
 * A delivered entry's total must stay ≥ paid + forgiven; its delivery sale
 * session is updated too when it has exactly one item (multi-item →
 * "Edit the items in the sale").
 */
export async function updateEntry(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: UpdateEntryInput,
): Promise<void> {
  const entry = await requireEntry(ctx, userId, input.entryId)
  const patch: EntryPatch = {}

  let labelChanged = false
  if (input.itemLabel !== undefined && input.itemLabel.trim() !== (entry.itemLabel ?? '')) {
    patch.itemLabel = normalizeOptionalText(input.itemLabel, 'Item', KHATA_ITEM_LABEL_MAX)
    labelChanged = true
  }
  if (input.note !== undefined && input.note.trim() !== (entry.note ?? '')) {
    patch.note = normalizeOptionalText(input.note, 'Note', NOTE_MAX)
  }
  if (input.dueDate !== undefined && input.dueDate !== (entry.dueDate ?? null)) {
    patch.dueDate = input.dueDate === null ? undefined : assertDueDate(input.dueDate)
  }

  const totalChanged = input.total !== undefined &&
    (entry.total === undefined || toPaisa(input.total) !== toPaisa(entry.total) || !Number.isFinite(input.total))
  if (totalChanged) {
    if (entry.status === 'cancelled') throw validationError(KHATA_MESSAGES.ENTRY_CLOSED)
    const total = assertMoney(input.total as number, 'Total')
    if (entry.status === 'booked') {
      if (toPaisa(total) < toPaisa(entry.paid)) throw validationError(KHATA_MESSAGES.BILL_BELOW_ADVANCE)
    } else {
      const floor = toPaisa(entry.paid) + toPaisa(entry.forgiven)
      if (toPaisa(total) < floor) throw validationError(`Bill can't be less than paid (${formatPkr(fromPaisa(floor))})`)
      patch.status = deliveredStatus({ total, paid: entry.paid, forgiven: entry.forgiven })
      patch.closedAt = closedAtFor(patch.status, entry, Date.now())
    }
    patch.total = total
  }

  const delivered = entry.status === 'due' || entry.status === 'settled'
  if (delivered && entry.saleSessionId !== undefined && (totalChanged || labelChanged)) {
    const found = await getSessionWithItems(ctx, userId, entry.saleSessionId)
    const only = found && found.items.length === 1 ? found.items[0] : undefined
    if (found && !only && totalChanged) throw validationError(KHATA_MESSAGES.EDIT_ITEMS_IN_SALE)
    if (only) {
      await updateSaleItem(
        ctx,
        userId,
        {
          saleId:      only._id,
          productName: labelChanged && patch.itemLabel !== undefined ? patch.itemLabel : only.productName,
          amount:      patch.total ?? only.amount,
          categoryId:  only.categoryId,
          note:        only.note,
        },
        { skipKhataGuard: true },
      )
    }
  }

  if (Object.keys(patch).length > 0) await patchEntry(ctx, entry, patch)
}

// ─── removePayment / removeEntry ────────────────────────────────────────────

/** Delete a payment (cash mode: also its sale session). A settled entry becomes due again. */
export async function removePayment(
  ctx: MutationCtx,
  userId: Id<'users'>,
  paymentId: Id<'khataPayments'>,
): Promise<void> {
  const payment = await requireOwned(ctx, 'khataPayments', paymentId, userId, KHATA_MESSAGES.PAYMENT_NOT_FOUND)
  const entry = await getOwned(ctx, 'khataEntries', payment.entryId, userId)
  if (entry && entry.status === 'cancelled') throw validationError(KHATA_MESSAGES.ENTRY_CLOSED)
  if (payment.kind !== 'payment') throw validationError(KHATA_MESSAGES.ENTRY_CLOSED)

  if (payment.saleSessionId !== undefined) await removeKhataSession(ctx, userId, payment.saleSessionId)
  await ctx.db.delete('khataPayments', payment._id)
  if (!entry) return

  const paid = fromPaisa(Math.max(0, toPaisa(entry.paid) - toPaisa(payment.amount)))
  const status: KhataStatus =
    entry.status === 'booked' ? 'booked' : deliveredStatus({ total: entry.total, paid, forgiven: entry.forgiven })
  await patchEntry(ctx, entry, { paid, status, closedAt: closedAtFor(status, entry, Date.now()) })
}

/** Max payments removed with an entry (≥ MAX_KHATA_PAYMENTS_PER_ENTRY + refunds). */
const ENTRY_PAYMENTS_DELETE_LIMIT = MAX_KHATA_PAYMENTS_PER_ENTRY + 50

/** "Added by mistake": delete the entry, its payments, linked sessions/expenses and links. */
export async function removeEntry(
  ctx: MutationCtx,
  userId: Id<'users'>,
  entryId: Id<'khataEntries'>,
): Promise<void> {
  const entry = await requireEntry(ctx, userId, entryId)
  const payments = await ctx.db
    .query('khataPayments')
    .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entry._id))
    .take(ENTRY_PAYMENTS_DELETE_LIMIT)
  for (const payment of payments) {
    if (payment.userId !== userId) continue
    if (payment.saleSessionId !== undefined) await removeKhataSession(ctx, userId, payment.saleSessionId)
    if (payment.expenseId !== undefined && (await getOwned(ctx, 'expenses', payment.expenseId, userId))) {
      await removeExpense(ctx, userId, payment.expenseId)
    }
    await ctx.db.delete('khataPayments', payment._id)
  }
  if (entry.saleSessionId !== undefined) await removeKhataSession(ctx, userId, entry.saleSessionId)
  await deleteEntry(ctx, entry)
}

// ─── setEntryCustomer ───────────────────────────────────────────────────────

/** Payments rewritten when an entry changes customer (≥ cap + refunds). */
const ENTRY_PAYMENTS_MOVE_LIMIT = MAX_KHATA_PAYMENTS_PER_ENTRY + 50

/**
 * Attach a customer to an entry (find-or-create by name, or by id), move it
 * to another customer, or detach it (null / blank name). Works on closed
 * entries too (history only). The entry's open balance moves between the
 * customers' aggregates (onEntryChange); khataTotals is unchanged. Sale names
 * already written ("Ali · Udhaar") are not renamed.
 */
export async function setEntryCustomer(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: { entryId: Id<'khataEntries'>; customer: CustomerInput | null },
): Promise<{ customerId: Id<'customers'> | null }> {
  const entry = await requireEntry(ctx, userId, input.entryId)
  const customerInput = validateCustomerInput(input.customer)
  const customer = await resolveCustomer(ctx, userId, customerInput, Date.now())
  const customerId = customer?._id
  if (customerId === entry.customerId) return { customerId: customerId ?? null }

  await patchEntry(ctx, entry, { customerId })
  const payments = await ctx.db
    .query('khataPayments')
    .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entry._id))
    .take(ENTRY_PAYMENTS_MOVE_LIMIT)
  for (const payment of payments) {
    if (payment.userId === userId) await ctx.db.patch('khataPayments', payment._id, { customerId })
  }
  return { customerId: customerId ?? null }
}

// ─── Customers ──────────────────────────────────────────────────────────────

/** Rename / change phone ('' clears it). Names stay unique per shop (normalized). */
export async function updateCustomer(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: { customerId: Id<'customers'>; name?: string; phone?: string },
): Promise<void> {
  const customer = await requireOwned(ctx, 'customers', input.customerId, userId, KHATA_MESSAGES.CUSTOMER_NOT_FOUND)
  const patch: Partial<Pick<Doc<'customers'>, 'name' | 'normalizedName' | 'phone'>> = {}
  if (input.name !== undefined && input.name.trim().replace(/\s+/g, ' ') !== customer.name) {
    const name = normalizeCustomerName(input.name)
    const key = customerNameKey(name)
    if (key !== customer.normalizedName) {
      const other = await findCustomerByKey(ctx, userId, key)
      if (other && other._id !== customer._id) throw validationError(KHATA_MESSAGES.CUSTOMER_EXISTS)
    }
    patch.name = name
    patch.normalizedName = key
  }
  if (input.phone !== undefined) {
    const compact = input.phone.replace(/[\s\-().]/g, '')
    if (compact !== (customer.phone ?? '')) patch.phone = normalizePhone(input.phone)
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch('customers', customer._id, patch)
}

/** Hide a customer from pickers. Blocked while they have open records. */
export async function archiveCustomer(
  ctx: MutationCtx,
  userId: Id<'users'>,
  customerId: Id<'customers'>,
): Promise<void> {
  const customer = await requireOwned(ctx, 'customers', customerId, userId, KHATA_MESSAGES.CUSTOMER_NOT_FOUND)
  if (customer.openCount > 0) {
    throw validationError(
      customer.dueTotal > 0
        ? `${customer.name} still has Baqi ${formatPkr(customer.dueTotal)}`
        : `${customer.name} still has an advance of ${formatPkr(customer.heldTotal)}`,
    )
  }
  if (customer.archivedAt === undefined) {
    await ctx.db.patch('customers', customer._id, { archivedAt: Date.now() })
  }
}
