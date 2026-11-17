import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useViewAsQueryPatch } from '@/hooks/viewAsPatch'
import { useLiveQueriesEnabled } from '@/hooks/offlineData'
import type { Id } from '../../convex/_generated/dataModel'

export type CategorySummary = {
  count:       number
  totalAmount: number
}

/** Sales in a category, newest saleDate first, loaded page by page. */
export function useCategorySalesPaginated(categoryId: Id<'categories'> | null, pageSize = 20) {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  return usePaginatedQuery(
    api.sales.listByCategoryIdPaginated,
    categoryId === null || !ready ? 'skip' : { categoryId, ...va },
    { initialNumItems: pageSize },
  )
}

/** Count and total amount of all sales in a category (server-side, not page-limited). */
export function useCategorySummary(categoryId: Id<'categories'> | null): CategorySummary | undefined {
  const va = useViewAsQueryPatch()
  const ready = useLiveQueriesEnabled()
  return useQuery(
    api.sales.getCategorySummary,
    categoryId === null || !ready ? 'skip' : { categoryId, ...va },
  )
}
