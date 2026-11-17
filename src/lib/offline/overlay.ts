/**
 * Optimistic overlay: pending outbox entries shown inside live / snapshot data
 * until they sync. Pure functions; the hooks decide when to apply them (own
 * data only — never in admin view-as).
 *
 * Synthetic ids: a sale session is `pending:<entryId>`, its items
 * `pending:<entryId>:<index>`, an expense `pending:<entryId>`. They are typed
 * as Convex ids for compatibility with existing row components; check
 * `isPendingId(row._id)` before using a row id with any Convex function.
 */
import type { Id } from '../../../convex/_generated/dataModel'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { DailyTotal, DashboardStats, SaleItem, YearlyMonthlyTotal } from '@/hooks/useSales'
import type { ExpenseEntry } from '@/hooks/useExpenses'
import type { StatsRanges } from '@/lib/period'
import { entryDateMs, entryExpenseTotal, entrySalesTotal, type OutboxEntry } from './types'

export const PENDING_ID_PREFIX = 'pending:'

/** True for synthetic rows built from outbox entries (not yet on the server). */
export function isPendingId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(PENDING_ID_PREFIX)
}

/** Outbox entry id behind a synthetic row id (`pending:<id>` or `pending:<id>:<i>`), else null. */
export function pendingEntryIdOf(rowId: string): string | null {
  if (!isPendingId(rowId)) return null
  const rest = rowId.slice(PENDING_ID_PREFIX.length)
  const colon = rest.indexOf(':')
  return colon === -1 ? rest : rest.slice(0, colon)
}

const PENDING_USER = `${PENDING_ID_PREFIX}user` as Id<'users'>

type DaySession = DayFeedEntry['sessions'][number]
type DayExpense = DayFeedEntry['expenses'][number]

function pendingSession(entry: OutboxEntry & { kind: 'sale' }): DaySession {
  const sessionId = `${PENDING_ID_PREFIX}${entry.id}` as Id<'saleSessions'>
  const items: SaleItem[] = entry.args.items.map((item, i) => ({
    _id:         `${PENDING_ID_PREFIX}${entry.id}:${i}` as Id<'sales'>,
    userId:      PENDING_USER,
    sessionId,
    ...(item.categoryId !== undefined ? { categoryId: item.categoryId } : {}),
    productName: item.productName,
    amount:      item.amount,
    ...(item.note !== undefined ? { note: item.note } : {}),
    saleDate:    entry.args.sessionDate,
    // Keeps pending rows after server rows of the same day (sorted by createdAt).
    createdAt:   entry.createdAt,
  }))
  return {
    _id:           sessionId,
    _creationTime: entry.createdAt,
    userId:        PENDING_USER,
    totalAmount:   entrySalesTotal(entry),
    itemCount:     items.length,
    sessionDate:   entry.args.sessionDate,
    createdAt:     entry.createdAt,
    items:         items as DaySession['items'],
  } as DaySession
}

function pendingExpense(entry: OutboxEntry & { kind: 'expense' }): DayExpense {
  const expense: ExpenseEntry & { _creationTime: number } = {
    _id:           `${PENDING_ID_PREFIX}${entry.id}` as Id<'expenses'>,
    _creationTime: entry.createdAt,
    userId:        PENDING_USER,
    amount:        entry.args.amount,
    ...(entry.args.note !== undefined ? { note: entry.args.note } : {}),
    expenseDate:   entry.args.expenseDate,
    createdAt:     entry.createdAt,
  }
  return expense as DayExpense
}

/** Ids of real rows already present, to drop a pending entry whose row arrived. */
function liveIds(entries: readonly DayFeedEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const e of entries) {
    for (const s of e.sessions) ids.add(s._id)
    for (const x of e.expenses) ids.add(x._id)
  }
  return ids
}

export type FeedOverlayOptions = {
  /** Inclusive local-day bounds (YYYY-MM-DD) of the feed; null = unbounded. */
  startKey: string | null
  endKey:   string | null
  /**
   * The whole range is loaded (feed exhausted). Otherwise only days on or
   * after the oldest loaded day get NEW day cards (older ones would appear
   * out of order above unloaded pages).
   */
  isDone:   boolean
}

/**
 * Merge pending entries into day feed entries (newest day first): synthetic
 * sessions / expenses are appended to their day (by `entry.dayKey`) and the
 * day's totals and counts include them. Entries outside the range — or older
 * than the loaded window — are left out.
 */
export function applyPendingToFeed(
  entries: readonly DayFeedEntry[],
  pending: readonly OutboxEntry[],
  { startKey, endKey, isDone }: FeedOverlayOptions,
): DayFeedEntry[] {
  if (pending.length === 0) return entries as DayFeedEntry[]
  const present = liveIds(entries)
  const oldestLoaded = entries.reduce<string | null>((min, e) => (min === null || e.date < min ? e.date : min), null)
  const byDay = new Map<string, DayFeedEntry>()
  for (const e of entries) if (!byDay.has(e.date)) byDay.set(e.date, e)
  let changed = false

  for (const entry of pending) {
    // A real row with the synthetic id can't exist; this guards double merges.
    if (present.has(`${PENDING_ID_PREFIX}${entry.id}`)) continue
    const day = entry.dayKey
    if (startKey !== null && day < startKey) continue
    if (endKey !== null && day > endKey) continue
    let target = byDay.get(day)
    if (!target) {
      if (!isDone && (oldestLoaded === null || day < oldestLoaded)) continue
      target = { date: day, salesTotal: 0, expenseTotal: 0, saleCount: 0, expenseCount: 0, sessions: [], expenses: [] }
    }
    if (entry.kind === 'sale') {
      target = {
        ...target,
        salesTotal: target.salesTotal + entrySalesTotal(entry),
        saleCount:  target.saleCount + entry.args.items.length,
        sessions:   [...target.sessions, pendingSession(entry)],
      }
    } else {
      target = {
        ...target,
        expenseTotal: target.expenseTotal + entryExpenseTotal(entry),
        expenseCount: target.expenseCount + 1,
        expenses:     [...target.expenses, pendingExpense(entry)],
      }
    }
    byDay.set(day, target)
    changed = true
  }
  if (!changed) return entries as DayFeedEntry[]
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

type Window = { start: number; end: number }
const within = (ms: number, w: Window) => ms >= w.start && ms <= w.end

/**
 * Add pending entries to dashboard stats for the periods they fall in
 * (by entry date): today / week / month by `ranges`, all-time always.
 * `topCategoryName` is left as the server computed it.
 */
export function applyPendingToStats(
  stats: DashboardStats,
  ranges: StatsRanges,
  pending: readonly OutboxEntry[],
): DashboardStats {
  if (pending.length === 0) return stats
  const next = { ...stats }
  const today = { start: ranges.todayStart, end: ranges.todayEnd }
  const week = { start: ranges.weekStart, end: ranges.weekEnd }
  const month = { start: ranges.monthStart, end: ranges.monthEnd }
  for (const entry of pending) {
    const at = entryDateMs(entry)
    const sales = entrySalesTotal(entry)
    const expense = entryExpenseTotal(entry)
    const items = entry.kind === 'sale' ? entry.args.items.length : 0
    const net = sales - expense
    if (within(at, today)) {
      next.todayTotal += sales
      next.todaySalesTotal += sales
      next.todayNetTotal += net
      next.todayCount += items
      if (entry.kind === 'expense') {
        next.todayExpenseTotal += expense
        next.todayExpenseCount += 1
      }
    }
    if (within(at, week)) {
      next.weekTotal += net
      next.weekCount += items
    }
    if (within(at, month)) {
      next.monthTotal += net
      next.monthCount += items
    }
    next.allTimeTotal += net
    next.allTimeCount += items
    next.allTimeSalesTotal += sales
    next.allTimeExpenseTotal += expense
  }
  return next
}

/** Add pending nets (sales − expenses) to `getDailyTotals` rows by day key (rows outside are ignored). */
export function applyPendingToDailyTotals(totals: readonly DailyTotal[], pending: readonly OutboxEntry[]): DailyTotal[] {
  if (pending.length === 0) return totals as DailyTotal[]
  const add = new Map<string, number>()
  for (const e of pending) add.set(e.dayKey, (add.get(e.dayKey) ?? 0) + entrySalesTotal(e) - entryExpenseTotal(e))
  if (!totals.some((t) => add.has(t.date))) return totals as DailyTotal[]
  return totals.map((t) => (add.has(t.date) ? { ...t, total: t.total + (add.get(t.date) ?? 0) } : t))
}

/** Add pending entries of `year` to yearly month rows (local month of the entry's day key). */
export function applyPendingToYearlyTotals(
  rows: readonly YearlyMonthlyTotal[],
  year: number,
  pending: readonly OutboxEntry[],
): YearlyMonthlyTotal[] {
  const relevant = pending.filter((e) => Number(e.dayKey.slice(0, 4)) === year)
  if (relevant.length === 0) return rows as YearlyMonthlyTotal[]
  const next = rows.map((r) => ({ ...r }))
  for (const e of relevant) {
    const monthIndex = Number(e.dayKey.slice(5, 7)) - 1
    const row = next.find((r) => r.monthIndex === monthIndex)
    if (!row) continue
    row.salesTotal += entrySalesTotal(e)
    row.netTotal += entrySalesTotal(e) - entryExpenseTotal(e)
  }
  return next
}
