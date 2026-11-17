import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({

  // Synced from Clerk on every sign-in
  users: defineTable({
    name:      v.string(),       // Display name from Clerk
    email:     v.string(),       // Unique, from Clerk
    createdAt: v.number(),       // Unix timestamp ms
    // Tier 2 (additive): stable Clerk identity, linked lazily on login
    tokenIdentifier: v.optional(v.string()),
    // Tier 2 (additive): IANA zone reported by the client, used for day bucketing
    timeZone:        v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_token', ['tokenIdentifier'])
    // Admin dashboard (additive): users list sorted by name.
    .index('by_name', ['name']),

  // User-defined groupings for sales
  categories: defineTable({
    userId:    v.id('users'),    // Owner — always scoped
    name:      v.string(),       // e.g. "Electronics", "Food"
    color:     v.string(),       // Hex color string for UI badge
    createdAt: v.number(),
  }).index('by_userId', ['userId']),

  // One session = one modal submission containing multiple sale items
  saleSessions: defineTable({
    userId:      v.id('users'),
    totalAmount: v.number(),     // Sum of all sales.amount in this session
    itemCount:   v.number(),     // Number of sale items in this session
    sessionDate: v.number(),     // Unix ms — date of the session
    createdAt:   v.number(),
  }).index('by_userId_sessionDate', ['userId', 'sessionDate']),

  // Individual sale line items — one per product in a session
  sales: defineTable({
    userId:     v.id('users'),
    sessionId:  v.id('saleSessions'),         // Parent session
    categoryId: v.optional(v.id('categories')),
    productName: v.string(),                  // Name of item sold
    amount:      v.number(),                  // In PKR, always > 0
    note:        v.optional(v.string()),      // Optional short note
    saleDate:    v.number(),                  // Unix ms — when the sale happened
    createdAt:   v.number(),
  })
    .index('by_userId_saleDate',  ['userId', 'saleDate'])
    // Intentionally kept: existing queries/migrations (category counts/summary,
    // unlink, orphan cleanup, legacy listByCategoryId) and prod rely on it. Drop only
    // after they move to by_userId_categoryId_saleDate.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index('by_userId_categoryId', ['userId', 'categoryId'])
    // Tier 3: paginated category history, newest first
    .index('by_userId_categoryId_saleDate', ['userId', 'categoryId', 'saleDate'])
    .index('by_sessionId',         ['sessionId']),

  // Expenses reduce your profit (shown on dashboard and per-day list)
  expenses: defineTable({
    userId:      v.id('users'),
    amount:      v.number(),        // In PKR, always > 0
    note:        v.optional(v.string()),
    expenseDate: v.number(),       // Unix ms — date of the expense
    createdAt:   v.number(),
  }).index('by_userId_expenseDate', ['userId', 'expenseDate']),

  // ── Tier 2 summary tables (derived data; always rebuildable from source) ──

  // One row per (user, day in the user's bucket time zone). Deleted when both counts reach 0.
  dailyTotals: defineTable({
    userId:       v.id('users'),
    dayKey:       v.string(),    // 'YYYY-MM-DD' in userTotals.timeZone
    salesTotal:   v.number(),    // Σ saleSessions.totalAmount
    itemCount:    v.number(),    // Σ saleSessions.itemCount
    sessionCount: v.number(),
    expenseTotal: v.number(),
    expenseCount: v.number(),
  }).index('by_userId_dayKey', ['userId', 'dayKey']),

  // One row per user: read gate. Written only when a rebuild starts / finishes
  // or category counts flip, so gated range queries that read it are not
  // invalidated by every sale / expense write.
  totalsState: defineTable({
    userId:              v.id('users'),
    timeZone:            v.string(),   // bucket zone, frozen at rebuild
    totalsReady:         v.boolean(),  // reads may use dailyTotals/userTotals
    categoryCountsReady: v.boolean(),  // reads may use categoryStats
  }).index('by_userId', ['userId']),

  // One row per user: all-time sums + rebuild progress (patched on every write
  // and every rebuild step; only all-time stats read it).
  userTotals: defineTable({
    userId:              v.id('users'),
    salesTotal:          v.number(),
    itemCount:           v.number(),
    expenseTotal:        v.number(),
    expenseCount:        v.number(),
    rebuildGeneration:   v.number(),
    rebuildCursor:       v.optional(v.string()), // 'YYYY-MM' or 'YYYY-MM-DD'
    rebuildEnd:          v.optional(v.string()), // 'YYYY-MM'
    // Deprecated (moved to totalsState). Kept optional so rows written by the
    // first dev deploy still validate; new code never writes or trusts them,
    // except timeZone, which seeds a missing totalsState row.
    timeZone:            v.optional(v.string()),
    totalsReady:         v.optional(v.boolean()),
    categoryCountsReady: v.optional(v.boolean()),
  }).index('by_userId', ['userId']),

  // Per-category sale counts/totals (kept off `categories` so the list subscription stays quiet).
  categoryStats: defineTable({
    userId:      v.id('users'),
    categoryId:  v.id('categories'),
    saleCount:   v.number(),
    totalAmount: v.number(),
  }).index('by_userId_categoryId', ['userId', 'categoryId']),

  // ── Idempotency ledger (offline outbox replays) ──
  //
  // One row per applied create that carried a `clientRequestId`. A replay of
  // the same (user, clientRequestId) returns the stored result and writes
  // nothing. Rows are never read by dashboards; pruned after 180 days
  // (clientRequests:pruneClientRequests).
  clientRequests: defineTable({
    userId:          v.id('users'),
    clientRequestId: v.string(),
    kind:            v.union(
      v.literal('sale'),
      v.literal('expense'),
      // Khata (additive): khata.recordSale / openAdvance / receivePayment
      v.literal('khataSale'),
      v.literal('khataAdvance'),
      v.literal('khataPayment'),
    ),
    sessionId:       v.optional(v.id('saleSessions')), // kind 'sale' (and 'khataSale' when a session was made)
    expenseId:       v.optional(v.id('expenses')),     // kind 'expense'
    totalAmount:     v.number(),   // stored result: session total / expense amount / khata amount
    itemCount:       v.number(),   // stored result: session item count / 1
    createdAt:       v.number(),
    // Khata (additive): stored result of the khata kinds
    khataEntryId:    v.optional(v.id('khataEntries')),  // khataSale, khataAdvance, khataPayment
    khataPaymentId:  v.optional(v.id('khataPayments')), // khataPayment
    khataRemaining:  v.optional(v.number()),            // khataSale, khataPayment (absent = no total)
    khataStatus:     v.optional(v.union(
      v.literal('booked'), v.literal('due'), v.literal('settled'), v.literal('cancelled'),
    )),                                                 // khataPayment
  })
    .index('by_userId_clientRequestId', ['userId', 'clientRequestId'])
    .index('by_createdAt', ['createdAt']),

  // ── Advance & Udhaar (Khata). Opt-in per shop; all tables additive. ──

  // One row per user; no row = defaults (khata off, both recognitions 'delivery').
  shopSettings: defineTable({
    userId:             v.id('users'),
    khataEnabled:       v.boolean(),
    advanceRecognition: v.union(v.literal('delivery'), v.literal('cash')),
    udhaarRecognition:  v.union(v.literal('delivery'), v.literal('cash')),
    updatedAt:          v.number(),
  }).index('by_userId', ['userId']),

  // A shop's customer. Aggregates are patched in the same mutation as every entry change.
  customers: defineTable({
    userId:         v.id('users'),
    name:           v.string(),
    normalizedName: v.string(),             // lowercased, trimmed, single spaces
    phone:          v.optional(v.string()), // digits and an optional leading '+', ≤ 20
    dueTotal:       v.number(),             // Σ remaining of 'due' entries
    heldTotal:      v.number(),             // Σ paid of 'booked' entries
    openCount:      v.number(),             // entries in 'booked' | 'due'
    lastActivityAt: v.number(),
    archivedAt:     v.optional(v.number()),
    createdAt:      v.number(),
  })
    .index('by_userId_normalizedName', ['userId', 'normalizedName'])
    .index('by_userId_lastActivityAt', ['userId', 'lastActivityAt']),

  // One Udhaar (credit sale) or Advance (booking) record. `recognition` is frozen at creation.
  khataEntries: defineTable({
    userId:      v.id('users'),
    customerId:  v.optional(v.id('customers')), // absent = nameless record
    kind:        v.union(v.literal('advance'), v.literal('udhaar')),
    status:      v.union(v.literal('booked'), v.literal('due'), v.literal('settled'), v.literal('cancelled')),
    recognition: v.union(v.literal('delivery'), v.literal('cash')),
    total:       v.optional(v.number()),   // bill; optional for an advance without a price yet
    paid:        v.number(),               // Σ payments of kind 'payment'
    forgiven:    v.optional(v.number()),
    refunded:    v.optional(v.number()),
    itemLabel:   v.optional(v.string()),
    items:       v.optional(v.array(v.object({  // cash-mode Udhaar: the sold items (≤ 20)
      productName: v.string(),
      amount:      v.number(),
      categoryId:  v.optional(v.id('categories')),
    }))),
    categoryId:  v.optional(v.id('categories')),
    note:        v.optional(v.string()),
    openedAt:    v.number(),
    deliveredAt: v.optional(v.number()),
    dueDate:     v.optional(v.number()),
    saleSessionId: v.optional(v.id('saleSessions')), // delivery session (delivery mode / advance kept)
    closedAt:    v.optional(v.number()),
    createdAt:   v.number(),
    updatedAt:   v.number(),
  })
    .index('by_userId_status_openedAt', ['userId', 'status', 'openedAt'])
    .index('by_customerId_openedAt', ['customerId', 'openedAt']),

  // Money in ('payment') or out ('refund') for an entry.
  khataPayments: defineTable({
    userId:        v.id('users'),
    entryId:       v.id('khataEntries'),
    customerId:    v.optional(v.id('customers')), // copy of the entry's (absent = nameless)
    kind:          v.union(v.literal('payment'), v.literal('refund')),
    amount:        v.number(),
    receivedAt:    v.number(),
    saleSessionId: v.optional(v.id('saleSessions')), // cash mode: the session this payment created
    expenseId:     v.optional(v.id('expenses')),     // cash-mode refund: the expense it created
    note:          v.optional(v.string()),
    createdAt:     v.number(),
  })
    .index('by_entryId_receivedAt', ['entryId', 'receivedAt'])
    .index('by_userId_receivedAt', ['userId', 'receivedAt']),

  // Sale sessions created by khata ('delivery' = the sale itself, 'payment' = a cash-mode payment).
  khataSessionLinks: defineTable({
    userId:        v.id('users'),
    saleSessionId: v.id('saleSessions'),
    sessionDate:   v.number(),
    entryId:       v.id('khataEntries'),
    paymentId:     v.optional(v.id('khataPayments')),
    role:          v.union(v.literal('delivery'), v.literal('payment')),
  })
    .index('by_saleSessionId', ['saleSessionId'])
    .index('by_userId_sessionDate', ['userId', 'sessionDate']),

  // One row per user: open balances (patched with every entry change).
  khataTotals: defineTable({
    userId:    v.id('users'),
    dueTotal:  v.number(),
    dueCount:  v.number(),
    heldTotal: v.number(),
    heldCount: v.number(),
  }).index('by_userId', ['userId']),

})
