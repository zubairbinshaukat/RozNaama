import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ToastProvider } from '@/components/shared/Toast'
import EditSaleModal from './EditSaleModal'
import EditExpenseModal from './EditExpenseModal'
import AddCategoryModal from './AddCategoryModal'
import type { Id } from '../../../convex/_generated/dataModel'

const net = { offline: true }
const updateItem = vi.fn()
const updateExpense = vi.fn()
const createCategory = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: { id: 'user_a' }, isSignedIn: true, isLoaded: true }),
}))
vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: net.offline, browserOnline: !net.offline }),
  useBrowserOnline: () => !net.offline,
}))
vi.mock('@/hooks/useSales', () => ({ useUpdateSaleItem: () => updateItem }))
vi.mock('@/hooks/useExpenses', () => ({ useUpdateExpenseItem: () => updateExpense }))
vi.mock('@/hooks/useCategories', () => ({ useCreateCategory: () => createCategory }))

afterEach(() => {
  cleanup()
  net.offline = true
})

const OFFLINE_EDIT = 'Editing needs internet. New sales and expenses still save offline.'
const USER = 'u1' as Id<'users'>

function renderIn(node: React.ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>)
}

describe('edit sheets while offline', () => {
  it('Edit sale: note shown, Save disabled', () => {
    renderIn(
      <EditSaleModal
        item={{
          _id: 's1' as Id<'sales'>, userId: USER, sessionId: 'ss1' as Id<'saleSessions'>,
          productName: 'Chai', amount: 50, saleDate: Date.now(), createdAt: Date.now(),
        }}
        categories={[]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(OFFLINE_EDIT)).toBeTruthy()
    expect(screen.getByRole('button', { name: /save changes/i })).toHaveProperty('disabled', true)
  })

  it('Edit expense: note shown, Save disabled', () => {
    renderIn(
      <EditExpenseModal
        expense={{ _id: 'e1' as Id<'expenses'>, userId: USER, amount: 20, expenseDate: Date.now(), createdAt: Date.now() }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(OFFLINE_EDIT)).toBeTruthy()
    expect(screen.getByRole('button', { name: /save changes/i })).toHaveProperty('disabled', true)
  })

  it('Add category: note shown, Save disabled', () => {
    renderIn(<AddCategoryModal onClose={vi.fn()} />)
    expect(screen.getByText(OFFLINE_EDIT)).toBeTruthy()
    expect(screen.getByRole('button', { name: /save category/i })).toHaveProperty('disabled', true)
  })

  it('online: no note, Save enabled', () => {
    net.offline = false
    renderIn(<AddCategoryModal onClose={vi.fn()} />)
    expect(screen.queryByText(OFFLINE_EDIT)).toBeNull()
    expect(screen.getByRole('button', { name: /save category/i })).toHaveProperty('disabled', false)
  })
})
