import type { Category } from '@/hooks/useCategories'
import type { OutboxEntry } from '@/lib/offline/types'

/** Category name for a pending item: live / snapshot categories, else the name saved with the entry. */
export function pendingCategoryName(
  entry: OutboxEntry | undefined,
  categoryId: string | undefined,
  categories: readonly Category[],
): string | undefined {
  if (!categoryId) return undefined
  return categories.find((c) => c._id === categoryId)?.name ?? entry?.categoryLabels?.[categoryId]
}

/** Confirm text when signing out with entries still on this phone. */
export function unsyncedSignOutMessage(n: number): string {
  return n === 1
    ? "1 entry hasn't synced yet. Signing out now keeps it on this phone for your next sign-in."
    : `${n} entries haven't synced yet. Signing out now keeps them on this phone for your next sign-in.`
}

/** Short title for an entry: first product (+N more) or the expense note. */
export function pendingEntryTitle(entry: OutboxEntry): string {
  if (entry.kind === 'expense') return entry.args.note?.trim() || 'Expense'
  const [first, ...rest] = entry.args.items
  if (!first) return 'Sale'
  return rest.length > 0 ? `${first.productName} +${rest.length} more` : first.productName
}
