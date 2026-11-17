/**
 * Admin dashboard reads (admin only: the caller's verified JWT email must be
 * listed in the ADMIN_EMAILS env var — see model/users isAdminFromIdentity).
 * Read-only: nothing here writes.
 *
 * Both functions page over `users`, so no single call reads more than its
 * per-page budget no matter how many users exist:
 *
 * - `overview`: one row of activity numbers per user; the client loads every
 *   page and sums them (src/hooks/useAdmin.ts). ≤ OVERVIEW_PAGE_MAX users per
 *   page; each user costs ~33 reads when their totals are ready in the
 *   request zone, else ≤ 2 × OVERVIEW_SCAN_CAP rows (flagged `partial` when
 *   capped). Worst case ≈ 40 × 502 ≈ 20k docs, under Convex's 32k.
 * - `listUsers`: ≤ LIST_PAGE_MAX rows per page with today / month / all-time
 *   sales and last activity. Search scans at most LIST_SEARCH_MAX_ROWS users
 *   per page (a page may then come back short; `isDone` says whether more remain).
 *
 * The selected user's KPI cards / charts reuse the normal per-user queries
 * (saleSessions.getStats, getDailyTotals, getYearlyMonthlyTotals,
 * getDayFeed, …) with `viewAsUserId`.
 */
import { v } from 'convex/values'
import { paginationOptsValidator, type PaginationResult } from 'convex/server'
import { stream } from 'convex-helpers/server/stream'
import schema from './schema'
import type { Doc } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { adminQuery } from './lib/functions'
import { paginated } from './lib/returnValidators'
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from './lib/time'
import {
  adminWindows,
  allTimeSales,
  dayBuckets,
  lastActivityAt,
  matchesSearch,
  sumBuckets,
  type AdminWindows,
} from './model/adminStats'
import { totalsGate } from './model/totals'

/** Max users per overview page (numItems is clamped to 1..this). */
export const OVERVIEW_PAGE_MAX = 40
/** Not-ready users: max sessions and max expenses read for the 30-day / month window. */
export const OVERVIEW_SCAN_CAP = 250
/** Max user rows per listUsers page. */
export const LIST_PAGE_MAX = 25
/** Not-ready users: max sessions read for the month window and for all-time sales. */
export const LIST_SCAN_CAP = 200
/** Max users examined per listUsers page while searching. */
export const LIST_SEARCH_MAX_ROWS = 1000
/** Longest search text used (longer input is cut). */
export const SEARCH_MAX_LENGTH = 100

function clampItems(numItems: number, max: number): number {
  return Math.min(Math.max(1, Math.floor(numItems) || 1), max)
}

// ─── overview ───────────────────────────────────────────────────────────────

const overviewRow = v.object({
  userId:            v.id('users'),
  activeToday:       v.boolean(),
  active7d:          v.boolean(),
  active30d:         v.boolean(),
  todaySales:        v.number(),
  todayExpenses:     v.number(),
  monthSales:        v.number(),
  monthExpenses:     v.number(),
  newThisMonth:      v.boolean(),
  /** Read from the summary tables (else a capped scan). */
  fromTotals:        v.boolean(),
  /** A scan cap was hit: this user's month numbers are a lower bound. */
  partial:           v.boolean(),
})

async function overviewFor(ctx: QueryCtx, user: Doc<'users'>, w: AdminWindows, nowMs: number) {
  const lowKey = w.days30Key < w.monthStartKey ? w.days30Key : w.monthStartKey
  const b = await dayBuckets(ctx, user._id, w.timeZone, lowKey, w.todayKey, OVERVIEW_SCAN_CAP)
  const today = sumBuckets(b.days, w.todayKey, w.todayKey)
  const month = sumBuckets(b.days, w.monthStartKey, w.todayKey)
  return {
    userId:        user._id,
    activeToday:   today.active,
    active7d:      sumBuckets(b.days, w.week7Key, w.todayKey).active,
    active30d:     sumBuckets(b.days, w.days30Key, w.todayKey).active,
    todaySales:    today.sales,
    todayExpenses: today.expenses,
    monthSales:    month.sales,
    monthExpenses: month.expenses,
    newThisMonth:  user.createdAt >= w.monthStartMs && user.createdAt <= nowMs,
    fromTotals:    b.fromTotals,
    partial:       b.partial,
  }
}

/**
 * Platform KPIs, one row per user (page over `users`, oldest first). The
 * client sums every page: total users = rows, active today / 7 days / 30 days
 * = users with a sale or expense dated in that window, today's / this
 * month's sales + expenses, new users this month (`createdAt`). Windows are
 * whole days in `timeZone` (blank / invalid → Asia/Karachi).
 */
export const overview = adminQuery({
  args: {
    timeZone:       v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    ...paginated(overviewRow).fields,
    /** Today's day key and this month ('YYYY-MM') in the request zone. */
    todayKey: v.string(),
    monthKey: v.string(),
  }),
  handler: async (ctx, args) => {
    const tz = normalizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
    const nowMs = Date.now()
    const w = adminWindows(nowMs, tz)
    const result = await ctx.db
      .query('users')
      .paginate({ ...args.paginationOpts, numItems: clampItems(args.paginationOpts.numItems, OVERVIEW_PAGE_MAX) })
    const page = []
    for (const user of result.page) page.push(await overviewFor(ctx, user, w, nowMs))
    return {
      ...pageMeta(result),
      page,
      todayKey: w.todayKey,
      monthKey: w.todayKey.slice(0, 7),
    }
  },
})

/** The cursor fields of a pagination result (return validators reject unknown fields). */
function pageMeta(result: PaginationResult<unknown>) {
  return {
    isDone:         result.isDone,
    continueCursor: result.continueCursor,
    ...(result.splitCursor !== undefined ? { splitCursor: result.splitCursor } : {}),
    ...(result.pageStatus !== undefined ? { pageStatus: result.pageStatus } : {}),
  }
}

// ─── listUsers ──────────────────────────────────────────────────────────────

/** Server-side orders. Other orders (recent activity, all-time sales) are applied by the client to loaded rows. */
export const listSort = v.union(v.literal('newest'), v.literal('oldest'), v.literal('name'))

const listRow = v.object({
  _id:            v.id('users'),
  name:           v.string(),
  email:          v.string(),
  createdAt:      v.number(),
  lastActivityAt: v.union(v.number(), v.null()),
  todaySales:     v.number(),
  monthSales:     v.number(),
  allTimeSales:   v.number(),
  totalsReady:    v.boolean(),
  /** A scan cap was hit: month / all-time sales are lower bounds. */
  partial:        v.boolean(),
})

async function listRowFor(ctx: QueryCtx, user: Doc<'users'>, w: AdminWindows, nowMs: number) {
  const [month, allTime, last, ready] = await Promise.all([
    dayBuckets(ctx, user._id, w.timeZone, w.monthStartKey, w.todayKey, LIST_SCAN_CAP),
    allTimeSales(ctx, user._id, LIST_SCAN_CAP),
    lastActivityAt(ctx, user._id, nowMs),
    totalsGate(ctx, user._id),
  ])
  return {
    _id:            user._id,
    name:           user.name,
    email:          user.email,
    createdAt:      user.createdAt,
    lastActivityAt: last,
    todaySales:     sumBuckets(month.days, w.todayKey, w.todayKey).sales,
    monthSales:     sumBuckets(month.days, w.monthStartKey, w.todayKey).sales,
    allTimeSales:   allTime.total,
    totalsReady:    ready !== null,
    partial:        month.partial || allTime.partial,
  }
}

/**
 * One user's list row (admin user-detail header), or null when the id is
 * malformed / from another table / deleted. Same numbers as `listUsers`.
 */
export const getUser = adminQuery({
  args: {
    userId:   v.string(),
    timeZone: v.optional(v.string()),
  },
  returns: v.union(listRow, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('users', args.userId)
    if (id === null) return null
    const user = await ctx.db.get('users', id)
    if (!user) return null
    const nowMs = Date.now()
    return listRowFor(ctx, user, adminWindows(nowMs, normalizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)), nowMs)
  },
})

/**
 * Paginated users with their sales figures.
 * - `sort` (server-side, across all users): 'newest' (default, sign-up
 *   order), 'oldest', or 'name' (index `by_name`; plain string order).
 * - `search`: case-insensitive "contains" on name or email. Each page
 *   examines at most LIST_SEARCH_MAX_ROWS users, so a page can be short.
 * - `timeZone` buckets today / this month (default Asia/Karachi).
 */
export const listUsers = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    search:         v.optional(v.string()),
    sort:           v.optional(listSort),
    timeZone:       v.optional(v.string()),
  },
  returns: paginated(listRow),
  handler: async (ctx, args) => {
    const tz = normalizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
    const nowMs = Date.now()
    const w = adminWindows(nowMs, tz)
    const needle = (args.search ?? '').trim().toLowerCase().slice(0, SEARCH_MAX_LENGTH)
    const sort = args.sort ?? 'newest'

    const users = stream(ctx.db, schema).query('users')
    const ordered = sort === 'name'
      ? users.withIndex('by_name').order('asc')
      : users.withIndex('by_creation_time').order(sort === 'oldest' ? 'asc' : 'desc')
    const filtered = needle.length > 0
      ? ordered.filterWith(async (u) => matchesSearch(u, needle))
      : ordered

    const result = await filtered.paginate({
      ...args.paginationOpts,
      numItems: clampItems(args.paginationOpts.numItems, LIST_PAGE_MAX),
      ...(needle.length > 0 ? { maximumRowsRead: LIST_SEARCH_MAX_ROWS } : {}),
    })
    const page = []
    for (const user of result.page) page.push(await listRowFor(ctx, user, w, nowMs))
    return { ...pageMeta(result), page }
  },
})
