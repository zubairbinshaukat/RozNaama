/**
 * Tier 2 summary tables: `dailyTotals`, `totalsState`, `userTotals`, `categoryStats`.
 *
 * Invariants (kept by the write hooks below and by the rebuild in
 * convex/totals.ts):
 * - totalsState[user] = read gate (bucket zone, totalsReady,
 *   categoryCountsReady). Rarely written; the only doc gated range reads use.
 * - dailyTotals[user, dayKey] = Σ over that user's sessions / expenses whose
 *   stored instant falls on `dayKey` in the user's BUCKET zone
 *   (totalsState.timeZone, frozen at rebuild). Rows are deleted when both
 *   sessionCount and expenseCount reach 0.
 * - userTotals.{salesTotal,itemCount,expenseTotal,expenseCount} = Σ of the
 *   user's dailyTotals rows (every row change applies the same diff).
 * - categoryStats[user, categoryId] = count and Σ amount of the user's sales
 *   with that categoryId. Rows are deleted at saleCount 0.
 *
 * Non-finite numbers (legacy rows) count as 0 and rows with a non-finite date
 * cannot be bucketed, so they are skipped. Hooks always write, even while
 * `totalsReady` is false: the rebuild fixes whatever was there before.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { readEnv } from '../lib/env'
import {
  DEFAULT_TIME_ZONE,
  dateKeyInTimeZone,
  monthBounds,
  normalizeTimeZone,
  zonedStartOfDayMs,
} from '../lib/time'

type ReadCtx = QueryCtx | MutationCtx

/** Kill switch: deployment env var `TOTALS_READS=off` forces every read onto the scan path. */
export const TOTALS_READS_ENV = 'TOTALS_READS'

/** Legacy rows may hold NaN / ±Infinity: they count as 0 in every total. */
export function safe(x: number): number {
  return Number.isFinite(x) ? x : 0
}

/** 'YYYY-MM-DD' of `ms` in `timeZone`, or null when `ms` cannot be bucketed. */
export function safeDayKey(ms: number, timeZone: string): string | null {
  if (!Number.isFinite(ms)) return null
  try {
    const key = dateKeyInTimeZone(ms, timeZone)
    return DAY_KEY_RE.test(key) ? key : null
  } catch {
    return null
  }
}

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
export const MONTH_KEY_RE = /^\d{4}-\d{2}$/

/** Calendar day after `dayKey` (pure date arithmetic, zone-independent). */
export function nextDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(y ?? NaN, (m ?? NaN) - 1, (d ?? NaN) + 1)).toISOString().slice(0, 10)
}

/** Calendar month after `monthKey` ('YYYY-MM'). */
export function nextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y ?? NaN, m ?? NaN, 1)).toISOString().slice(0, 7)
}

// ─── totalsState (read gate) + userTotals (sums, rebuild progress) ──────────
//
// The gate lives in its own table so that range queries (charts, day feed,
// category counts) read only a doc that changes when a rebuild starts or
// finishes — not on every write. `userTotals` is patched by every write and
// every rebuild step and is read only for all-time stats.
//
// A user without a totalsState row is "not ready" (scan path). Rows written to
// userTotals by the first dev deploy still carry the deprecated gate fields;
// they are ignored (only `timeZone` seeds a missing totalsState row) and
// cleared by the next rebuild.

export function getTotalsState(ctx: ReadCtx, userId: Id<'users'>): Promise<Doc<'totalsState'> | null> {
  return ctx.db
    .query('totalsState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
}

export function getUserTotals(ctx: ReadCtx, userId: Id<'users'>): Promise<Doc<'userTotals'> | null> {
  return ctx.db
    .query('userTotals')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
}

/** The zone a NEW totalsState row (or a rebuild) freezes for this user. */
export function preferredBucketTimeZone(user: Doc<'users'> | null): string {
  return normalizeTimeZone(user?.timeZone, DEFAULT_TIME_ZONE)
}

/**
 * Bucket zone used for a user's day keys:
 * totalsState.timeZone ?? legacy userTotals.timeZone ?? users.timeZone ?? 'Asia/Karachi'.
 */
export async function resolveBucketTimeZone(ctx: ReadCtx, userId: Id<'users'>): Promise<string> {
  const state = await getTotalsState(ctx, userId)
  if (state) return state.timeZone
  const legacy = (await getUserTotals(ctx, userId))?.timeZone
  if (legacy !== undefined) return legacy
  return preferredBucketTimeZone(await ctx.db.get('users', userId))
}

async function getOrCreateTotalsState(ctx: MutationCtx, userId: Id<'users'>): Promise<Doc<'totalsState'>> {
  const existing = await getTotalsState(ctx, userId)
  if (existing) return existing
  const id = await ctx.db.insert('totalsState', {
    userId,
    // Keep bucketing where existing dailyTotals rows were bucketed (legacy dev rows).
    timeZone:            await resolveBucketTimeZone(ctx, userId),
    totalsReady:         false,
    categoryCountsReady: false,
  })
  const created = await ctx.db.get('totalsState', id)
  if (!created) throw new Error('totalsState insert failed')
  return created
}

async function getOrCreateUserTotals(ctx: MutationCtx, userId: Id<'users'>): Promise<Doc<'userTotals'>> {
  const existing = await getUserTotals(ctx, userId)
  if (existing) return existing
  const id = await ctx.db.insert('userTotals', {
    userId,
    salesTotal:        0,
    itemCount:         0,
    expenseTotal:      0,
    expenseCount:      0,
    rebuildGeneration: 0,
  })
  const created = await ctx.db.get('userTotals', id)
  if (!created) throw new Error('userTotals insert failed')
  return created
}

function readsEnabled(): boolean {
  return readEnv(TOTALS_READS_ENV) !== 'off'
}

/**
 * The user's gate doc when the summary tables may serve reads: totalsReady,
 * kill switch not 'off', and (if given) the request zone equals the frozen
 * bucket zone. Otherwise null → caller uses the scan path. Reads only
 * `totalsState` (never the write-hot `userTotals`).
 */
export async function totalsGate(
  ctx: ReadCtx,
  userId: Id<'users'>,
  requestTimeZone?: string,
): Promise<Doc<'totalsState'> | null> {
  if (!readsEnabled()) return null
  const state = await getTotalsState(ctx, userId)
  if (!state || !state.totalsReady) return null
  if (requestTimeZone !== undefined && requestTimeZone !== state.timeZone) return null
  return state
}

/** True when categoryStats may serve reads for this user (reads only `totalsState`). */
export async function categoryStatsReady(ctx: ReadCtx, userId: Id<'users'>): Promise<boolean> {
  if (!readsEnabled()) return false
  const state = await getTotalsState(ctx, userId)
  return state?.categoryCountsReady === true
}

/** All-time sums when the gate passes and the sums row exists; else null (scan). */
export async function allTimeSumsIfReady(ctx: ReadCtx, userId: Id<'users'>): Promise<UserSums | null> {
  if (!(await totalsGate(ctx, userId))) return null
  const totals = await getUserTotals(ctx, userId)
  if (!totals) return null
  return {
    salesTotal:   totals.salesTotal,
    itemCount:    totals.itemCount,
    expenseTotal: totals.expenseTotal,
    expenseCount: totals.expenseCount,
  }
}

// ─── dailyTotals deltas ─────────────────────────────────────────────────────

export type DayValues = {
  salesTotal:   number
  itemCount:    number
  sessionCount: number
  expenseTotal: number
  expenseCount: number
}

export const ZERO_DAY: DayValues = {
  salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 0, expenseCount: 0,
}

function addDay(a: DayValues, b: DayValues, sign = 1): DayValues {
  return {
    salesTotal:   a.salesTotal + sign * b.salesTotal,
    itemCount:    a.itemCount + sign * b.itemCount,
    sessionCount: a.sessionCount + sign * b.sessionCount,
    expenseTotal: a.expenseTotal + sign * b.expenseTotal,
    expenseCount: a.expenseCount + sign * b.expenseCount,
  }
}

function isZeroDelta(d: DayValues): boolean {
  return d.salesTotal === 0 && d.itemCount === 0 && d.sessionCount === 0 &&
    d.expenseTotal === 0 && d.expenseCount === 0
}

/** A row with no sessions and no expenses left is deleted. */
export function isEmptyDay(d: DayValues): boolean {
  return d.sessionCount <= 0 && d.expenseCount <= 0
}

export function dayValuesOf(row: Doc<'dailyTotals'>): DayValues {
  return {
    salesTotal:   row.salesTotal,
    itemCount:    row.itemCount,
    sessionCount: row.sessionCount,
    expenseTotal: row.expenseTotal,
    expenseCount: row.expenseCount,
  }
}

export function sameDayValues(a: DayValues, b: DayValues): boolean {
  return a.salesTotal === b.salesTotal && a.itemCount === b.itemCount &&
    a.sessionCount === b.sessionCount && a.expenseTotal === b.expenseTotal &&
    a.expenseCount === b.expenseCount
}

/** Contribution of one session to its day. */
export function sessionContribution(s: Doc<'saleSessions'>): DayValues {
  return { ...ZERO_DAY, salesTotal: safe(s.totalAmount), itemCount: safe(s.itemCount), sessionCount: 1 }
}

/** Contribution of one expense to its day. */
export function expenseContribution(e: Doc<'expenses'>): DayValues {
  return { ...ZERO_DAY, expenseTotal: safe(e.amount), expenseCount: 1 }
}

export type UserSums = Pick<Doc<'userTotals'>, 'salesTotal' | 'itemCount' | 'expenseTotal' | 'expenseCount'>

export const ZERO_SUMS: UserSums = { salesTotal: 0, itemCount: 0, expenseTotal: 0, expenseCount: 0 }

/** Accumulate `sign × row` into user sums (sessionCount is not tracked all-time). */
export function addToSums(sums: UserSums, row: DayValues | null, sign: number): UserSums {
  if (!row) return sums
  return {
    salesTotal:   sums.salesTotal + sign * row.salesTotal,
    itemCount:    sums.itemCount + sign * row.itemCount,
    expenseTotal: sums.expenseTotal + sign * row.expenseTotal,
    expenseCount: sums.expenseCount + sign * row.expenseCount,
  }
}

export function mergeSums(a: UserSums, b: UserSums): UserSums {
  return {
    salesTotal:   a.salesTotal + b.salesTotal,
    itemCount:    a.itemCount + b.itemCount,
    expenseTotal: a.expenseTotal + b.expenseTotal,
    expenseCount: a.expenseCount + b.expenseCount,
  }
}

export function isZeroSums(s: UserSums): boolean {
  return s.salesTotal === 0 && s.itemCount === 0 && s.expenseTotal === 0 && s.expenseCount === 0
}

export function getDailyRow(
  ctx: ReadCtx,
  userId: Id<'users'>,
  dayKey: string,
): Promise<Doc<'dailyTotals'> | null> {
  return ctx.db
    .query('dailyTotals')
    .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId).eq('dayKey', dayKey))
    .first()
}

/**
 * Set the dailyTotals row for `dayKey` to `next` (null / empty → delete).
 * Returns the row change as (after − before) so callers keep userTotals in sync.
 */
export async function writeDailyRow(
  ctx: MutationCtx,
  userId: Id<'users'>,
  dayKey: string,
  existing: Doc<'dailyTotals'> | null,
  next: DayValues | null,
): Promise<UserSums> {
  const before = existing ? dayValuesOf(existing) : null
  const after = next && !isEmptyDay(next) ? next : null
  if (existing && after) {
    if (!sameDayValues(before as DayValues, after)) {
      await ctx.db.patch('dailyTotals', existing._id, after)
    }
  } else if (existing) {
    await ctx.db.delete('dailyTotals', existing._id)
  } else if (after) {
    await ctx.db.insert('dailyTotals', { userId, dayKey, ...after })
  }
  return addToSums(addToSums(ZERO_SUMS, after, 1), before, -1)
}

/** Add `delta` to the user's `dayKey` row (creating / deleting it) and to userTotals. */
export async function applyDayDelta(
  ctx: MutationCtx,
  userId: Id<'users'>,
  dayKey: string,
  delta: DayValues,
): Promise<void> {
  await applyDayDeltas(ctx, userId, new Map([[dayKey, delta]]))
}

async function applyDayDeltas(
  ctx: MutationCtx,
  userId: Id<'users'>,
  deltas: Map<string, DayValues>,
): Promise<void> {
  const live = [...deltas.entries()].filter(([, d]) => !isZeroDelta(d))
  if (live.length === 0) return
  let sums = ZERO_SUMS
  for (const [dayKey, delta] of live) {
    const row = await getDailyRow(ctx, userId, dayKey)
    const next = addDay(row ? dayValuesOf(row) : ZERO_DAY, delta)
    sums = mergeSums(sums, await writeDailyRow(ctx, userId, dayKey, row, next))
  }
  await addUserSums(ctx, userId, sums)
}

/** Patch userTotals all-time sums by `diff` (no-op for a zero diff; creates the row if needed). */
export async function addUserSums(ctx: MutationCtx, userId: Id<'users'>, diff: UserSums): Promise<void> {
  if (isZeroSums(diff)) return
  // Always re-read: the row may have been patched earlier in this mutation.
  const fresh = await getOrCreateUserTotals(ctx, userId)
  await ctx.db.patch('userTotals', fresh._id, {
    salesTotal:   fresh.salesTotal + diff.salesTotal,
    itemCount:    fresh.itemCount + diff.itemCount,
    expenseTotal: fresh.expenseTotal + diff.expenseTotal,
    expenseCount: fresh.expenseCount + diff.expenseCount,
  })
}

function collectDelta(
  map: Map<string, DayValues>,
  dayKey: string | null,
  contribution: DayValues,
  sign: number,
): void {
  if (dayKey === null) return
  map.set(dayKey, addDay(map.get(dayKey) ?? ZERO_DAY, contribution, sign))
}

// ─── Hooks (called by the write helpers in model/sales.ts & model/expenses.ts) ─

/** Diff-based totals update for one saleSessions insert / patch / delete. */
export async function totalsOnSessionChange(
  ctx: MutationCtx,
  before: Doc<'saleSessions'> | null,
  after: Doc<'saleSessions'> | null,
): Promise<void> {
  const userId = (after ?? before)?.userId
  if (!userId) return
  const { timeZone } = await getOrCreateTotalsState(ctx, userId)
  const deltas = new Map<string, DayValues>()
  if (before) collectDelta(deltas, safeDayKey(before.sessionDate, timeZone), sessionContribution(before), -1)
  if (after) collectDelta(deltas, safeDayKey(after.sessionDate, timeZone), sessionContribution(after), 1)
  await applyDayDeltas(ctx, userId, deltas)
}

/** Diff-based totals update for one expenses insert / patch / delete. */
export async function totalsOnExpenseChange(
  ctx: MutationCtx,
  before: Doc<'expenses'> | null,
  after: Doc<'expenses'> | null,
): Promise<void> {
  const userId = (after ?? before)?.userId
  if (!userId) return
  const { timeZone } = await getOrCreateTotalsState(ctx, userId)
  const deltas = new Map<string, DayValues>()
  if (before) collectDelta(deltas, safeDayKey(before.expenseDate, timeZone), expenseContribution(before), -1)
  if (after) collectDelta(deltas, safeDayKey(after.expenseDate, timeZone), expenseContribution(after), 1)
  await applyDayDeltas(ctx, userId, deltas)
}

// ─── categoryStats ──────────────────────────────────────────────────────────

export function getCategoryStatsRow(
  ctx: ReadCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
): Promise<Doc<'categoryStats'> | null> {
  return ctx.db
    .query('categoryStats')
    .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).eq('categoryId', categoryId))
    .first()
}

type CategoryDelta = { saleCount: number; totalAmount: number }

/** Add a delta to a categoryStats row; inserts on first sale, deletes at saleCount ≤ 0. */
export async function applyCategoryDelta(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
  delta: CategoryDelta,
): Promise<void> {
  if (delta.saleCount === 0 && delta.totalAmount === 0) return
  const row = await getCategoryStatsRow(ctx, userId, categoryId)
  const saleCount = (row?.saleCount ?? 0) + delta.saleCount
  const totalAmount = (row?.totalAmount ?? 0) + delta.totalAmount
  if (saleCount <= 0) {
    if (row) await ctx.db.delete('categoryStats', row._id)
  } else if (row) {
    await ctx.db.patch('categoryStats', row._id, { saleCount, totalAmount })
  } else {
    await ctx.db.insert('categoryStats', { userId, categoryId, saleCount, totalAmount })
  }
}

/** Write categoryStats for a category to exactly `value` (null → delete). Returns true if it wrote. */
export async function setCategoryStats(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
  value: CategoryDelta | null,
): Promise<boolean> {
  const row = await getCategoryStatsRow(ctx, userId, categoryId)
  if (!value || value.saleCount <= 0) {
    if (!row) return false
    await ctx.db.delete('categoryStats', row._id)
    return true
  }
  if (row) {
    if (row.saleCount === value.saleCount && row.totalAmount === value.totalAmount) return false
    await ctx.db.patch('categoryStats', row._id, value)
    return true
  }
  await ctx.db.insert('categoryStats', { userId, categoryId, ...value })
  return true
}

/** Delete the categoryStats row of a category (category delete / orphan cleanup). */
export async function deleteCategoryStats(
  ctx: MutationCtx,
  userId: Id<'users'>,
  categoryId: Id<'categories'>,
): Promise<boolean> {
  return setCategoryStats(ctx, userId, categoryId, null)
}

/** Diff-based categoryStats update for one sales insert / patch / delete. */
export async function totalsOnSaleChange(
  ctx: MutationCtx,
  before: Doc<'sales'> | null,
  after: Doc<'sales'> | null,
): Promise<void> {
  const deltas = new Map<string, { userId: Id<'users'>; categoryId: Id<'categories'>; d: CategoryDelta }>()
  const add = (doc: Doc<'sales'> | null, sign: number) => {
    if (!doc || doc.categoryId === undefined) return
    const key = `${doc.userId}|${doc.categoryId}`
    const prev = deltas.get(key)?.d ?? { saleCount: 0, totalAmount: 0 }
    deltas.set(key, {
      userId:     doc.userId,
      categoryId: doc.categoryId,
      d: { saleCount: prev.saleCount + sign, totalAmount: prev.totalAmount + sign * safe(doc.amount) },
    })
  }
  add(before, -1)
  add(after, 1)
  for (const { userId, categoryId, d } of deltas.values()) {
    await applyCategoryDelta(ctx, userId, categoryId, d)
  }
}

// ─── Rebuild (WP5) ──────────────────────────────────────────────────────────

/** Above this many sessions OR expenses in a month, the rebuild goes day by day. */
export const MONTH_ROW_LIMIT = 2000
/** finalize re-sums dailyTotals exactly when the user has at most this many rows. */
export const EXACT_RESUM_LIMIT = 5000
/** backfillCategoryStats leaves categoryCountsReady=false above this many categorised sales. */
export const CATEGORY_BACKFILL_LIMIT = 8000

const MIN_MS = -Number.MAX_VALUE
const MAX_MS = Number.MAX_VALUE

export type RebuildUnit = {
  lowKey:  string
  highKey: string
  startMs: number
  endMs:   number
}

/** Unit of work for a rebuild cursor: 'YYYY-MM' (month) or 'YYYY-MM-DD' (day). */
export function rebuildUnit(cursor: string, timeZone: string): RebuildUnit | null {
  if (DAY_KEY_RE.test(cursor)) {
    return {
      lowKey:  cursor,
      highKey: cursor,
      startMs: zonedStartOfDayMs(cursor, timeZone),
      endMs:   zonedStartOfDayMs(nextDayKey(cursor), timeZone),
    }
  }
  if (MONTH_KEY_RE.test(cursor)) {
    const { start, end } = monthBounds(cursor, timeZone)
    return { lowKey: `${cursor}-01`, highKey: `${cursor}-31`, startMs: start, endMs: end }
  }
  return null
}

/**
 * Recompute day rows from source (saleSessions + expenses) for one unit.
 * `limit` caps each table read; `overflow` reports that it was hit.
 */
export async function computeExpectedDays(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
  unit: RebuildUnit,
  limit?: number,
): Promise<{ days: Map<string, DayValues>; overflow: boolean }> {
  const sessionsQ = ctx.db
    .query('saleSessions')
    .withIndex('by_userId_sessionDate', (q) =>
      q.eq('userId', userId).gte('sessionDate', unit.startMs).lt('sessionDate', unit.endMs),
    )
  const expensesQ = ctx.db
    .query('expenses')
    .withIndex('by_userId_expenseDate', (q) =>
      q.eq('userId', userId).gte('expenseDate', unit.startMs).lt('expenseDate', unit.endMs),
    )
  const [sessions, expenses] = await Promise.all([
    limit === undefined ? sessionsQ.collect() : sessionsQ.take(limit + 1),
    limit === undefined ? expensesQ.collect() : expensesQ.take(limit + 1),
  ])
  const overflow = limit !== undefined && (sessions.length > limit || expenses.length > limit)
  const days = new Map<string, DayValues>()
  const inUnit = (key: string | null): key is string =>
    key !== null && key >= unit.lowKey && key <= unit.highKey
  for (const s of sessions) {
    const key = safeDayKey(s.sessionDate, timeZone)
    if (inUnit(key)) days.set(key, addDay(days.get(key) ?? ZERO_DAY, sessionContribution(s)))
  }
  for (const e of expenses) {
    const key = safeDayKey(e.expenseDate, timeZone)
    if (inUnit(key)) days.set(key, addDay(days.get(key) ?? ZERO_DAY, expenseContribution(e)))
  }
  return { days, overflow }
}

export function dailyRowsInKeyRange(
  ctx: ReadCtx,
  userId: Id<'users'>,
  lowKey: string,
  highKey: string,
): Promise<Doc<'dailyTotals'>[]> {
  return ctx.db
    .query('dailyTotals')
    .withIndex('by_userId_dayKey', (q) =>
      q.eq('userId', userId).gte('dayKey', lowKey).lte('dayKey', highKey),
    )
    .collect()
}

function monthOf(dayKey: string | null): string | null {
  return dayKey === null ? null : dayKey.slice(0, 7)
}

function minKey(keys: (string | null)[]): string | null {
  let best: string | null = null
  for (const k of keys) if (k !== null && (best === null || k < best)) best = k
  return best
}

function maxKey(keys: (string | null)[]): string | null {
  let best: string | null = null
  for (const k of keys) if (k !== null && (best === null || k > best)) best = k
  return best
}

/** First / last month that has a session, expense or dailyTotals row (bucket zone). */
async function dataMonthRange(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
): Promise<{ first: string; last: string } | null> {
  const sessions = (order: 'asc' | 'desc') =>
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', userId).gte('sessionDate', MIN_MS).lte('sessionDate', MAX_MS),
      )
      .order(order)
      .first()
  const expenses = (order: 'asc' | 'desc') =>
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', userId).gte('expenseDate', MIN_MS).lte('expenseDate', MAX_MS),
      )
      .order(order)
      .first()
  const daily = (order: 'asc' | 'desc') =>
    ctx.db
      .query('dailyTotals')
      .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId))
      .order(order)
      .first()
  const [s1, s2, e1, e2, d1, d2] = await Promise.all([
    sessions('asc'), sessions('desc'), expenses('asc'), expenses('desc'), daily('asc'), daily('desc'),
  ])
  const sk = (s: Doc<'saleSessions'> | null) => monthOf(s ? safeDayKey(s.sessionDate, timeZone) : null)
  const ek = (e: Doc<'expenses'> | null) => monthOf(e ? safeDayKey(e.expenseDate, timeZone) : null)
  const dk = (d: Doc<'dailyTotals'> | null) => (d && MONTH_KEY_RE.test(d.dayKey.slice(0, 7)) ? d.dayKey.slice(0, 7) : null)
  const first = minKey([sk(s1), ek(e1), dk(d1)])
  const last = maxKey([sk(s2), ek(e2), dk(d2)])
  return first !== null && last !== null ? { first, last } : null
}

/** Next month after `monthKey` that has any data (bucket zone), or null. */
async function nextDataMonth(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
  monthKey: string,
): Promise<string | null> {
  const following = nextMonthKey(monthKey)
  const fromMs = monthBounds(following, timeZone).start
  const [s, e, d] = await Promise.all([
    ctx.db
      .query('saleSessions')
      .withIndex('by_userId_sessionDate', (q) =>
        q.eq('userId', userId).gte('sessionDate', fromMs).lte('sessionDate', MAX_MS),
      )
      .first(),
    ctx.db
      .query('expenses')
      .withIndex('by_userId_expenseDate', (q) =>
        q.eq('userId', userId).gte('expenseDate', fromMs).lte('expenseDate', MAX_MS),
      )
      .first(),
    ctx.db
      .query('dailyTotals')
      .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId).gte('dayKey', `${following}-01`))
      .first(),
  ])
  const next = minKey([
    monthOf(s ? safeDayKey(s.sessionDate, timeZone) : null),
    monthOf(e ? safeDayKey(e.expenseDate, timeZone) : null),
    d ? d.dayKey.slice(0, 7) : null,
  ])
  if (next === null) return null
  return next > monthKey ? next : following
}

export type RebuildStart = {
  generation: number
  timeZone:   string
  cursor:     string | null
  end:        string | null
}

/**
 * Start (or restart) a rebuild: bump the generation (older chains abort),
 * mark totals not ready, freeze the bucket zone and schedule the first month.
 */
export async function startRebuild(ctx: MutationCtx, userId: Id<'users'>): Promise<RebuildStart | null> {
  const user = await ctx.db.get('users', userId)
  if (!user) return null
  const timeZone = preferredBucketTimeZone(user)
  const state = await getOrCreateTotalsState(ctx, userId)
  const totals = await getOrCreateUserTotals(ctx, userId)
  const generation = totals.rebuildGeneration + 1
  // Range covers rows bucketed in the OLD zone too (dailyTotals first/last).
  const range = await dataMonthRange(ctx, userId, timeZone)
  if (state.totalsReady || state.timeZone !== timeZone) {
    await ctx.db.patch('totalsState', state._id, { timeZone, totalsReady: false })
  }
  await ctx.db.patch('userTotals', totals._id, {
    rebuildGeneration: generation,
    rebuildCursor:     range?.first,
    rebuildEnd:        range?.last,
    // Drop the deprecated gate fields of first-dev-deploy rows.
    timeZone:            undefined,
    totalsReady:         undefined,
    categoryCountsReady: undefined,
  })
  if (range === null) {
    await finalizeRebuild(ctx, userId)
  } else {
    await ctx.scheduler.runAfter(0, internal.totals.rebuildMonth, {
      userId,
      generation,
      cursor: range.first,
    })
  }
  return { generation, timeZone, cursor: range?.first ?? null, end: range?.last ?? null }
}

/** Re-sum (when small enough) and flip totalsReady. */
async function finalizeRebuild(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  const totals = await getUserTotals(ctx, userId)
  const state = await getTotalsState(ctx, userId)
  if (!totals || !state) return
  const rows = await ctx.db
    .query('dailyTotals')
    .withIndex('by_userId_dayKey', (q) => q.eq('userId', userId))
    .take(EXACT_RESUM_LIMIT + 1)
  let sums: UserSums | null = null
  if (rows.length <= EXACT_RESUM_LIMIT) {
    sums = ZERO_SUMS
    for (const row of rows) sums = addToSums(sums, dayValuesOf(row), 1)
  }
  await ctx.db.patch('userTotals', totals._id, {
    ...(sums ?? {}),
    rebuildCursor: undefined,
    rebuildEnd:    undefined,
  })
  if (!state.totalsReady) await ctx.db.patch('totalsState', state._id, { totalsReady: true })
}

export type RebuildStepResult = 'stale' | 'split' | 'next' | 'done'

/**
 * One rebuild transaction for `cursor` (a month, or a day of a huge month).
 * Aborts unless generation AND cursor match the userTotals row, so stale or
 * duplicated chains are harmless. Writes only rows that differ.
 */
export async function rebuildStep(
  ctx: MutationCtx,
  userId: Id<'users'>,
  generation: number,
  cursor: string,
): Promise<RebuildStepResult> {
  const totals = await getUserTotals(ctx, userId)
  if (!totals || totals.rebuildGeneration !== generation || totals.rebuildCursor !== cursor) {
    return 'stale'
  }
  const state = await getTotalsState(ctx, userId)
  if (!state) return 'stale'
  const timeZone = state.timeZone
  const unit = rebuildUnit(cursor, timeZone)
  if (!unit) {
    await finalizeRebuild(ctx, userId)
    return 'done'
  }
  const isDay = DAY_KEY_RE.test(cursor)
  const { days, overflow } = await computeExpectedDays(
    ctx, userId, timeZone, unit, isDay ? undefined : MONTH_ROW_LIMIT,
  )
  const schedule = async (next: string) => {
    await ctx.db.patch('userTotals', totals._id, { rebuildCursor: next })
    await ctx.scheduler.runAfter(0, internal.totals.rebuildMonth, { userId, generation, cursor: next })
  }
  if (overflow) {
    await schedule(`${cursor}-01`)
    return 'split'
  }

  let diff = ZERO_SUMS
  for (const row of await dailyRowsInKeyRange(ctx, userId, unit.lowKey, unit.highKey)) {
    diff = mergeSums(diff, await writeDailyRow(ctx, userId, row.dayKey, row, days.get(row.dayKey) ?? null))
    days.delete(row.dayKey)
  }
  for (const [dayKey, values] of days) {
    diff = mergeSums(diff, await writeDailyRow(ctx, userId, dayKey, null, values))
  }
  await addUserSums(ctx, userId, diff)

  let next: string | null
  const month = cursor.slice(0, 7)
  if (isDay) {
    const nd = nextDayKey(cursor)
    next = nd.slice(0, 7) === month ? nd : await nextDataMonth(ctx, userId, timeZone, month)
  } else {
    next = await nextDataMonth(ctx, userId, timeZone, month)
  }
  if (next !== null && totals.rebuildEnd !== undefined && next.slice(0, 7) > totals.rebuildEnd) next = null
  if (next === null) {
    await finalizeRebuild(ctx, userId)
    return 'done'
  }
  await schedule(next)
  return 'next'
}

export type MonthCheck = {
  dayKey:   string
  expected: DayValues | null
  actual:   DayValues | null
}

/** Read-only comparison of one month's dailyTotals with a from-source recompute. */
export async function verifyMonth(
  ctx: ReadCtx,
  userId: Id<'users'>,
  timeZone: string,
  monthKey: string,
): Promise<MonthCheck[]> {
  const unit = rebuildUnit(monthKey, timeZone)
  if (!unit || !MONTH_KEY_RE.test(monthKey)) return []
  const { days } = await computeExpectedDays(ctx, userId, timeZone, unit)
  const mismatches: MonthCheck[] = []
  for (const row of await dailyRowsInKeyRange(ctx, userId, unit.lowKey, unit.highKey)) {
    const expected = days.get(row.dayKey) ?? null
    const actual = dayValuesOf(row)
    if (!expected || !closeDay(expected, actual)) mismatches.push({ dayKey: row.dayKey, expected, actual })
    days.delete(row.dayKey)
  }
  for (const [dayKey, expected] of days) mismatches.push({ dayKey, expected, actual: null })
  return mismatches.sort((a, b) => a.dayKey.localeCompare(b.dayKey))
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
}

function closeDay(a: DayValues, b: DayValues): boolean {
  return close(a.salesTotal, b.salesTotal) && a.itemCount === b.itemCount &&
    a.sessionCount === b.sessionCount && close(a.expenseTotal, b.expenseTotal) &&
    a.expenseCount === b.expenseCount
}

// ─── categoryStats backfill + orphan cleanup ────────────────────────────────

/**
 * Recount categoryStats for one user from `sales` (own categories only; run
 * cleanOrphanCategoryIds first). Writes only rows that differ. Above
 * CATEGORY_BACKFILL_LIMIT categorised sales it leaves categoryCountsReady=false.
 */
export async function backfillCategoryStatsForUser(
  ctx: MutationCtx,
  userId: Id<'users'>,
): Promise<{ ready: boolean; writes: number }> {
  const categories = await ctx.db
    .query('categories')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect()
  const counts = new Map<Id<'categories'>, CategoryDelta>()
  let seen = 0
  for (const cat of categories) {
    const rows = await ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).eq('categoryId', cat._id))
      .take(CATEGORY_BACKFILL_LIMIT - seen + 1)
    seen += rows.length
    if (seen > CATEGORY_BACKFILL_LIMIT) {
      // Too big to recount in one transaction: make sure reads use the scan
      // (a previously-ready user must not keep serving possibly stale counts).
      const state = await getTotalsState(ctx, userId)
      if (state?.categoryCountsReady) {
        await ctx.db.patch('totalsState', state._id, { categoryCountsReady: false })
        return { ready: false, writes: 1 }
      }
      return { ready: false, writes: 0 }
    }
    let totalAmount = 0
    for (const r of rows) totalAmount += safe(r.amount)
    counts.set(cat._id, { saleCount: rows.length, totalAmount })
  }

  let writes = 0
  for (const [categoryId, value] of counts) {
    if (await setCategoryStats(ctx, userId, categoryId, value)) writes++
  }
  const statsRows = await ctx.db
    .query('categoryStats')
    .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId))
    .collect()
  for (const row of statsRows) {
    if (!counts.has(row.categoryId)) {
      await ctx.db.delete('categoryStats', row._id)
      writes++
    }
  }
  const state = await getOrCreateTotalsState(ctx, userId)
  if (!state.categoryCountsReady) {
    await ctx.db.patch('totalsState', state._id, { categoryCountsReady: true })
    writes++
  }
  return { ready: true, writes }
}

/** Max distinct categoryIds probed per user by the orphan skip-scan. */
export const MAX_CATEGORY_PROBES = 1000

/**
 * Distinct categoryIds referenced by the user's sales, via a skip-scan over
 * by_userId_categoryId (one `.first()` per distinct id; undefined sorts first
 * and is skipped by the `gt(undefined)` lower bound).
 */
export async function distinctSaleCategoryIds(
  ctx: ReadCtx,
  userId: Id<'users'>,
): Promise<Id<'categories'>[]> {
  const ids: Id<'categories'>[] = []
  let after: Id<'categories'> | undefined = undefined
  for (let i = 0; i < MAX_CATEGORY_PROBES; i++) {
    const lower: Id<'categories'> | undefined = after
    const row: Doc<'sales'> | null = await ctx.db
      .query('sales')
      .withIndex('by_userId_categoryId', (q) => q.eq('userId', userId).gt('categoryId', lower))
      .first()
    if (!row || row.categoryId === undefined) break
    ids.push(row.categoryId)
    after = row.categoryId
  }
  return ids
}