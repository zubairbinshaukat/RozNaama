import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConvexError } from 'convex/values'

type ClerkStatus = 'loading' | 'ready' | 'degraded' | 'error'

const auth = {
  isLoaded: false,
  isSignedIn: undefined as boolean | undefined,
  status: 'loading' as ClerkStatus,
  convexAuthenticated: false,
}
const clerkUser = {
  id: 'user_1',
  fullName: 'Ali Khan',
  firstName: 'Ali',
  primaryEmailAddress: { emailAddress: 'ali@example.com' },
}
const upsertUser = vi.fn<(args: unknown) => Promise<unknown>>()

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
  useClerk: () => ({ status: auth.status }),
  useUser: () => ({ user: auth.isLoaded && auth.isSignedIn ? clerkUser : null }),
}))
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: auth.convexAuthenticated, isLoading: false }),
  useMutation: () => upsertUser,
}))

import { useContext } from 'react'
import ProtectedRoute from './ProtectedRoute'
import { isUserSynced, markUserSynced } from '@/lib/userHints'
import { DataReadyContext, SnapshotContext, type SnapshotContextValue } from '@/lib/offline/context'
import type { SnapshotRecord } from '@/lib/offline/snapshotTypes'

let online = true

function DashboardProbe() {
  const mode = useContext(DataReadyContext)
  return <p>dashboard content ({mode})</p>
}

function renderGuard(snapshot: SnapshotContextValue | null = null) {
  return render(
    <SnapshotContext.Provider value={snapshot}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/sign-in" element={<p>sign-in page</p>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <p>dashboard content</p>
                <DashboardProbe />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </SnapshotContext.Provider>,
  )
}

function snap(owner: string, opts: { record?: boolean; loaded?: boolean } = {}): SnapshotContextValue {
  const { record = true, loaded = true } = opts
  return {
    owner,
    ownerSource: 'hint',
    record: record ? ({ owner } as SnapshotRecord) : null,
    loaded,
  }
}

function signIn() {
  auth.isLoaded = true
  auth.isSignedIn = true
  auth.status = 'ready'
  auth.convexAuthenticated = true
}

beforeEach(() => {
  online = true
  auth.isLoaded = false
  auth.isSignedIn = undefined
  auth.status = 'loading'
  auth.convexAuthenticated = false
  upsertUser.mockReset()
  localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const offlineCopy = 'Connect to the internet to sign in.'

describe('ProtectedRoute — Clerk not loaded', () => {
  it('shows the loading screen while online', () => {
    renderGuard()
    expect(screen.getByText('Signing you in…')).toBeTruthy()
  })

  it('shows the offline screen with Retry when offline (no endless spinner)', () => {
    online = false
    renderGuard()
    expect(screen.getByText('You’re offline.')).toBeTruthy()
    expect(screen.getByText(offlineCopy)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('gives up when clerk-js failed to load (status "error")', () => {
    auth.status = 'error'
    renderGuard()
    expect(screen.getByRole('alert').textContent).toContain('Can’t connect right now.')
  })

  it('gives up after 8s of loading', () => {
    vi.useFakeTimers()
    renderGuard()
    act(() => { vi.advanceTimersByTime(7999) })
    expect(screen.getByText('Signing you in…')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})

describe('ProtectedRoute — signed out', () => {
  it('redirects to /sign-in when online', () => {
    auth.isLoaded = true
    auth.isSignedIn = false
    auth.status = 'ready'
    renderGuard()
    expect(screen.getByText('sign-in page')).toBeTruthy()
  })

  it('does NOT redirect while offline (sign-out cannot be confirmed)', () => {
    online = false
    auth.isLoaded = true
    auth.isSignedIn = false
    auth.status = 'ready'
    renderGuard()
    expect(screen.queryByText('sign-in page')).toBeNull()
    expect(screen.getByText(offlineCopy)).toBeTruthy()
  })
})

describe('ProtectedRoute — user sync', () => {
  it('first login blocks until the upsert succeeds, then sets the synced flag', async () => {
    signIn()
    let resolve!: () => void
    upsertUser.mockImplementation(() => new Promise<void>((r) => { resolve = r }))
    renderGuard()
    expect(screen.getByText('Setting up your account…')).toBeTruthy()
    expect(screen.queryByText('dashboard content')).toBeNull()

    await act(async () => { resolve() })
    expect(screen.getByText('dashboard content')).toBeTruthy()
    expect(isUserSynced('user_1')).toBe(true)
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ali Khan', email: 'ali@example.com' }),
    )
  })

  it('already-synced user renders at once and upserts in the background', () => {
    signIn()
    markUserSynced('user_1')
    upsertUser.mockImplementation(() => new Promise(() => {}))
    renderGuard()
    expect(screen.getByText('dashboard content')).toBeTruthy()
    expect(upsertUser).toHaveBeenCalledTimes(1)
  })

  it('background ConvexError shows the error screen and clears the flag', async () => {
    signIn()
    markUserSynced('user_1')
    upsertUser.mockRejectedValue(new ConvexError({ code: 'FORBIDDEN', message: 'Linked to another account' }))
    renderGuard()
    expect(await screen.findByText('Linked to another account')).toBeTruthy()
    expect(screen.queryByText('dashboard content')).toBeNull()
    expect(isUserSynced('user_1')).toBe(false)
  })

  it('background transient failure keeps the app usable', async () => {
    vi.useFakeTimers()
    signIn()
    markUserSynced('user_1')
    upsertUser.mockRejectedValue(new Error('network down'))
    renderGuard()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(upsertUser).toHaveBeenCalledTimes(4) // 1 try + 3 retries
    expect(screen.getByText('dashboard content')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('first-login transient failure (after retries) shows the error screen', async () => {
    vi.useFakeTimers()
    signIn()
    upsertUser.mockRejectedValue(new Error('network down'))
    renderGuard()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(screen.getByRole('alert').textContent).toContain('couldn')
    expect(isUserSynced('user_1')).toBe(false)
  })

  it('signed in but offline before Convex auth → offline screen, not a spinner', () => {
    online = false
    signIn()
    auth.convexAuthenticated = false
    renderGuard()
    expect(screen.getByText(offlineCopy)).toBeTruthy()
  })

  it('ready → children with live data', () => {
    signIn()
    markUserSynced('user_1')
    upsertUser.mockImplementation(() => new Promise(() => {}))
    renderGuard(snap('user_1'))
    expect(screen.getByText('dashboard content (ready)')).toBeTruthy()
  })
})

describe('ProtectedRoute — snapshot mode (last user on this phone)', () => {
  it('Clerk still loading + snapshot → dashboard at once, live queries off', () => {
    renderGuard(snap('user_1'))
    expect(screen.getByText('dashboard content (snapshot)')).toBeTruthy()
    expect(screen.queryByText('Signing you in…')).toBeNull()
  })

  it('offline + snapshot → dashboard instead of the offline screen', () => {
    online = false
    renderGuard(snap('user_1'))
    expect(screen.getByText('dashboard content (snapshot)')).toBeTruthy()
    expect(screen.queryByText(offlineCopy)).toBeNull()
  })

  it('offline + hint but nothing saved → offline screen', () => {
    online = false
    renderGuard(snap('user_1', { record: false }))
    expect(screen.getByText(offlineCopy)).toBeTruthy()
  })

  it('offline while the snapshot is still being read → loading, then the dashboard', () => {
    online = false
    const view = renderGuard(snap('user_1', { record: false, loaded: false }))
    expect(screen.getByText('Signing you in…')).toBeTruthy()
    view.rerender(
      <SnapshotContext.Provider value={snap('user_1')}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<ProtectedRoute><DashboardProbe /></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </SnapshotContext.Provider>,
    )
    expect(screen.getByText('dashboard content (snapshot)')).toBeTruthy()
  })

  it('signed out while offline + snapshot → dashboard with the sign-in note, no redirect', () => {
    online = false
    auth.isLoaded = true
    auth.isSignedIn = false
    auth.status = 'ready'
    renderGuard(snap('user_1'))
    expect(screen.getByText('dashboard content (snapshot)')).toBeTruthy()
    expect(screen.getByText(/Sign-in will be checked when you.re back online/)).toBeTruthy()
    expect(screen.queryByText('sign-in page')).toBeNull()
  })

  it('signed out online → /sign-in even with a snapshot', () => {
    auth.isLoaded = true
    auth.isSignedIn = false
    auth.status = 'ready'
    renderGuard(snap('user_1'))
    expect(screen.getByText('sign-in page')).toBeTruthy()
  })

  it('signed in, Convex connecting + own snapshot → keeps the dashboard (no spinner)', () => {
    signIn()
    auth.convexAuthenticated = false
    renderGuard(snap('user_1'))
    expect(screen.getByText('dashboard content (snapshot)')).toBeTruthy()
  })

  it("never shows another user's snapshot to the signed-in Clerk user", () => {
    signIn()
    auth.convexAuthenticated = false
    renderGuard(snap('someone_else'))
    expect(screen.queryByText(/dashboard content/)).toBeNull()
    expect(screen.getByText('Connecting…')).toBeTruthy()
  })
})
