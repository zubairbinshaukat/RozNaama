/**
 * Advance & Udhaar (Khata) data hooks. Every query is 'skip'ped while khata
 * is off or in snapshot-only mode (`useKhataQueriesEnabled`), and all are
 * view-as aware. Mount them only in components that render when khata is on.
 */
import { useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { usePaginatedQuery } from 'convex-helpers/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useViewAsQueryPatch } from './viewAsPatch'
import { useKhataQueriesEnabled } from './useShopSettings'
import { usePendingOverlay } from './offlineData'
import { CUSTOMER_SEARCH_MAX, type KhataBadge, type KhataSegment } from '@/lib/khata'
import { isKhataEntry, type KhataOutboxEntry } from '@/lib/offline/types'

/** Open balances: Udhaar owed to you (due) and advances you hold (booked). */
export function useKhataTotals() {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  return useQuery(api.khata.getTotals, on ? { ...va } : 'skip')
}

/** Open records of one segment, newest first. */
export function useKhataOpenList(segment: KhataSegment, pageSize = 20) {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  return usePaginatedQuery(api.khata.listOpen, on ? { segment, ...va } : 'skip', { initialNumItems: pageSize })
}

/** Customer picker: name-prefix search, or the most recent customers when `search` is empty. */
export function useCustomerSearch(search: string, limit: number = CUSTOMER_SEARCH_MAX) {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  const s = search.trim()
  return useQuery(api.khata.searchCustomers, on ? { ...(s ? { search: s } : {}), limit, ...va } : 'skip')
}

/** One customer with their records and payments (null when missing). */
export function useCustomerDetail(customerId: Id<'customers'> | null) {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  return useQuery(api.khata.customerDetail, on && customerId ? { customerId, ...va } : 'skip')
}

/** Money received from customers between two instants (payments only). */
export function useKhataReceivedInRange(startDate: number, endDate: number) {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  return useQuery(api.khata.receivedInRange, on ? { startDate, endDate, ...va } : 'skip')
}

/** Badges for the day list, keyed by sale session id. */
export function useKhataBadges(startDate: number | null, endDate: number | null): Map<string, KhataBadge> | undefined {
  const on = useKhataQueriesEnabled()
  const va = useViewAsQueryPatch()
  const rows = useQuery(
    api.khata.badgesForRange,
    on && startDate !== null && endDate !== null ? { startDate, endDate, ...va } : 'skip',
  )
  return useMemo(() => (rows ? new Map(rows.map((b) => [b.saleSessionId as string, b])) : undefined), [rows])
}

/** Khata entries waiting in this phone's outbox ([] in view-as). */
export function usePendingKhata(): KhataOutboxEntry[] {
  const pending = usePendingOverlay()
  return useMemo(() => pending.filter(isKhataEntry), [pending])
}

/** Online-only khata actions (complete, cancel, forgive, edit, delete, customers, settings). */
export function useKhataActions() {
  return {
    completeAdvance:  useMutation(api.khata.completeAdvance),
    cancelAdvance:    useMutation(api.khata.cancelAdvance),
    forgiveRemaining: useMutation(api.khata.forgiveRemaining),
    updateEntry:      useMutation(api.khata.updateEntry),
    removePayment:    useMutation(api.khata.removePayment),
    removeEntry:      useMutation(api.khata.removeEntry),
    updateCustomer:   useMutation(api.khata.updateCustomer),
    archiveCustomer:  useMutation(api.khata.archiveCustomer),
  }
}

export function useUpdateShopSettings() {
  return useMutation(api.settings.update)
}
