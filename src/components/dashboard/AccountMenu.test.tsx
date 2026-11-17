import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AccountMenu from './AccountMenu'

const signOut = vi.fn(async () => {})
const openUserProfile = vi.fn()
const state = { pendingCount: 0, online: true, isAdmin: false }

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({
    isLoaded: true,
    user: { id: 'user_1', fullName: 'Ali Khan', firstName: 'Ali', imageUrl: '', primaryEmailAddress: { emailAddress: 'ali@example.com' } },
  }),
  useClerk: () => ({ signOut, openUserProfile }),
}))
vi.mock('@/hooks/useOutbox', () => ({
  useOutbox: () => ({ pendingCount: state.pendingCount }),
}))
vi.mock('@/hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ isAdmin: state.isAdmin, loading: false }),
}))
vi.mock('@/lib/network', () => ({
  useBrowserOnline: () => state.online,
}))
vi.mock('@/components/shared/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  signOut.mockClear()
  openUserProfile.mockClear()
  state.pendingCount = 0
  state.online = true
  state.isAdmin = false
})

function openMenu() {
  render(<AccountMenu />)
  fireEvent.click(screen.getByRole('button', { name: /^Account/ }))
  return screen.getByRole('dialog', { name: 'Ali Khan' })
}

describe('AccountMenu sign-out', () => {
  it('signs out at once when nothing is waiting', async () => {
    const sheet = openMenu()
    fireEvent.click(within(sheet).getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns first when entries have not synced; Cancel keeps the user signed in', () => {
    state.pendingCount = 2
    render(<AccountMenu />)
    expect(screen.getByRole('button', { name: 'Account, 2 not synced' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }))
    const sheet = screen.getByRole('dialog', { name: 'Ali Khan' })
    expect(within(sheet).getByText('2 entries are waiting to sync.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: /sign out/i }))

    const confirm = screen.getByRole('alertdialog', { name: 'Sign out?' })
    expect(confirm.textContent).toContain(
      "2 entries haven't synced yet. Signing out now keeps them on this phone for your next sign-in.",
    )
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('confirming signs out', async () => {
    state.pendingCount = 1
    const sheet = openMenu()
    fireEvent.click(within(sheet).getByRole('button', { name: /sign out/i }))
    const confirm = screen.getByRole('alertdialog', { name: 'Sign out?' })
    expect(confirm.textContent).toContain("1 entry hasn't synced yet.")
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it('offline: account actions are disabled with a short note', () => {
    state.online = false
    const sheet = openMenu()
    expect(within(sheet).getByText(/Connect to the internet/)).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: /sign out/i })).toHaveProperty('disabled', true)
    expect(within(sheet).getByRole('button', { name: /manage account/i })).toHaveProperty('disabled', true)
  })
})

describe('AccountMenu admin entry', () => {
  it('is hidden for non-admins (no router needed)', () => {
    const sheet = openMenu()
    expect(within(sheet).queryByRole('button', { name: /admin dashboard/i })).toBeNull()
  })

  it('admins get "Admin dashboard", which opens /admin', () => {
    state.isAdmin = true
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<AccountMenu />} />
          <Route path="/admin" element={<p>admin page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }))
    const sheet = screen.getByRole('dialog', { name: 'Ali Khan' })
    fireEvent.click(within(sheet).getByRole('button', { name: /admin dashboard/i }))
    expect(screen.getByText('admin page')).toBeTruthy()
  })
})