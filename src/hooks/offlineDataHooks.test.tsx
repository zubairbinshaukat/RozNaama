import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  DataReadyContext,
  OutboxContext,
  SnapshotContext,
  type DataReadyMode,
  type OutboxContextValue,
  type SnapshotContextValue,
} from '@/lib/offline/context'
import { applySnapshotPatch, emptySnapshot, snapshotStore } from '@/lib/offline/snapshot'
import type { SnapshotRecord } from '@/lib/offline/snapshotTypes'
import type { OutboxEngineState } from '@/lib/offline/outboxEngine'
import { statsRangesForDay } from '@/lib/period'
import { saleEntry } from '@/lib/offline/testUtils'
import type { DashboardStats } from './useSales'
import type { DayFeedEntry } from './useDayFeed'

const mocks = vi.hoisted(() => ({
  queryValue: undefined as unknown,
  queryArgs: [] as unknown[],
  feed: { results: [] as unknown[], status: 'LoadingFirstPage' as string, isLoading: true, loadMore: () => {} },
  feedArgs: [] as unknown[],
  viewAs: undefined as string | undefined,
}))

vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mocks.queryArgs.push(args)
    return args === 'skip' ? undefined : mocks.queryValue
  },
  useMutation: () => vi.fn(),
}))
vi.mock('convex-helpers/react', () => ({
  usePaginatedQuery: (_ref: unknown, args: unknown) => {
    mocks.feedArgs.push(args)
    return args === 'skip' ? { results: [], status: 'LoadingFirstPage', isLoading: true, loadMore: () => {} } : mocks.feed
  },
}))
vi.mock('@/context/ViewAsContext', () => ({
  useViewAsUserIdForQuery: () => mocks.viewAs,
}))

import { useDashboardStats, useDashboardStatsState } from './useSales'
import { useDayFeed } from './useDayFeed'
import { useCategories } from './useCategories'

const NOW = Date.parse('2026-03-12T10:00:00+05:00')
const TODAY = Date.parse('2026-03-12T00:00:00+05:00')
const RANGES = statsRangesForDay(TODAY)

const STATS: DashboardStats = {
  todayTotal: 100, todaySalesTotal: 100, todayNetTotal: 100, todayCount: 1, todayExpenseTotal: 0, todayExpenseCount: 0,
  weekTotal: 100, weekCount: 1, monthTotal: 100, monthCount: 1,
  allTimeTotal: 100, allTimeCount: 1, allTimeSalesTotal: 100, allTimeExpenseTotal: 0, topCategoryName: null,
}

const feedDay = (date: string, salesTotal = 10): DayFeedEntry =>
  ({ date, salesTotal, expenseTotal: 0, saleCount: 1, expenseCount: 0, sessions: [], expenses: [] }) as DayFeedEntry

function wrapper(opts: { record?: SnapshotRecord | null; mode?: DataReadyMode; pending?: OutboxContextValue['state'] | null; ownerSource?: 'clerk' | 'hint' }) {
  const snap: SnapshotContextValue = { owner: 'user_a', ownerSource: opts.ownerSource ?? 'clerk', record: opts.record ?? null, loaded: true }
  const outbox: OutboxContextValue = { owner: 'user_a', ownerSource: 'clerk', engine: null, state: opts.pending ?? null }
  return ({ children }: { children: ReactNode }) => (
    <DataReadyContext.Provider value={opts.mode ?? 'ready'}>
      <SnapshotContext.Provider value={snap}>
        <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>
      </SnapshotContext.Provider>
    </DataReadyContext.Provider>
  )
}

const pendingState = (...entries: ReturnType<typeof saleEntry>[]): OutboxEngineState =>
  ({ owner: 'user_a', loaded: true, entries, skippedCount: 0, paused: null, sendingIds: [] })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.queryValue = undefined
  mocks.queryArgs = []
  mocks.feed = { results: [], status: 'LoadingFirstPage', isLoading: true, loadMore: () => {} }
  mocks.feedArgs = []
  mocks.viewAs = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDashboardStats offline behaviour', () => {
  it('serves the snapshot until live data arrives, with pending entries added', () => {
    const record = applySnapshotPatch(emptySnapshot('user_a', NOW), { kind: 'stats', ranges: RANGES, value: STATS }, NOW)
    const pending = pendingState(saleEntry('p1', { dayKey: '2026-03-12', args: { items: [{ productName: 'X', amount: 40 }], sessionDate: TODAY } }))
    const { result } = renderHook(() => useDashboardStatsState(RANGES), { wrapper: wrapper({ record, pending }) })
    expect(result.current.source).toBe('snapshot')
    expect(result.current.stats?.todayTotal).toBe(140)
    expect(result.current.stats?.allTimeCount).toBe(2)
  })

  it('snapshot-only mode skips the live query', () => {
    const { result } = renderHook(() => useDashboardStats(RANGES), { wrapper: wrapper({ mode: 'snapshot' }) })
    expect(result.current).toBeUndefined()
    expect(mocks.queryArgs.every((a) => a === 'skip')).toBe(true)
  })

  it('a snapshot from an earlier day is flagged stale (and hidden from useDashboardStats)', () => {
    const yesterday = TODAY - 86_400_000
    const saved = NOW - 86_400_000
    const record = applySnapshotPatch(emptySnapshot('user_a', saved), { kind: 'stats', ranges: statsRangesForDay(yesterday), value: STATS }, saved)
    const { result } = renderHook(() => ({ state: useDashboardStatsState(), plain: useDashboardStats() }), { wrapper: wrapper({ record }) })
    expect(result.current.state).toMatchObject({ source: 'snapshot', staleToday: true, staleWeek: false, staleMonth: false })
    expect(result.current.plain).toBeUndefined()
  })

  it('in view-as: no snapshot, no overlay', () => {
    mocks.viewAs = 'other'
    const record = applySnapshotPatch(emptySnapshot('user_a', NOW), { kind: 'stats', ranges: RANGES, value: STATS }, NOW)
    mocks.queryValue = STATS
    const pending = pendingState(saleEntry('p1', { dayKey: '2026-03-12', args: { items: [{ productName: 'X', amount: 40 }], sessionDate: TODAY } }))
    const { result } = renderHook(() => useDashboardStatsState(RANGES), { wrapper: wrapper({ record, pending }) })
    expect(result.current.stats).toBe(STATS)
  })
})

describe('snapshot writes from hooks', () => {
  it('writes live data for the Clerk owner only', () => {
    const spy = vi.spyOn(snapshotStore, 'patch')
    mocks.queryValue = [{ _id: 'c1', userId: 'u', name: 'Tea', color: '#fff', createdAt: 1 }]
    renderHook(() => useCategories(), { wrapper: wrapper({}) })
    expect(spy).toHaveBeenCalledWith('user_a', { kind: 'categories', value: mocks.queryValue })
    spy.mockClear()

    renderHook(() => useCategories(), { wrapper: wrapper({ ownerSource: 'hint' }) })
    mocks.viewAs = 'other'
    renderHook(() => useCategories(), { wrapper: wrapper({}) })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('never writes snapshot-derived data', () => {
    const spy = vi.spyOn(snapshotStore, 'patch')
    const record = applySnapshotPatch(emptySnapshot('user_a', NOW), { kind: 'availableYears', value: [2026] }, NOW)
    const withCats = { ...record, categories: [] }
    const { result } = renderHook(() => useCategories(), { wrapper: wrapper({ record: withCats }) })
    expect(result.current).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('useDayFeed offline behaviour', () => {
  const range = { startDate: TODAY, endDate: TODAY + 86_400_000 - 1 }

  it('shows snapshot days while the first live page loads, merged with pending rows', () => {
    const weekStart = RANGES.weekStart
    const record = applySnapshotPatch(emptySnapshot('user_a', NOW), {
      kind: 'feed', startDate: weekStart, endDate: RANGES.weekEnd, isDone: true, entries: [feedDay('2026-03-12', 10), feedDay('2026-03-10')],
    }, NOW)
    const pending = pendingState(saleEntry('p1', { dayKey: '2026-03-12', args: { items: [{ productName: 'X', amount: 5 }], sessionDate: TODAY } }))
    const { result } = renderHook(() => useDayFeed(range, 1), { wrapper: wrapper({ record, pending }) })
    expect(result.current.source).toBe('snapshot')
    expect(result.current.status).toBe('Exhausted')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({ date: '2026-03-12', salesTotal: 15, saleCount: 2 })
  })

  it('switches to live results (pending rows still merged) and dedupes by entry', () => {
    mocks.feed = { results: [feedDay('2026-03-12', 10)], status: 'Exhausted', isLoading: false, loadMore: () => {} }
    const pending = pendingState(saleEntry('p1', { dayKey: '2026-03-12', args: { items: [{ productName: 'X', amount: 5 }], sessionDate: TODAY } }))
    const { result, rerender } = renderHook(() => useDayFeed(range, 1), { wrapper: wrapper({ pending }) })
    expect(result.current.source).toBe('live')
    expect(result.current.results[0]).toMatchObject({ salesTotal: 15 })
    // Synced: the entry leaves the outbox and the live row carries the amount.
    mocks.feed = { results: [feedDay('2026-03-12', 15)], status: 'Exhausted', isLoading: false, loadMore: () => {} }
    rerender()
    const { result: after } = renderHook(() => useDayFeed(range, 1), { wrapper: wrapper({ pending: pendingState() }) })
    expect(after.current.results[0]).toMatchObject({ salesTotal: 15 })
  })

  it('snapshot-only mode with nothing saved still shows pending entries', () => {
    const pending = pendingState(saleEntry('p1', { dayKey: '2026-03-12', args: { items: [{ productName: 'X', amount: 5 }], sessionDate: TODAY } }))
    const { result } = renderHook(() => useDayFeed(range, 1), { wrapper: wrapper({ mode: 'snapshot', pending }) })
    expect(mocks.feedArgs.every((a) => a === 'skip')).toBe(true)
    expect(result.current.status).toBe('Exhausted')
    expect(result.current.results).toHaveLength(1)
  })
})
