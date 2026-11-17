import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { getFunctionName, type FunctionReference } from 'convex/server'

type Call = { name: string; args: Record<string, unknown> | 'skip' }
const calls: Call[] = []
const setViewAs = vi.fn()
const showToast = vi.fn()

const USER = {
  _id: 'u1', name: 'Alice', email: 'a@example.com', createdAt: Date.parse('2026-10-01T10:00:00+05:00'),
  lastActivityAt: null, todaySales: 100, monthSales: 150, allTimeSales: 1719, totalsReady: true, partial: false,
}

const record = (ref: FunctionReference<'query'>, args: Record<string, unknown> | 'skip') => {
  calls.push({ name: getFunctionName(ref), args })
}

vi.mock('convex/react', () => ({
  useQuery: (ref: FunctionReference<'query'>, args: Record<string, unknown> | 'skip') => {
    record(ref, args)
    return undefined
  },
  useMutation: () => vi.fn(),
  useConvex: () => undefined,
}))
vi.mock('convex-helpers/react', () => ({
  usePaginatedQuery: (ref: FunctionReference<'query'>, args: Record<string, unknown> | 'skip') => {
    record(ref, args)
    return { results: [], status: 'LoadingFirstPage', loadMore: vi.fn(), isLoading: true }
  },
}))
vi.mock('@/hooks/useAdmin', () => ({ useAdminUser: () => USER }))
vi.mock('@/components/shared/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/context/ViewAsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/ViewAsContext')>()
  return { ...actual, useViewAs: () => ({ setViewAs }) }
})

import UserDetail from './UserDetail'

afterEach(() => {
  cleanup()
  calls.length = 0
  setViewAs.mockClear()
  showToast.mockClear()
})

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/u1']}>
      <Routes>
        <Route path="/admin/users/:userId" element={<UserDetail />} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const callsTo = (name: string) => calls.filter((c) => c.name === name && c.args !== 'skip')
const lastTo = (name: string) => callsTo(name).at(-1)?.args as Record<string, unknown> | undefined

describe('UserDetail', () => {
  it('shows the user header and reads their data with viewAsUserId', () => {
    renderDetail()
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeTruthy()
    expect(screen.getByText('a@example.com')).toBeTruthy()
    expect(screen.getByText('Never')).toBeTruthy()
    expect(lastTo('saleSessions:getStats')).toMatchObject({ viewAsUserId: 'u1' })
    expect(lastTo('saleSessions:getDayFeed')).toMatchObject({ viewAsUserId: 'u1' })
    expect(lastTo('categories:list')).toMatchObject({ viewAsUserId: 'u1' })
    // Every per-user read is scoped to the selected user.
    for (const c of calls) if (c.args !== 'skip') expect(c.args.viewAsUserId).toBe('u1')
  })

  it('period switching keeps viewAsUserId (daily ‹ ›, weekly, yearly)', () => {
    renderDetail()
    const before = lastTo('saleSessions:getStats')!.todayStart as number
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    const after = lastTo('saleSessions:getStats')!
    expect(after.todayStart).toBe(before - 86_400_000)
    expect(after.viewAsUserId).toBe('u1')

    fireEvent.click(screen.getByRole('tab', { name: /weekly/i }))
    expect(lastTo('saleSessions:getDailyTotals')).toMatchObject({ viewAsUserId: 'u1' })

    fireEvent.click(screen.getByRole('tab', { name: /yearly/i }))
    expect(lastTo('saleSessions:getYearlyMonthlyTotals')).toMatchObject({ viewAsUserId: 'u1' })
    expect(lastTo('saleSessions:getAvailableYears')).toMatchObject({ viewAsUserId: 'u1' })
  })

  it('"View as this user" enters impersonation and opens the dashboard', () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: /view as this user/i }))
    expect(setViewAs).toHaveBeenCalledWith('u1', 'Alice')
    expect(showToast).toHaveBeenCalledWith("Now viewing Alice's data (read-only)", 'info')
    expect(screen.getByText('dashboard page')).toBeTruthy()
  })
})
