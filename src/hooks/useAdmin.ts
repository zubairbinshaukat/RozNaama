import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useMutation, useQuery } from 'convex/react'
import { usePaginatedQuery } from 'convex-helpers/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { getClientTimeZone } from '@/lib/utils'
import { readWatchlist, writeWatchlist } from '@/lib/admin'

export type AdminUserRow = FunctionReturnType<typeof api.admin.listUsers>['page'][number]
export type WatchSummary = FunctionReturnType<typeof api.admin.watchSummaries>[number]
export type AdminShopSettings = NonNullable<FunctionReturnType<typeof api.admin.getUserSettings>>
export type ServerUserSort = 'newest' | 'oldest' | 'name'

/** Users per overview page (server max 40). */
export const OVERVIEW_PAGE = 40
/** Users per list page (server max 25). */
export const USERS_PAGE = 20

export type PlatformOverview = {
  users:         number
  activeToday:   number
  active7d:      number
  active30d:     number
  todaySales:    number
  todayExpenses: number
  monthSales:    number
  monthExpenses: number
  newThisMonth:  number
  /** Users counted from a capped scan: their numbers are lower bounds. */
  partialUsers:  number
}

export type OverviewState = {
  /** Sums over every page loaded so far; undefined until the first page. */
  overview: PlatformOverview | undefined
  /** More pages are still loading (numbers will grow). */
  counting: boolean
}

/**
 * Platform KPIs: `admin.overview` pages over all users (one row each); this
 * loads every page and sums them, so any user count stays within the
 * per-query read budget.
 */
export function useAdminOverview(): OverviewState {
  const args = useMemo(() => ({ timeZone: getClientTimeZone() }), [])
  const { results, status, loadMore } = usePaginatedQuery(api.admin.overview, args, { initialNumItems: OVERVIEW_PAGE })

  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(OVERVIEW_PAGE)
  }, [status, loadMore])

  const overview = useMemo((): PlatformOverview | undefined => {
    if (status === 'LoadingFirstPage') return undefined
    const sum: PlatformOverview = {
      users: 0, activeToday: 0, active7d: 0, active30d: 0, todaySales: 0, todayExpenses: 0,
      monthSales: 0, monthExpenses: 0, newThisMonth: 0, partialUsers: 0,
    }
    for (const r of results) {
      sum.users++
      if (r.activeToday) sum.activeToday++
      if (r.active7d) sum.active7d++
      if (r.active30d) sum.active30d++
      if (r.newThisMonth) sum.newThisMonth++
      if (r.partial) sum.partialUsers++
      sum.todaySales += r.todaySales
      sum.todayExpenses += r.todayExpenses
      sum.monthSales += r.monthSales
      sum.monthExpenses += r.monthExpenses
    }
    return sum
  }, [results, status])

  return { overview, counting: status !== 'Exhausted' }
}

/** Paginated users (server search + server order), USERS_PAGE per "Show More". */
export function useAdminUsers(search: string, sort: ServerUserSort) {
  const args = useMemo(() => {
    const s = search.trim()
    return { timeZone: getClientTimeZone(), sort, ...(s.length > 0 ? { search: s } : {}) }
  }, [search, sort])
  return usePaginatedQuery(api.admin.listUsers, args, { initialNumItems: USERS_PAGE })
}

/** One user's header row; undefined while loading, null when gone. */
export function useAdminUser(userId: string): AdminUserRow | null | undefined {
  return useQuery(api.admin.getUser, { userId, timeZone: getClientTimeZone() })
}

export type Watchlist = {
  ids: string[]
  save: (ids: readonly string[]) => void
}

/** The signed-in admin's watchlist (localStorage, keyed by Clerk user id). */
export function useWatchlist(): Watchlist {
  const { userId } = useAuth()
  const owner = userId ?? ''
  const [state, setState] = useState(() => ({ owner, ids: owner ? readWatchlist(owner) : [] }))
  // Another Clerk account on this device: load its own list.
  if (state.owner !== owner) setState({ owner, ids: owner ? readWatchlist(owner) : [] })
  const save = useCallback((ids: readonly string[]) => {
    if (owner) writeWatchlist(owner, ids)
    setState({ owner, ids: [...ids] })
  }, [owner])
  return { ids: state.owner === owner ? state.ids : [], save }
}

/** Watchlist cards (admin.watchSummaries); [] without a query when nothing is chosen. */
export function useWatchSummaries(ids: readonly string[]): WatchSummary[] | undefined {
  const key = ids.join(',')
  const args = useMemo(
    () => (key ? { userIds: key.split(','), timeZone: getClientTimeZone() } : 'skip' as const),
    [key],
  )
  const rows = useQuery(api.admin.watchSummaries, args)
  return key ? rows : []
}
/** A user's shop settings (Khata); undefined while loading, null when the user is gone. */
export function useAdminUserSettings(userId: string): AdminShopSettings | null | undefined {
  return useQuery(api.admin.getUserSettings, { userId })
}

/** Change a user's shop settings for them (admin.setUserSettings; online only). */
export function useSetAdminUserSettings() {
  return useMutation(api.admin.setUserSettings)
}