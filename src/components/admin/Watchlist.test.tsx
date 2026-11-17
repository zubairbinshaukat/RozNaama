import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { watchlistKey } from '@/lib/admin'

const NOW = Date.parse('2026-11-17T17:00:00+05:00')
const at = (h: number, m = 0) => Date.parse(`2026-11-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:00`)

type Summary = {
  userId: string; name: string; email: string; lastActivityAt: number | null
  latest: { kind: 'sale' | 'expense'; label: string; amount: number; at: number } | null
  today: { sales: number; expenses: number }; week: { sales: number; expenses: number }; month: { sales: number; expenses: number }
  partial: boolean
  khataEnabled?: boolean
}
const summary = (id: string, name: string, extra: Partial<Summary> = {}): Summary => ({
  userId: id, name, email: `${name.toLowerCase()}@example.com`, lastActivityAt: at(14, 14),
  latest: { kind: 'sale', label: 'Sugar 1kg', amount: 160, at: at(14, 14) },
  today: { sales: 1200, expenses: 200 }, week: { sales: 5000, expenses: 0 }, month: { sales: 20000, expenses: 1500 },
  partial: false, ...extra,
})

const server = {
  summaries: new Map<string, Summary>(),
  watchArgs: [] as unknown[],
  users: [] as { _id: string; name: string; email: string }[],
}
const setViewAs = vi.fn()
const showToast = vi.fn()

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ userId: 'clerk_admin' }) }))
vi.mock('convex/react', () => ({
  useQuery: (ref: FunctionReference<'query'>, args: { userIds: string[] } | 'skip') => {
    if (getFunctionName(ref) !== 'admin:watchSummaries' || args === 'skip') return undefined
    server.watchArgs.push(args)
    return args.userIds.flatMap((id) => server.summaries.get(id) ?? [])
  },
  useConvex: () => undefined,
}))
vi.mock('convex-helpers/react', () => ({
  usePaginatedQuery: () => ({ results: server.users, status: 'Exhausted', loadMore: vi.fn(), isLoading: false }),
}))
vi.mock('@/components/shared/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/context/ViewAsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/ViewAsContext')>()
  return { ...actual, useViewAs: () => ({ setViewAs }) }
})

import Watchlist from './Watchlist'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  server.summaries = new Map([
    ['u1', summary('u1', 'Ali Khan', { khataEnabled: true })],
    ['u2', summary('u2', 'Sana', {
      latest: { kind: 'expense', label: 'Rent', amount: 5000, at: at(9) },
      today: { sales: 0, expenses: 0 }, lastActivityAt: null,
    })],
  ])
  server.users = [
    { _id: 'u1', name: 'Ali Khan', email: 'ali@example.com' },
    { _id: 'u2', name: 'Sana', email: 'sana@example.com' },
    { _id: 'u3', name: 'Zahid', email: 'zahid@example.com' },
  ]
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  server.watchArgs = []
  setViewAs.mockClear()
  showToast.mockClear()
})

function renderWatchlist() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<Watchlist />} />
        <Route path="/dashboard" element={<p>dashboard page</p>} />
        <Route path="/admin/users/:id" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const saved = () => JSON.parse(localStorage.getItem(watchlistKey('clerk_admin')) ?? 'null') as unknown

describe('Watchlist', () => {
  it('empty: friendly prompt, no server call', () => {
    renderWatchlist()
    expect(screen.getByText('Pick the shops you want to keep an eye on')).toBeTruthy()
    expect(server.watchArgs).toEqual([])
  })

  it('choosing users saves them per admin and shows their cards', () => {
    renderWatchlist()
    fireEvent.click(screen.getByRole('button', { name: /choose users/i }))
    const sheet = screen.getByRole('dialog', { name: 'Choose users' })
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Sana/ }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /Ali Khan/ }))
    expect(within(sheet).getByRole('checkbox', { name: /Ali Khan/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save (2)' }))

    expect(saved()).toEqual(['u2', 'u1'])
    expect(showToast).toHaveBeenCalledWith('Watching 2 users', 'success')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Sana', 'Ali Khan'])
  })

  it('a card shows latest record, last active, KPIs with net, and links to the detail page', () => {
    localStorage.setItem(watchlistKey('clerk_admin'), JSON.stringify(['u1']))
    renderWatchlist()
    const card = screen.getByRole('article', { name: 'Ali Khan' })
    expect(card.textContent).toContain('AK')
    expect(card.textContent).toContain('Sugar 1kg · PKR 160 · 2:14 PM today')
    expect(card.textContent).toContain('Last active: Today')
    expect(card.textContent).toContain('Udhaar on')
    expect(screen.queryByText('Udhaar on', { selector: 'article[aria-label="Sana"] *' })).toBeNull()
    expect(card.textContent).toContain('TodayPKR 1,200Net 1,000')
    expect(card.textContent).toContain('This monthPKR 20,000Net 18,500')
    expect(within(card).getByRole('link').getAttribute('href')).toBe('/admin/users/u1')
    expect(server.watchArgs.at(-1)).toMatchObject({ userIds: ['u1'] })
  })

  it('Access starts the existing view-as and opens the dashboard', () => {
    localStorage.setItem(watchlistKey('clerk_admin'), JSON.stringify(['u2']))
    renderWatchlist()
    fireEvent.click(screen.getByRole('button', { name: "Access Sana's dashboard" }))
    expect(setViewAs).toHaveBeenCalledWith('u2', 'Sana')
    expect(showToast).toHaveBeenCalledWith("Now viewing Sana's data (read-only)", 'info')
    expect(screen.getByText('dashboard page')).toBeTruthy()
  })

  it('users that no longer exist are dropped from the saved list', () => {
    localStorage.setItem(watchlistKey('clerk_admin'), JSON.stringify(['gone', 'u1']))
    renderWatchlist()
    act(() => {})
    expect(saved()).toEqual(['u1'])
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('Edit: removing everyone clears the watchlist', () => {
    localStorage.setItem(watchlistKey('clerk_admin'), JSON.stringify(['u1']))
    renderWatchlist()
    fireEvent.click(screen.getByRole('button', { name: /edit \(1\)/i }))
    const sheet = screen.getByRole('dialog', { name: 'Choose users' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Ali Khan' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(saved()).toEqual([])
    expect(showToast).toHaveBeenCalledWith('Watchlist cleared', 'success')
    expect(screen.getByText('Pick the shops you want to keep an eye on')).toBeTruthy()
  })
})
