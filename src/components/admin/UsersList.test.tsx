import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

type Row = {
  _id: string; name: string; email: string; createdAt: number; lastActivityAt: number | null
  todaySales: number; monthSales: number; allTimeSales: number; totalsReady: boolean; partial: boolean
}

const NOW = Date.parse('2026-11-17T12:00:00+05:00')
const row = (name: string, allTimeSales: number, lastActivityAt: number | null): Row => ({
  _id: `id_${name}`, name, email: `${name.toLowerCase()}@example.com`, createdAt: 0, lastActivityAt,
  todaySales: 10, monthSales: 20, allTimeSales, totalsReady: true, partial: false,
})

const calls: { search: string; sort: string }[] = []
const loadMore = vi.fn()
const feed = {
  results: [] as Row[],
  status: 'CanLoadMore' as 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted',
}

vi.mock('@/hooks/useAdmin', () => ({
  USERS_PAGE: 20,
  useAdminUsers: (search: string, sort: string) => {
    calls.push({ search, sort })
    return { ...feed, loadMore }
  },
}))

import UsersList, { SEARCH_DEBOUNCE_MS } from './UsersList'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  feed.results = [
    row('Alice', 500, NOW - 3 * 86_400_000),
    row('Bilal', 900, null),
    row('Chaudhry', 100, NOW),
  ]
  feed.status = 'CanLoadMore'
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  calls.length = 0
  loadMore.mockClear()
})

const renderList = () => render(<MemoryRouter><UsersList /></MemoryRouter>)
const names = () => within(screen.getByRole('list', { name: 'Users' })).getAllByRole('link').map((a) => (a.textContent ?? '').slice(1))
const last = () => calls[calls.length - 1]!

describe('UsersList', () => {
  it('shows each row with last activity and links to the detail page', () => {
    renderList()
    const links = within(screen.getByRole('list', { name: 'Users' })).getAllByRole('link')
    expect(links[0]!.getAttribute('href')).toBe('/admin/users/id_Chaudhry')
    expect(links[0]!.textContent).toContain('Last active: Today')
    expect(screen.getByText('Last active: 3 days ago')).toBeTruthy()
    expect(screen.getByText('Last active: Never')).toBeTruthy()
  })

  it('searches on the server after a short pause, and can clear', () => {
    renderList()
    fireEvent.change(screen.getByRole('searchbox', { name: /search users/i }), { target: { value: '  bil ' } })
    expect(last().search).toBe('')
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS) })
    expect(last().search).toBe('bil')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS) })
    expect(last().search).toBe('')
  })

  it('Show More loads the next page', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Show More' }))
    expect(loadMore).toHaveBeenCalledWith(20)
  })

  it('sort chips: recent / all-time sort loaded rows, Name asks the server', () => {
    renderList()
    expect(last().sort).toBe('newest')
    expect(names().map((n) => n.slice(0, 5))).toEqual(['Chaud', 'Alice', 'Bilal'])
    expect(screen.getByText(/Sorted among the 3 users loaded/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'All-time sales' }))
    expect(names().map((n) => n.slice(0, 5))).toEqual(['Bilal', 'Alice', 'Chaud'])

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(last().sort).toBe('name')
    expect(screen.getByRole('button', { name: 'Name' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/Sorted among/)).toBeNull()
  })

  it('skeleton while loading; empty state when nothing matches', () => {
    feed.status = 'LoadingFirstPage'
    feed.results = []
    const { unmount } = renderList()
    expect(screen.getByTestId('users-skeleton')).toBeTruthy()
    unmount()
    feed.status = 'Exhausted'
    renderList()
    expect(screen.getByText('No users yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
  })
})
