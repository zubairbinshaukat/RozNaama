import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SummaryCards from './SummaryCards'
import { AmountVisibilityContext } from '@/context/amountVisibility'
import type { DashboardStats } from '@/hooks/useSales'

afterEach(cleanup)

const STATS: DashboardStats = {
  todayTotal: 1500, todaySalesTotal: 1500, todayNetTotal: 1000, todayCount: 3,
  todayExpenseTotal: 500, todayExpenseCount: 1,
  weekTotal: 7000, weekCount: 9,
  monthTotal: 30000, monthCount: 40,
  allTimeTotal: 90000, allTimeCount: 120, allTimeSalesTotal: 100000, allTimeExpenseTotal: 10000,
  topCategoryName: 'Tea',
}

describe('SummaryCards period labels', () => {
  it('daily: today vs a past day; expense shortcut only on today', () => {
    const { rerender } = render(<SummaryCards stats={STATS} activeTab="daily" onAddExpense={vi.fn()} />)
    expect(screen.getByText("Today's sales")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add expense: After Expense' })).toBeTruthy()

    rerender(<SummaryCards stats={STATS} activeTab="daily" periodLabel="Mon, 16 Nov" isCurrent={false} onAddExpense={vi.fn()} />)
    expect(screen.getByText('Sales · Mon, 16 Nov')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add expense: After Expense' })).toBeNull()
  })

  it('weekly: a past week shows its range and best day', () => {
    render(<SummaryCards stats={STATS} activeTab="weekly" periodLabel="2–8 Nov" isCurrent={false} bestDay={{ label: 'Wed' }} />)
    expect(screen.getByText('2–8 Nov, after expenses')).toBeTruthy()
    expect(screen.getByText('Best day')).toBeTruthy()
    expect(screen.getByText('Wed')).toBeTruthy()
  })

  it('yearly: shows the selected year and hides amounts with the eye', () => {
    render(
      <AmountVisibilityContext.Provider value={{ hidden: true, toggle: vi.fn() }}>
        <SummaryCards
          stats={STATS}
          activeTab="yearly"
          periodLabel="2025"
          isCurrent={false}
          year={{ salesTotal: 50000, netTotal: 42000, bestMonth: 'Mar' }}
        />
      </AmountVisibilityContext.Provider>,
    )
    expect(screen.getByText('2025, after expenses')).toBeTruthy()
    expect(screen.getByText('Best month: Mar')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\d{1,3},\d{3}/)
  })

  it('offline snapshot from an earlier day: today shows "—" + Last updated', () => {
    render(
      <SummaryCards
        stats={STATS}
        activeTab="daily"
        stale={{ today: true, week: false, month: false }}
        staleLabel="Last updated Yesterday, 2:45 PM"
      />,
    )
    expect(screen.getByText('Last updated Yesterday, 2:45 PM')).toBeTruthy()
    expect(document.body.textContent).not.toContain('1,500')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('weekly: only the "Today" cell is stale → dash + a short note, week numbers kept', () => {
    render(
      <SummaryCards
        stats={STATS}
        activeTab="weekly"
        stale={{ today: true, week: false, month: false }}
        staleLabel="Last updated Yesterday, 2:45 PM"
      />,
    )
    expect(screen.getByText('Today: Last updated Yesterday, 2:45 PM')).toBeTruthy()
    expect(document.body.textContent).toContain('7,000')
  })

  it('yearly waits for the year totals (skeleton)', () => {
    render(<SummaryCards stats={STATS} activeTab="yearly" />)
    expect(screen.getByTestId('summary-skeleton')).toBeTruthy()
  })
})
