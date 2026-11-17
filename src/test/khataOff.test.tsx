/**
 * "Invisible when off" proof. These file snapshots were recorded on the code
 * BEFORE Advance & Udhaar existed; with khata switched off the same screens
 * must render byte-for-byte the same DOM (and run no khata query: the only
 * khata query, settings.get, lives in ShopSettingsProvider, which is replaced
 * here by its 'off' value).
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shared/Toast'
import type { DayGroup } from '@/lib/dayGroups'
import { ShopSettingsContext, type ShopSettingsContextValue } from '@/hooks/useShopSettings'
import { DEFAULT_SHOP_SETTINGS } from '@/lib/khata'
import type { Id } from '../../convex/_generated/dataModel'

// ── mocks shared by all screens ─────────────────────────────────────────────
const convexMocks = vi.hoisted(() => ({ useQuery: vi.fn(), usePaginatedQuery: vi.fn() }))
vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
  usePaginatedQuery: convexMocks.usePaginatedQuery,
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}))
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: { id: 'user_a', fullName: 'Ali Khan' }, isSignedIn: true, isLoaded: true }),
}))
vi.mock('@/hooks/useSubmitEntry', () => ({
  useSubmitEntry: () => ({ submitSale: vi.fn(), submitExpense: vi.fn() }),
}))
vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => [{ _id: 'cat_drinks', userId: 'u1', name: 'Drinks', color: '#3b82f6', createdAt: 1 }],
}))
vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: false, browserOnline: true }),
  useBrowserOnline: () => true,
}))
vi.mock('@/hooks/useOutbox', () => ({
  useOutbox: () => ({
    entries: [], pendingCount: 0, needsAttentionCount: 0, paused: null, loaded: true,
    isSending: () => false, getEntry: () => undefined, discard: vi.fn(), fixSaveForToday: vi.fn(),
    fixWithoutCategory: vi.fn(), retryNow: vi.fn(), retryEntry: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSales', () => ({
  useDeleteSaleItem: () => vi.fn(),
  useUpdateSaleItem: () => vi.fn(),
}))
vi.mock('@/hooks/useExpenses', () => ({
  useDeleteExpenseItem: () => vi.fn(),
  useUpdateExpenseItem: () => vi.fn(),
}))
vi.mock('@/context/ViewAsContext', () => ({
  useIsViewingOtherSafe: () => false,
  useViewAsUserIdForQuery: () => undefined,
  useViewAs: () => ({
    isViewingOther: false, viewAsName: null, viewAsUserId: null, isAdmin: false,
    handleViewAsInvalid: vi.fn(), clearViewAs: vi.fn(), setViewAs: vi.fn(),
    viewAsUserIdForQuery: undefined, isResolvingViewAs: false,
  }),
}))
// Dashboard children with their own queries (unchanged by khata) are stubbed.
vi.mock('@/components/dashboard/PeriodSummary', () => ({ default: () => <div data-testid="period-summary" /> }))
vi.mock('@/components/dashboard/DailyTab', () => ({ default: () => <div data-testid="daily-tab" /> }))
vi.mock('@/components/dashboard/AccountMenu', () => ({ default: () => <button type="button">Account</button> }))
vi.mock('@/components/shared/ThemeSwitcher', () => ({ default: () => <span data-testid="theme" /> }))
vi.mock('@/components/shared/DataFreshnessChip', () => ({ default: () => null }))

import AddSaleModal from '@/components/modals/AddSaleModal'
import FAB from '@/components/shared/FAB'
import SalesList from '@/components/dashboard/SalesList'
import Dashboard from '@/pages/Dashboard'

/** The app state "khata off": settings loaded live from the server, khataEnabled false. */
const OFF: ShopSettingsContextValue = {
  settings: DEFAULT_SHOP_SETTINGS, isLoading: false, khataOn: false, isLive: true, viewAsUserId: undefined,
}
function Off({ children }: { children: ReactNode }) {
  return <ShopSettingsContext.Provider value={OFF}>{children}</ShopSettingsContext.Provider>
}

let uuid = 0
beforeEach(() => {
  uuid = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-12T10:00:00+05:00'))
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`)
  window.localStorage.clear()
})
afterEach(() => {
  // No khata query (or any other live query) mounted by these screens when off.
  expect(convexMocks.useQuery).not.toHaveBeenCalled()
  expect(convexMocks.usePaginatedQuery).not.toHaveBeenCalled()
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const USER = 'u1' as Id<'users'>
const DAY: DayGroup = {
  dateKey: '2026-03-12', dateLabel: 'Today', salesTotal: 1500, expenseTotal: 200, net: 1300,
  saleCount: 1, expenseCount: 1,
  items: [{
    _id: 's1' as Id<'sales'>, userId: USER, sessionId: 'ss1' as Id<'saleSessions'>,
    productName: 'Chai', amount: 1500, saleDate: 1, createdAt: 1,
  }],
  expenses: [{ _id: 'e1' as Id<'expenses'>, userId: USER, amount: 200, note: 'Ice', expenseDate: 1, createdAt: 1 }],
}

describe('khata off: screens are unchanged', () => {
  it('Add Sale', () => {
    render(<ToastProvider><Off><AddSaleModal onClose={() => {}} /></Off></ToastProvider>)
    expect(document.body.innerHTML).toMatchSnapshot()
  })

  it('FAB menu', () => {
    const { container } = render(
      <Off>
        <FAB onAddCategory={() => {}} onAddSale={() => {}} onAddExpense={() => {}} onManageCategories={() => {}} />
      </Off>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add new' }))
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('SalesList', () => {
    const { container } = render(<ToastProvider><Off><SalesList days={[DAY]} categories={[]} expandAll /></Off></ToastProvider>)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('Dashboard', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider><Off><Dashboard /></Off></ToastProvider>
      </MemoryRouter>,
    )
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Add new' }))
    expect(container.innerHTML).toMatchSnapshot()
  })
})
