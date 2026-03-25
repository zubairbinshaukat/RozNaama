import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from '@/lib/utils'
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

/** Record a new expense entry */
export function useRecordExpense() {
  return useMutation(api.expenses.record)
}

