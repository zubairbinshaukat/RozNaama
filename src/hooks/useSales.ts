import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfYear, endOfYear,
  getClientTimeZone,
} from '@/lib/utils'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import type { Id } from '../../convex/_generated/dataModel'

function useViewAsQueryPatch(): { viewAsUserId: Id<'users'> } | Record<string, never> {
  const id = useViewAsUserIdForQuery()
  return id !== undefined ? { viewAsUserId: id } : {}
}

export type SaleItem = {
  _id:         Id<'sales'>
  userId:      Id<'users'>
  sessionId:   Id<'saleSessions'>
  categoryId?: Id<'categories'>
  productName: string
  amount:      number
  note?:       string
  saleDate:    number
  createdAt:   number
}

export type SaleSession = {
  _id:         Id<'saleSessions'>
  userId:      Id<'users'>
  totalAmount: number
  itemCount:   number
  sessionDate: number
  createdAt:   number
  items:       SaleItem[]
}

export type DailyTotal = {
  date:  string
  total: number
}

export type YearlyMonthlyTotal = {
  monthIndex: number
  salesTotal: number
  netTotal: number
}

export type DashboardStats = {
  todayTotal:      number
  todaySalesTotal: number
  todayNetTotal:   number
  todayCount:      number
  todayExpenseTotal: number
  todayExpenseCount: number
  weekTotal:       number
  weekCount:       number
  monthTotal:      number
  monthCount:      number
  allTimeTotal:    number
  allTimeCount:    number
  allTimeSalesTotal: number
  allTimeExpenseTotal: number
  topCategoryName: string | null
}

export type CategorySalesCount = {
  categoryId: Id<'categories'>
  count:      number
}

/** All sales in a category (for category detail modal) */
export function useSalesByCategoryId(categoryId: Id<'categories'> | null): SaleItem[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(
    api.sales.listByCategoryId,
    categoryId === null ? 'skip' : { categoryId, ...va },
  ) as SaleItem[] | undefined
}

/** Number of sale line items per category (for manage categories UI) */
export function useSalesCountsByCategory(): CategorySalesCount[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.sales.getCountsByCategory, { ...va }) as CategorySalesCount[] | undefined
}

/** Get sessions+items for today */
export function useTodaySessions(): SaleSession[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getForDate, {
    startOfDay: startOfDay(),
    endOfDay:   endOfDay(),
    ...va,
  }) as SaleSession[] | undefined
}

/** Get sessions+items for the current month (for daily accordion history) */
export function useMonthSessions(): SaleSession[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getSessionsForRange, {
    startDate: startOfMonth(),
    endDate:   endOfMonth(),
    ...va,
  }) as SaleSession[] | undefined
}

/** Get all-time sessions+items (paginated, newest first). */
export function usePaginatedSessions(initialNumItems = 20) {
  const va = useViewAsQueryPatch()
  return usePaginatedQuery(
    api.saleSessions.getSessionsPaginated,
    { ...va },
    { initialNumItems }
  )
}

/** Get sessions+items for a custom range (paginated, newest first). */
export function usePaginatedSessionsForRange(startDate: number, endDate: number, initialNumItems = 20) {
  const va = useViewAsQueryPatch()
  return usePaginatedQuery(
    api.saleSessions.getSessionsForRangePaginated,
    { startDate, endDate, ...va },
    { initialNumItems }
  )
}

/** Get sessions+items for the current week (for weekly detailed list) */
export function useWeekSessions(): SaleSession[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getSessionsForRange, {
    startDate: startOfWeek(),
    endDate:   endOfWeek(),
    ...va,
  }) as SaleSession[] | undefined
}

/** Get daily totals for the current week (for chart) */
export function useWeeklyTotals(): DailyTotal[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getDailyTotals, {
    startDate: startOfWeek(),
    endDate:   endOfWeek(),
    timeZone:  getClientTimeZone(),
    ...va,
  }) as DailyTotal[] | undefined
}

/** Get daily totals for the current month (for chart) */
export function useMonthlyTotals(): DailyTotal[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getDailyTotals, {
    startDate: startOfMonth(),
    endDate:   endOfMonth(),
    timeZone:  getClientTimeZone(),
    ...va,
  }) as DailyTotal[] | undefined
}

/** Get monthly totals for a specific year (for yearly chart). */
export function useYearlyMonthlyTotals(year: number): YearlyMonthlyTotal[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getYearlyMonthlyTotals, {
    year,
    timeZone: getClientTimeZone(),
    ...va,
  }) as YearlyMonthlyTotal[] | undefined
}

/** Convenience: paginated sessions for selected year. */
export function usePaginatedYearSessions(year: number, initialNumItems = 20) {
  const date = new Date(year, 0, 1)
  return usePaginatedSessionsForRange(startOfYear(date), endOfYear(date), initialNumItems)
}

/** Get available years for yearly chart picker. */
export function useAvailableYears(): number[] | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getAvailableYears, {
    timeZone: getClientTimeZone(),
    ...va,
  }) as number[] | undefined
}

/** Get dashboard summary stats */
export function useDashboardStats(): DashboardStats | undefined {
  const va = useViewAsQueryPatch()
  return useQuery(api.saleSessions.getStats, {
    todayStart:  startOfDay(),
    todayEnd:    endOfDay(),
    weekStart:   startOfWeek(),
    weekEnd:     endOfWeek(),
    monthStart:  startOfMonth(),
    monthEnd:    endOfMonth(),
    ...va,
  }) as DashboardStats | undefined
}

/** Record a new sale session atomically */
export function useRecordSales() {
  return useMutation(api.saleSessions.record)
}

/** Update a single sale item */
export function useUpdateSaleItem() {
  return useMutation(api.sales.updateItem)
}

/** Delete a single sale item */
export function useDeleteSaleItem() {
  return useMutation(api.sales.removeItem)
}
