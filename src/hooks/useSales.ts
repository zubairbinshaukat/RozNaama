import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
} from '@/lib/utils'
import type { Id } from '../../convex/_generated/dataModel'

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
  topCategoryName: string | null
}

export type CategorySalesCount = {
  categoryId: Id<'categories'>
  count:      number
}

/** All sales in a category (for category detail modal) */
export function useSalesByCategoryId(categoryId: Id<'categories'> | null): SaleItem[] | undefined {
  return useQuery(
    api.sales.listByCategoryId,
    categoryId === null ? 'skip' : { categoryId },
  ) as SaleItem[] | undefined
}

/** Number of sale line items per category (for manage categories UI) */
export function useSalesCountsByCategory(): CategorySalesCount[] | undefined {
  return useQuery(api.sales.getCountsByCategory) as CategorySalesCount[] | undefined
}

/** Get sessions+items for today */
export function useTodaySessions(): SaleSession[] | undefined {
  return useQuery(api.saleSessions.getForDate, {
    startOfDay: startOfDay(),
    endOfDay:   endOfDay(),
  }) as SaleSession[] | undefined
}

/** Get sessions+items for the current month (for daily accordion history) */
export function useMonthSessions(): SaleSession[] | undefined {
  return useQuery(api.saleSessions.getSessionsForRange, {
    startDate: startOfMonth(),
    endDate:   endOfMonth(),
  }) as SaleSession[] | undefined
}

/** Get sessions+items for the current week (for weekly detailed list) */
export function useWeekSessions(): SaleSession[] | undefined {
  return useQuery(api.saleSessions.getSessionsForRange, {
    startDate: startOfWeek(),
    endDate:   endOfWeek(),
  }) as SaleSession[] | undefined
}

/** Get daily totals for the current week (for chart) */
export function useWeeklyTotals(): DailyTotal[] | undefined {
  return useQuery(api.saleSessions.getDailyTotals, {
    startDate: startOfWeek(),
    endDate:   endOfWeek(),
  }) as DailyTotal[] | undefined
}

/** Get daily totals for the current month (for chart) */
export function useMonthlyTotals(): DailyTotal[] | undefined {
  return useQuery(api.saleSessions.getDailyTotals, {
    startDate: startOfMonth(),
    endDate:   endOfMonth(),
  }) as DailyTotal[] | undefined
}

/** Get dashboard summary stats */
export function useDashboardStats(): DashboardStats | undefined {
  return useQuery(api.saleSessions.getStats, {
    todayStart:  startOfDay(),
    todayEnd:    endOfDay(),
    weekStart:   startOfWeek(),
    weekEnd:     endOfWeek(),
    monthStart:  startOfMonth(),
    monthEnd:    endOfMonth(),
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
