import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Calendar from './Calendar'
import { MIN_ENTRY_DATE_MS } from '@/lib/utils'

afterEach(cleanup)

// Frontend tests run in Asia/Karachi (see tests/frontend/setup.ts).
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()
const TODAY = day(2026, 3, 15)

function renderCalendar(value = day(2026, 3, 12), onSelect = vi.fn()) {
  render(<Calendar value={value} onSelect={onSelect} maxDate={TODAY} minDate={MIN_ENTRY_DATE_MS} todayMs={TODAY} />)
  return onSelect
}

const dayButton = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('Calendar', () => {
  it('shows the month of the selected value and marks the selected and today cells', () => {
    renderCalendar()
    expect(screen.getByText('March 2026')).toBeTruthy()
    const selected = dayButton(/^Thursday, 12 March 2026/)
    expect(selected.closest('[role="gridcell"]')?.getAttribute('aria-selected')).toBe('true')
    const today = dayButton(/^Sunday, 15 March 2026, today/)
    expect(today.getAttribute('aria-current')).toBe('date')
  })

  it('disables every future day and the next-month arrow', () => {
    renderCalendar()
    expect(dayButton(/^Monday, 16 March 2026/).disabled).toBe(true)
    expect(dayButton(/^Tuesday, 31 March 2026/).disabled).toBe(true)
    expect(dayButton(/^Sunday, 15 March 2026/).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('selects a past day as its local midnight', () => {
    const onSelect = renderCalendar()
    fireEvent.click(dayButton(/^Tuesday, 10 March 2026/))
    expect(onSelect).toHaveBeenCalledWith(day(2026, 3, 10))
  })

  it('does not select a future day', () => {
    const onSelect = renderCalendar()
    fireEvent.click(dayButton(/^Friday, 20 March 2026/))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('has a single tab stop on the selected day', () => {
    renderCalendar()
    const grid = screen.getByRole('grid')
    const stops = grid.querySelectorAll('button[tabindex="0"]')
    expect(stops).toHaveLength(1)
    expect(stops[0]!.getAttribute('aria-label')).toMatch(/^Thursday, 12 March 2026/)
  })

  it('moves focus with arrow keys and Enter picks the focused day', () => {
    const onSelect = renderCalendar()
    const start = dayButton(/^Thursday, 12 March 2026/)
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Friday, 13 March 2026/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Friday, 6 March 2026/)
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Monday, 2 March 2026/)
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Sunday, 8 March 2026/)
    // Buttons activate on click (Enter/Space on a native button fire click).
    fireEvent.click(document.activeElement!)
    expect(onSelect).toHaveBeenCalledWith(day(2026, 3, 8))
  })

  it('never lets keyboard focus land on a future day', () => {
    renderCalendar(day(2026, 3, 14))
    const start = dayButton(/^Saturday, 14 March 2026/)
    start.focus()
    fireEvent.keyDown(start, { key: 'ArrowDown' }) // +7 → 21 Mar (future) → clamped to today
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Sunday, 15 March 2026, today/)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Sunday, 15 March 2026, today/)
  })

  it('PageUp / ArrowLeft across the month edge switch the visible month', () => {
    renderCalendar()
    const start = dayButton(/^Thursday, 12 March 2026/)
    start.focus()
    fireEvent.keyDown(start, { key: 'PageUp' })
    expect(screen.getByText('February 2026')).toBeTruthy()
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Thursday, 12 February 2026/)
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.getByText('February 2026')).toBeTruthy()
  })

  it('month arrows move between months; next stops at the current month', () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('February 2026')).toBeTruthy()
    const next = screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(screen.getByText('March 2026')).toBeTruthy()
    expect(next.disabled).toBe(true)
  })
})
