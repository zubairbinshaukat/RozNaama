import { createContext, useContext } from 'react'

export type DashboardActions = {
  openAddSale:    () => void
  openAddExpense: () => void
}

/**
 * Lets deep components (empty states) open the dashboard's Add Sale / Add
 * Expense sheets. Null outside the dashboard (and in admin read-only mode).
 */
export const DashboardActionsContext = createContext<DashboardActions | null>(null)

export function useDashboardActions(): DashboardActions | null {
  return useContext(DashboardActionsContext)
}
