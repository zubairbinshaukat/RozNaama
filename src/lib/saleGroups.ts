import { formatDate, toLocalDateKey } from '@/lib/utils'
import type { SaleItem } from '@/hooks/useSales'

export type SaleDayGroup = {
  dateKey:   string
  dateLabel: string
  items:     SaleItem[]
}

/** Group flat sale line items by calendar day, newest days first. */
export function groupSaleItemsByDay(items: SaleItem[]): SaleDayGroup[] {
  const map = new Map<string, SaleItem[]>()

  for (const item of items) {
    const key = toLocalDateKey(item.saleDate)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }

  for (const arr of map.values()) {
    arr.sort((a, b) => a.createdAt - b.createdAt)
  }

  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, dayItems]) => ({
      dateKey,
      dateLabel: formatDate(dayItems[0]!.saleDate),
      items:     dayItems,
    }))
}
