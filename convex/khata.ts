/**
 * Advance & Udhaar (Khata) public API + internal repair.
 *
 * Queries work for every user (view-as included) and return empty / zero
 * results for shops without khata data; the client mounts them only when
 * `settings.get().khataEnabled`. Mutations act on the caller's own data only
 * and work regardless of the setting (queued offline writes still apply).
 *
 *   npx convex run khata:verifyUser '{"userId":"<usersId>"}'
 *   npx convex run khata:rebuildUser '{"userId":"<usersId>"}'
 */
import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { internalMutation, internalQuery } from './_generated/server'
import { authedMutation, authedQuery } from './lib/functions'
import { CUSTOMER_SEARCH_MAX } from './lib/limits'
import { getOwned } from './lib/ownership'
import {
  customerDoc,
  khataBadge,
  khataDetailEntry,
  khataEntryDetail,
  khataOpenRow,
  khataStatusValidator,
  khataTotalsValue,
  paginated,
  recognitionValidator,
} from './lib/returnValidators'
import { customerNameKey } from './lib/validation'
import {
  applyKhataFixes,
  checkKhata,
  getKhataTotalsRow,
  remainingOf,
} from './model/khataBalance'
import {
  archiveCustomer as archiveCustomerModel,
  cancelAdvance as cancelAdvanceModel,
  completeAdvance as completeAdvanceModel,
  forgiveRemaining as forgiveRemainingModel,
  openAdvance as openAdvanceModel,
  receivePayment as receivePaymentModel,
  recordKhataSale,
  removeEntry as removeEntryModel,
  removePayment as removePaymentModel,
  setEntryCustomer as setEntryCustomerModel,
  updateCustomer as updateCustomerModel,
  updateEntry as updateEntryModel,
} from './model/khata'

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }
const ZERO_TOTALS = { dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 }

/** Entries returned by customerDetail (newest first). */
export const DETAIL_ENTRY_LIMIT = 50
/** Payments returned per entry by customerDetail (newest first). */
export const DETAIL_PAYMENT_LIMIT = 200
/** Payments summed by receivedInRange. */
export const RECEIVED_SCAN_LIMIT = 2000
/** Links returned by badgesForRange. */
export const BADGE_LIMIT = 1000
/** Extra rows read by searchCustomers to skip archived customers. */
const SEARCH_SLACK = 50

const customerInput = v.union(
  v.object({ id: v.id('customers') }),
  v.object({ name: v.string(), phone: v.optional(v.string()) }),
)

const khataItemInput = v.object({
  productName: v.string(),
  amount:      v.number(),
  categoryId:  v.optional(v.id('categories')),
  note:        v.optional(v.string()),
})

/** Cached per-request lookups (customers / category ownership) for joins. */
function makeLookups(ctx: QueryCtx, userId: Id<'users'>) {
  const customers = new Map<Id<'customers'>, Promise<Doc<'customers'> | null>>()
  const categories = new Map<Id<'categories'>, Promise<boolean>>()
  return {
    customer(id: Id<'customers'> | undefined): Promise<Doc<'customers'> | null> {
      if (id === undefined) return Promise.resolve(null)
      let p = customers.get(id)
      if (!p) {
        p = getOwned(ctx, 'customers', id, userId)
        customers.set(id, p)
      }
      return p
    },
    /** Lazily hide a deleted category on read (queries never write). */
    async liveCategory(id: Id<'categories'> | undefined): Promise<Id<'categories'> | undefined> {
      if (id === undefined) return undefined
      let p = categories.get(id)
      if (!p) {
        p = getOwned(ctx, 'categories', id, userId).then((c) => c !== null)
        categories.set(id, p)
      }
      return (await p) ? id : undefined
    },
  }
}

/** Copy of `entry` whose categoryId is `live` (the key is dropped when undefined). */
function withCategory<T extends { categoryId?: Id<'categories'> }>(entry: T, live: Id<'categories'> | undefined): T {
  const out = { ...entry }
  if (live === undefined) delete out.categoryId
  else out.categoryId = live
  return out
}

/** Copy of a row with `customerId` as `Id | null` (null = nameless record). */
function withNullableCustomer<T extends { customerId?: Id<'customers'> }>(
  row: T,
): Omit<T, 'customerId'> & { customerId: Id<'customers'> | null } {
  return { ...row, customerId: row.customerId ?? null }
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Open balances of the shop: Udhaar owed (due) and advances held (booked). */
export const getTotals = authedQuery({
  args: {},
  returns: khataTotalsValue,
  handler: async (ctx) => {
    const user = ctx.user
    if (!user) return { ...ZERO_TOTALS }
    const row = await getKhataTotalsRow(ctx, user._id)
    if (!row) return { ...ZERO_TOTALS }
    return { dueTotal: row.dueTotal, dueCount: row.dueCount, heldTotal: row.heldTotal, heldCount: row.heldCount }
  },
})

/**
 * Open entries of one segment, newest openedAt first (paginated):
 * 'due' = Udhaar owed to you, 'booked' = advances you hold.
 */
export const listOpen = authedQuery({
  args: {
    segment:        v.union(v.literal('due'), v.literal('booked')),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated(khataOpenRow),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return EMPTY_PAGE
    const page = await ctx.db
      .query('khataEntries')
      .withIndex('by_userId_status_openedAt', (q) => q.eq('userId', user._id).eq('status', args.segment))
      .order('desc')
      .paginate(args.paginationOpts)
    const lookups = makeLookups(ctx, user._id)
    const rows = await Promise.all(page.page.map(async (entry) => {
      const customer = await lookups.customer(entry.customerId)
      return {
        ...withNullableCustomer(withCategory(entry, await lookups.liveCategory(entry.categoryId))),
        remaining:    remainingOf(entry),
        customerName: customer?.name ?? null,
        ...(customer?.phone !== undefined ? { customerPhone: customer.phone } : {}),
      }
    }))
    return { ...page, page: rows }
  },
})

/**
 * Customer picker: name-prefix search (normalized) or, without `search`, the
 * most recently active customers. Archived customers are skipped. limit ≤ 20.
 */
export const searchCustomers = authedQuery({
  args: {
    search: v.optional(v.string()),
    limit:  v.optional(v.number()),
  },
  returns: v.array(customerDoc),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []
    const requested = Math.floor(args.limit ?? CUSTOMER_SEARCH_MAX)
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), CUSTOMER_SEARCH_MAX) : CUSTOMER_SEARCH_MAX
    const key = customerNameKey(args.search ?? '')
    const rows = key.length > 0
      ? await ctx.db
        .query('customers')
        .withIndex('by_userId_normalizedName', (q) =>
          q.eq('userId', user._id).gte('normalizedName', key).lt('normalizedName', `${key}￿`),
        )
        .take(limit + SEARCH_SLACK)
      : await ctx.db
        .query('customers')
        .withIndex('by_userId_lastActivityAt', (q) => q.eq('userId', user._id))
        .order('desc')
        .take(limit + SEARCH_SLACK)
    return rows.filter((c) => c.archivedAt === undefined).slice(0, limit)
  },
})

/**
 * One customer with their latest 50 entries (newest openedAt first), each
 * with up to 200 payments (newest first). null when missing / not the user's.
 */
export const customerDetail = authedQuery({
  args: { customerId: v.id('customers') },
  returns: v.union(
    v.null(),
    v.object({
      customer:      customerDoc,
      entries:       v.array(khataDetailEntry),
      entriesCapped: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return null
    const customer = await getOwned(ctx, 'customers', args.customerId, user._id)
    if (!customer) return null
    const raw = await ctx.db
      .query('khataEntries')
      .withIndex('by_customerId_openedAt', (q) => q.eq('customerId', customer._id))
      .order('desc')
      .take(DETAIL_ENTRY_LIMIT + 1)
    const entriesCapped = raw.length > DETAIL_ENTRY_LIMIT
    const lookups = makeLookups(ctx, user._id)
    const entries = await Promise.all(
      raw.slice(0, DETAIL_ENTRY_LIMIT).filter((e) => e.userId === user._id).map(async (entry) => {
        const payments = await ctx.db
          .query('khataPayments')
          .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entry._id))
          .order('desc')
          .take(DETAIL_PAYMENT_LIMIT + 1)
        return {
          ...withNullableCustomer(withCategory(entry, await lookups.liveCategory(entry.categoryId))),
          remaining:      remainingOf(entry),
          payments:       payments.slice(0, DETAIL_PAYMENT_LIMIT)
            .filter((p) => p.userId === user._id)
            .map(withNullableCustomer),
          paymentsCapped: payments.length > DETAIL_PAYMENT_LIMIT,
        }
      }),
    )
    return { customer, entries, entriesCapped }
  },
})

/**
 * Money received from customers (payments only, not refunds) with
 * startDate ≤ receivedAt ≤ endDate. Sums the first 2000 rows (`capped`).
 */
export const receivedInRange = authedQuery({
  args: { startDate: v.number(), endDate: v.number() },
  returns: v.object({ total: v.number(), count: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return { total: 0, count: 0, capped: false }
    const rows = await ctx.db
      .query('khataPayments')
      .withIndex('by_userId_receivedAt', (q) =>
        q.eq('userId', user._id).gte('receivedAt', args.startDate).lte('receivedAt', args.endDate),
      )
      .take(RECEIVED_SCAN_LIMIT + 1)
    const capped = rows.length > RECEIVED_SCAN_LIMIT
    let paisa = 0
    let count = 0
    for (const p of rows.slice(0, RECEIVED_SCAN_LIMIT)) {
      if (p.kind !== 'payment' || !Number.isFinite(p.amount)) continue
      paisa += Math.round(p.amount * 100)
      count++
    }
    return { total: paisa / 100, count, capped }
  },
})

/**
 * Khata badges for the day list: one row per linked sale session with
 * startDate ≤ sessionDate ≤ endDate (first 1000).
 */
export const badgesForRange = authedQuery({
  args: { startDate: v.number(), endDate: v.number() },
  returns: v.array(khataBadge),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return []
    const links = await ctx.db
      .query('khataSessionLinks')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', user._id).gte('sessionDate', args.startDate).lte('sessionDate', args.endDate),
      )
      .take(BADGE_LIMIT)
    const lookups = makeLookups(ctx, user._id)
    const entryCache = new Map<Id<'khataEntries'>, Promise<Doc<'khataEntries'> | null>>()
    const rows = await Promise.all(links.map(async (link) => {
      let p = entryCache.get(link.entryId)
      if (!p) {
        p = getOwned(ctx, 'khataEntries', link.entryId, user._id)
        entryCache.set(link.entryId, p)
      }
      const entry = await p
      if (!entry) return null
      const customer = await lookups.customer(entry.customerId)
      return {
        saleSessionId: link.saleSessionId,
        role:          link.role,
        entryId:       entry._id,
        customerId:    entry.customerId ?? null,
        kind:          entry.kind,
        status:        entry.status,
        remaining:     remainingOf(entry),
        customerName:  customer?.name ?? null,
      }
    }))
    return rows.filter((r) => r !== null)
  },
})

/**
 * One entry (named or nameless) with up to 200 payments (newest first) and
 * its customer (null when nameless). null when missing / not the user's.
 */
export const entryDetail = authedQuery({
  args: { entryId: v.id('khataEntries') },
  returns: v.union(v.null(), khataEntryDetail),
  handler: async (ctx, args) => {
    const user = ctx.user
    if (!user) return null
    const entry = await getOwned(ctx, 'khataEntries', args.entryId, user._id)
    if (!entry) return null
    const lookups = makeLookups(ctx, user._id)
    const payments = await ctx.db
      .query('khataPayments')
      .withIndex('by_entryId_receivedAt', (q) => q.eq('entryId', entry._id))
      .order('desc')
      .take(DETAIL_PAYMENT_LIMIT + 1)
    return {
      entry: {
        ...withNullableCustomer(withCategory(entry, await lookups.liveCategory(entry.categoryId))),
        remaining: remainingOf(entry),
      },
      payments:       payments.slice(0, DETAIL_PAYMENT_LIMIT).filter((p) => p.userId === user._id).map(withNullableCustomer),
      paymentsCapped: payments.length > DETAIL_PAYMENT_LIMIT,
      customer:       await lookups.customer(entry.customerId),
    }
  },
})

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Udhaar: a sale where the customer paid less than the bill
 * (0 ≤ receivedNow < Σ items). Offline-safe with `clientRequestId`.
 */
export const recordSale = authedMutation({
  args: {
    customer:        v.optional(customerInput), // omitted / blank name → nameless record
    items:           v.array(khataItemInput),
    sessionDate:     v.number(),
    receivedNow:     v.number(),
    recognition:     v.optional(recognitionValidator),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({
    entryId:   v.id('khataEntries'),
    sessionId: v.optional(v.id('saleSessions')),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => recordKhataSale(ctx, ctx.user, args),
})

/** Advance / booking: money received before handover. Offline-safe with `clientRequestId`. */
export const openAdvance = authedMutation({
  args: {
    customer:        v.optional(customerInput), // omitted / blank name → nameless record
    amount:          v.number(),
    receivedAt:      v.number(),
    total:           v.optional(v.number()),
    itemLabel:       v.optional(v.string()),
    dueDate:         v.optional(v.number()),
    note:            v.optional(v.string()),
    recognition:     v.optional(recognitionValidator),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({ entryId: v.id('khataEntries') }),
  handler: async (ctx, args) => openAdvanceModel(ctx, ctx.user, args),
})

/**
 * Payment on an open entry. `remaining` is null for an advance without a
 * total. Offline-safe with `clientRequestId`.
 */
export const receivePayment = authedMutation({
  args: {
    entryId:         v.id('khataEntries'),
    amount:          v.number(),
    receivedAt:      v.number(),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({
    paymentId: v.id('khataPayments'),
    remaining: v.union(v.number(), v.null()),
    status:    khataStatusValidator,
  }),
  handler: async (ctx, args) => receivePaymentModel(ctx, ctx.user, args),
})

/** Handover of a booked order (online only). */
export const completeAdvance = authedMutation({
  args: {
    entryId:     v.id('khataEntries'),
    finalTotal:  v.number(),
    receivedNow: v.number(),
    deliveredAt: v.number(),
    categoryId:  v.optional(v.id('categories')),
  },
  returns: v.object({
    status:    khataStatusValidator,
    remaining: v.number(),
    sessionId: v.optional(v.id('saleSessions')),
  }),
  handler: async (ctx, args) => completeAdvanceModel(ctx, ctx.user, args),
})

/** Cancel a booked advance: refund everything, or keep the money (online only). */
export const cancelAdvance = authedMutation({
  args: { entryId: v.id('khataEntries'), refund: v.boolean(), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await cancelAdvanceModel(ctx, ctx.user, args)
    return null
  },
})

/** Write off the rest of a due entry (online only). */
export const forgiveRemaining = authedMutation({
  args: { entryId: v.id('khataEntries') },
  returns: v.object({ forgiven: v.number() }),
  handler: async (ctx, args) => forgiveRemainingModel(ctx, ctx.user._id, args.entryId),
})

/** Edit total / item label / note / due date (null clears it) (online only). */
export const updateEntry = authedMutation({
  args: {
    entryId:   v.id('khataEntries'),
    total:     v.optional(v.number()),
    itemLabel: v.optional(v.string()),
    note:      v.optional(v.string()),
    dueDate:   v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateEntryModel(ctx, ctx.user._id, args)
    return null
  },
})

/** Delete one payment (cash mode: also its sale) (online only). */
export const removePayment = authedMutation({
  args: { paymentId: v.id('khataPayments') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removePaymentModel(ctx, ctx.user._id, args.paymentId)
    return null
  },
})

/** "Added by mistake": delete the record with its payments and sales (online only). */
export const removeEntry = authedMutation({
  args: { entryId: v.id('khataEntries') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeEntryModel(ctx, ctx.user._id, args.entryId)
    return null
  },
})

/** Rename a customer or change / clear ('') the phone (online only). */
export const updateCustomer = authedMutation({
  args: {
    customerId: v.id('customers'),
    name:       v.optional(v.string()),
    phone:      v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await updateCustomerModel(ctx, ctx.user._id, args)
    return null
  },
})

/**
 * Attach a customer to a record (by id, or find-or-create by name), move it to
 * another customer, or detach it (null / blank name). Closed records allowed
 * (history only). Online only.
 */
export const setEntryCustomer = authedMutation({
  args: {
    entryId:  v.id('khataEntries'),
    customer: v.union(customerInput, v.null()),
  },
  returns: v.object({ customerId: v.union(v.id('customers'), v.null()) }),
  handler: async (ctx, args) => setEntryCustomerModel(ctx, ctx.user._id, args),
})

/** Hide a customer without open records (online only). */
export const archiveCustomer = authedMutation({
  args: { customerId: v.id('customers') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await archiveCustomerModel(ctx, ctx.user._id, args.customerId)
    return null
  },
})

// ─── Internal repair ────────────────────────────────────────────────────────

const checkResult = v.object({
  ok:             v.boolean(),
  entriesChecked: v.number(),
  capped:         v.boolean(),
  mismatches:     v.array(v.string()),
})

/** Read-only: stored balances vs a recompute from payments / sessions. */
export const verifyUser = internalQuery({
  args: { userId: v.id('users') },
  returns: checkResult,
  handler: async (ctx, args) => {
    const check = await checkKhata(ctx, args.userId)
    return {
      ok:             check.mismatches.length === 0,
      entriesChecked: check.entriesChecked,
      capped:         check.capped,
      mismatches:     check.mismatches,
    }
  },
})

/** Recompute and store entry balances, customer aggregates and khataTotals for one user. */
export const rebuildUser = internalMutation({
  args: { userId: v.id('users') },
  returns: v.object({
    entriesChecked: v.number(),
    capped:         v.boolean(),
    entriesFixed:   v.number(),
    customersFixed: v.number(),
    totalsFixed:    v.boolean(),
  }),
  handler: async (ctx, args) => {
    const check = await checkKhata(ctx, args.userId)
    const fixed = await applyKhataFixes(ctx, args.userId, check)
    return { entriesChecked: check.entriesChecked, capped: check.capped, ...fixed }
  },
})

