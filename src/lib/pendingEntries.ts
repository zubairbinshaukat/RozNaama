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

/** Subtitle of the pending sheet: "Sale · not synced yet". */
export function pendingEntryKindLabel(entry: OutboxEntry): string {
  switch (entry.kind) {
    case 'sale': return 'Sale'
    case 'expense': return 'Expense'
    case 'khataSale': return 'Udhaar sale'
    case 'khataAdvance': return 'Advance'
    case 'khataPayment': return 'Payment received'
  }
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
  if (entry.kind === 'khataAdvance') return `Advance · ${entry.khata.customerName}`
  if (entry.kind === 'khataPayment') return `Received · ${entry.khata.customerName}`
  if (entry.kind === 'khataSale') return `Udhaar · ${entry.khata.customerName}`
  const [first, ...rest] = entry.args.items
  if (!first) return 'Sale'
  return rest.length > 0 ? `${first.productName} +${rest.length} more` : first.productName
}
