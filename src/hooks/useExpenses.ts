import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from '@/lib/utils'
import { startOfYear, endOfYear } from '@/lib/utils'
import type { Id } from '../../convex/_generated/dataModel'

export type ExpenseEntry = {
  _id:         Id<'expenses'>
  userId:      Id<'users'>
  amount:      number
  note?:       string
  expenseDate: number
  createdAt:   number
}

export function useExpensesForRange(startDate: number, endDate: number): ExpenseEntry[] | undefined {
  return useQuery(api.expenses.getForRange, { startDate, endDate }) as ExpenseEntry[] | undefined
}

export function useTodayExpenses(): ExpenseEntry[] | undefined {
  return useExpensesForRange(startOfDay(), endOfDay())
}

export function useWeekExpenses(): ExpenseEntry[] | undefined {
  return useExpensesForRange(startOfWeek(), endOfWeek())
}

export function useMonthExpenses(): ExpenseEntry[] | undefined {
  return useExpensesForRange(startOfMonth(), endOfMonth())
}

/** Get all-time expenses (paginated, newest first). */
export function usePaginatedExpenses(initialNumItems = 20) {
  return usePaginatedQuery(
    api.expenses.getPaginated,
    {},
    { initialNumItems }
  )
}

/** Get expenses for custom range (paginated, newest first). */
export function usePaginatedExpensesForRange(startDate: number, endDate: number, initialNumItems = 20) {
  return usePaginatedQuery(
    api.expenses.getForRangePaginated,
    { startDate, endDate },
    { initialNumItems }
  )
}

/** Convenience: paginated expenses for selected year. */
export function usePaginatedYearExpenses(year: number, initialNumItems = 20) {
  const date = new Date(year, 0, 1)
  return usePaginatedExpensesForRange(startOfYear(date), endOfYear(date), initialNumItems)
}

/** Record a new expense entry */
export function useRecordExpense() {
  return useMutation(api.expenses.record)
}

/** Update one expense entry */
export function useUpdateExpenseItem() {
  return useMutation(api.expenses.updateItem)
}

/** Delete one expense entry */
export function useDeleteExpenseItem() {
  return useMutation(api.expenses.removeItem)
}

