import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Category } from '@/hooks/useCategories'
import type { SaleItem } from '@/hooks/useSales'
import type { CategorySummary } from '@/hooks/useCategorySales'
import type { LoadMoreStatus } from '@/components/dashboard/LoadMoreButton'
import CategorySalesModal from './CategorySalesModal'

type PaginatedState = {
  results:  SaleItem[]
  status:   LoadMoreStatus
  loadMore: (n: number) => void
  isLoading: boolean
}

const state: { paginated: PaginatedState; summary: CategorySummary | undefined } = {
  paginated: { results: [], status: 'LoadingFirstPage', loadMore: vi.fn(), isLoading: true },
  summary:   undefined,
}

vi.mock('@/hooks/useCategorySales', () => ({
  useCategorySalesPaginated: () => state.paginated,
  useCategorySummary:        () => state.summary,
}))


const category = {
  _id:       'cat1' as Id<'categories'>,
  name:      'Drinks',
  color:     '#3b82f6',
} as Category

function sale(id: string, saleDate: number, amount: number): SaleItem {
  return {
    _id:         id as Id<'sales'>,
    userId:      'u1' as Id<'users'>,
    sessionId:   's1' as Id<'saleSessions'>,
    productName: `Product ${id}`,
    amount,
    saleDate,
    createdAt:   saleDate,
  }
}

afterEach(() => {
  cleanup()
  state.paginated = { results: [], status: 'LoadingFirstPage', loadMore: vi.fn(), isLoading: true }
  state.summary = undefined
})

describe('CategorySalesModal', () => {
  it('shows a skeleton (not "Loading…" text) while the summary loads', () => {
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    expect(screen.getByTestId('category-summary-skeleton')).toBeTruthy()
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it('shows count and total from the server summary, not from the loaded page', () => {
    state.summary = { count: 57, totalAmount: 12345 }
    state.paginated = {
      results:   [sale('a', new Date(2026, 2, 12, 10).getTime(), 100)],
      status:    'CanLoadMore',
      loadMore:  vi.fn(),
      isLoading: false,
    }
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    expect(screen.getByText(/57 sales/)).toBeTruthy()
    expect(screen.getByText(/12,345/)).toBeTruthy()
  })

  it('shows "No sales yet" when the summary count is zero', () => {
    state.summary = { count: 0, totalAmount: 0 }
    state.paginated = { results: [], status: 'Exhausted', loadMore: vi.fn(), isLoading: false }
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    expect(screen.getAllByText('No sales yet').length).toBeGreaterThan(0)
  })

  it('uses singular "sale" for a count of one', () => {
    state.summary = { count: 1, totalAmount: 500 }
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    expect(screen.getByText(/^1 sale ·/)).toBeTruthy()
  })

  it('renders Show More and loads the next page of 20 when clicked', () => {
    const loadMore = vi.fn()
    state.summary = { count: 30, totalAmount: 3000 }
    state.paginated = {
      results:   [sale('a', new Date(2026, 2, 12, 10).getTime(), 100)],
      status:    'CanLoadMore',
      loadMore,
      isLoading: false,
    }
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show More' }))
    expect(loadMore).toHaveBeenCalledWith(20)
  })

  it('hides Show More once exhausted', () => {
    state.summary = { count: 1, totalAmount: 100 }
    state.paginated = {
      results:   [sale('a', new Date(2026, 2, 12, 10).getTime(), 100)],
      status:    'Exhausted',
      loadMore:  vi.fn(),
      isLoading: false,
    }
    render(<CategorySalesModal category={category} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
  })
})
