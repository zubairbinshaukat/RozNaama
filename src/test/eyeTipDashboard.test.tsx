/** The one-time eye tip as wired into the dashboard (own data vs admin view-as). */
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shared/Toast'
import { ShopSettingsContext, type ShopSettingsContextValue } from '@/hooks/useShopSettings'
import { DEFAULT_SHOP_SETTINGS } from '@/lib/khata'

const viewAs = vi.hoisted(() => ({ isViewingOther: false }))

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}))
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: { id: 'user_a', fullName: 'Ali Khan' }, isSignedIn: true, isLoaded: true }),
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
vi.mock('@/context/ViewAsContext', () => ({
  useIsViewingOtherSafe: () => viewAs.isViewingOther,
  useViewAsUserIdForQuery: () => undefined,
  useViewAs: () => ({
    isViewingOther: viewAs.isViewingOther,
    viewAsName: viewAs.isViewingOther ? 'Bilal' : null,
    viewAsUserId: viewAs.isViewingOther ? 'u2' : null,
    isAdmin: false,
    handleViewAsInvalid: vi.fn(), clearViewAs: vi.fn(), setViewAs: vi.fn(),
    viewAsUserIdForQuery: undefined, isResolvingViewAs: false,
  }),
}))
// The summary reports "numbers on screen" at once; other children are stubbed.
vi.mock('@/components/dashboard/PeriodSummary', () => ({
  default: function PeriodSummaryStub({ onSettled }: { onSettled?: () => void }) {
    useEffect(() => { onSettled?.() }, [onSettled])
    return <div data-testid="period-summary" />
  },
}))
vi.mock('@/components/dashboard/DailyTab', () => ({ default: () => <div data-testid="daily-tab" /> }))
vi.mock('@/components/dashboard/AccountMenu', () => ({ default: () => <button type="button">Account</button> }))
vi.mock('@/components/shared/ThemeSwitcher', () => ({ default: () => <span data-testid="theme" /> }))
vi.mock('@/components/shared/DataFreshnessChip', () => ({ default: () => null }))

import Dashboard from '@/pages/Dashboard'

const OFF: ShopSettingsContextValue = {
  settings: DEFAULT_SHOP_SETTINGS, isLoading: false, khataOn: false, isLive: true, viewAsUserId: undefined,
}
function Wrap({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <ToastProvider>
        <ShopSettingsContext.Provider value={OFF}>{children}</ShopSettingsContext.Provider>
      </ToastProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  viewAs.isViewingOther = false
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('dashboard eye tip', () => {
  it('appears on the dashboard once the numbers are shown', async () => {
    render(<Wrap><Dashboard /></Wrap>)
    const tip = await screen.findByRole('dialog', { name: 'Your amounts are hidden' }, { timeout: 2000 })
    expect(tip).toBeTruthy()
    expect(localStorage.getItem('roznaama-tip-eye-v1:user_a')).not.toBeNull()
  })

  it('never appears while an admin views another user', async () => {
    viewAs.isViewingOther = true
    render(<Wrap><Dashboard /></Wrap>)
    await act(async () => { await new Promise((r) => setTimeout(r, 900)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem('roznaama-tip-eye-v1:user_a')).toBeNull()
  })
})
