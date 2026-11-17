import { formatDate } from '@/lib/utils'
import type { DayFeedEntry } from '@/hooks/useDayFeed'
import type { SaleItem } from '@/hooks/useSales'
import type { ExpenseEntry } from '@/hooks/useExpenses'

/** One day card in the dashboard lists. Header totals come from the server. */
export type DayGroup = {
  dateKey:      string
  dateLabel:    string
  salesTotal:   number
  expenseTotal: number
  net:          number
  saleCount:    number
  expenseCount: number
  items:        SaleItem[]
  expenses:     ExpenseEntry[]
}

/** Local-midnight ms for a 'YYYY-MM-DD' key (for `formatDate` labels). NaN if malformed. */
export function dateKeyToLocalMs(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function labelFor(key: string): string {
  const ms = dateKeyToLocalMs(key)
  return Number.isFinite(ms) ? formatDate(ms) : key
}

/**
 * Day feed entries → day groups (newest day first). Totals and counts are the
 * server's values (not re-summed from loaded items); items and expenses are
 * oldest-first within the day, like the previous client-side grouping.
 * A day repeated across pages (transient while pages re-bind) is kept once.
 */
export function toDayGroups(entries: readonly DayFeedEntry[]): DayGroup[] {
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    if (seen.has(e.date)) return false
    seen.add(e.date)
    return true
  })
  const groups = unique.map((entry): DayGroup => {
    const items: SaleItem[] = entry.sessions.flatMap((s) => s.items)
    items.sort((a, b) => a.createdAt - b.createdAt)
    const expenses: ExpenseEntry[] = [...entry.expenses]
    expenses.sort((a, b) => a.createdAt - b.createdAt)
    return {
      dateKey:      entry.date,
      dateLabel:    labelFor(entry.date),
      salesTotal:   entry.salesTotal,
      expenseTotal: entry.expenseTotal,
      net:          entry.salesTotal - entry.expenseTotal,
      saleCount:    entry.saleCount,
      expenseCount: entry.expenseCount,
      items,
      expenses,
    }
  })
  return groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}
