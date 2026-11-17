import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminGuard from './AdminGuard'

const access = { isAdmin: false, loading: true }
let online = true

vi.mock('@/hooks/useAdminAccess', () => ({ useAdminAccess: () => access }))
vi.mock('@/lib/network', () => ({ useBrowserOnline: () => online }))

afterEach(() => {
  cleanup()
  access.isAdmin = false
  access.loading = true
  online = true
})

const AdminPage = vi.fn(() => <p>admin page</p>)

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/dashboard" element={<p>dashboard page</p>} />
        <Route path="/admin/*" element={<AdminGuard><AdminPage /></AdminGuard>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminGuard', () => {
  it('waits for the server while loading (admin page not rendered)', () => {
    renderAt()
    expect(screen.getByText('Checking admin access…')).toBeTruthy()
    expect(AdminPage).not.toHaveBeenCalled()
  })

  it('offline while loading: explains and links back to the dashboard', () => {
    online = false
    renderAt()
    expect(screen.getByRole('alert').textContent).toContain('Connect to the internet')
    expect(screen.getByRole('link', { name: /back to dashboard/i }).getAttribute('href')).toBe('/dashboard')
  })

  it('non-admins are redirected to /dashboard', () => {
    access.loading = false
    renderAt()
    expect(screen.getByText('dashboard page')).toBeTruthy()
    expect(AdminPage).not.toHaveBeenCalled()
  })

  it('admins see the admin page', () => {
    access.loading = false
    access.isAdmin = true
    renderAt()
    expect(screen.getByText('admin page')).toBeTruthy()
  })
})
