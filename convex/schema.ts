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
    .index('by_token', ['tokenIdentifier']),

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
    kind:            v.union(v.literal('sale'), v.literal('expense')),
    sessionId:       v.optional(v.id('saleSessions')), // kind 'sale'
    expenseId:       v.optional(v.id('expenses')),     // kind 'expense'
    totalAmount:     v.number(),   // stored result: session total / expense amount
    itemCount:       v.number(),   // stored result: session item count / 1
    createdAt:       v.number(),
  })
    .index('by_userId_clientRequestId', ['userId', 'clientRequestId'])
    .index('by_createdAt', ['createdAt']),

})
