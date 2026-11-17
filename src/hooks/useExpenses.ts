import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

export type ExpenseEntry = {
  _id:         Id<'expenses'>
  userId:      Id<'users'>
  amount:      number
  note?:       string
  expenseDate: number
  createdAt:   number
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
