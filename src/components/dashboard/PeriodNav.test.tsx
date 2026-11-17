import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DayNav, MonthNav, WeekNav, YearNav } from './PeriodNav'

// Frontend tests run in Asia/Karachi (see tests/frontend/setup.ts).
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()

beforeEach(() => {
  // Only Date is faked (framer-motion still needs real timers): today = Tue 17 Nov 2026.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 17, 15, 0) })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('DayNav', () => {
  it('on today: next disabled, no reset; previous goes to yesterday', () => {
    const onChange = vi.fn()
    render(<DayNav value={day(2026, 11, 17)} onChange={onChange} />)
    expect(screen.getByText('Today')).toBeTruthy()
    expect(btn('Next day').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
    fireEvent.click(btn('Previous day'))
    expect(onChange).toHaveBeenCalledWith(day(2026, 11, 16))
  })

  it('on a past day: next and "Back to today" work', () => {
    const onChange = vi.fn()
    render(<DayNav value={day(2026, 11, 10)} onChange={onChange} />)
    expect(btn('Tue, 10 Nov. Pick another day')).toBeTruthy()
    fireEvent.click(btn('Next day'))
    expect(onChange).toHaveBeenLastCalledWith(day(2026, 11, 11))
    fireEvent.click(btn('Back to today'))
    expect(onChange).toHaveBeenLastCalledWith(day(2026, 11, 17))
  })

  it('the label opens the calendar with future days disabled', () => {
    const onChange = vi.fn()
    render(<DayNav value={day(2026, 11, 17)} onChange={onChange} />)
    fireEvent.click(btn(/Pick another day/))
    const dialog = screen.getByRole('dialog', { name: 'Go to a day' })
    expect((within(dialog).getByRole('button', { name: /^Wednesday, 18 November 2026/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Thursday, 12 November 2026/ }))
    expect(onChange).toHaveBeenCalledWith(day(2026, 11, 12))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('WeekNav + week picker', () => {
  it('shows the week dates and steps by Monday', () => {
    const onChange = vi.fn()
    render(<WeekNav value={day(2026, 11, 16)} onChange={onChange} />)
    expect(screen.getByText('This week')).toBeTruthy()
    expect(screen.getByText('16–22 Nov')).toBeTruthy()
    expect(btn('Next week').disabled).toBe(true)
    fireEvent.click(btn('Previous week'))
    expect(onChange).toHaveBeenCalledWith(day(2026, 11, 9))
  })

  it('lists weeks newest first, highlights the selected one, and shows more', () => {
    const onChange = vi.fn()
    render(<WeekNav value={day(2026, 11, 9)} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Back to this week' })).toBeTruthy()
    fireEvent.click(btn(/Pick another week/))
    const dialog = screen.getByRole('dialog', { name: 'Pick a week' })
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(12)
    expect(items[0]!.textContent).toBe('This week · 16–22 Nov')
    expect(items[1]!.textContent).toBe('Last week · 9–15 Nov')
    expect(items[2]!.textContent).toBe('2–8 Nov')
    expect(within(dialog).getByRole('button', { name: 'Last week · 9–15 Nov' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show more' }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(24)

    fireEvent.click(within(dialog).getByRole('button', { name: '2–8 Nov' }))
    expect(onChange).toHaveBeenCalledWith(day(2026, 11, 2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('MonthNav + month picker', () => {
  it('steps months; next disabled on this month', () => {
    const onChange = vi.fn()
    render(<MonthNav value={day(2026, 11, 1)} onChange={onChange} />)
    expect(btn('November 2026. Pick another month')).toBeTruthy()
    expect(btn('Next month').disabled).toBe(true)
    fireEvent.click(btn('Previous month'))
    expect(onChange).toHaveBeenCalledWith(day(2026, 10, 1))
  })

  it('month grid: future months disabled, year switch, picking closes', () => {
    const onChange = vi.fn()
    render(<MonthNav value={day(2026, 11, 1)} onChange={onChange} />)
    fireEvent.click(btn(/Pick another month/))
    const dialog = screen.getByRole('dialog', { name: 'Pick a month' })
    expect((within(dialog).getByRole('button', { name: /^December 2026/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'November 2026, this month' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(dialog).getByRole('button', { name: 'Next year' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous year' }))
    expect(within(dialog).getByText('2025')).toBeTruthy()
    const dec = within(dialog).getByRole('button', { name: 'December 2025' }) as HTMLButtonElement
    expect(dec.disabled).toBe(false)
    fireEvent.click(dec)
    expect(onChange).toHaveBeenCalledWith(day(2025, 12, 1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('YearNav + year picker', () => {
  it('steps through years with data and lists them newest first', () => {
    const onChange = vi.fn()
    render(<YearNav value={2026} onChange={onChange} years={[2024, 2026, 2025]} />)
    expect(btn('Next year').disabled).toBe(true)
    fireEvent.click(btn('Previous year'))
    expect(onChange).toHaveBeenLastCalledWith(2025)

    fireEvent.click(btn(/Pick another year/))
    const dialog = screen.getByRole('dialog', { name: 'Pick a year' })
    const items = within(dialog).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['This year · 2026', '2025', '2024'])
    fireEvent.click(within(dialog).getByRole('button', { name: '2024' }))
    expect(onChange).toHaveBeenLastCalledWith(2024)
  })

  it('on an older year offers "Back to this year"', () => {
    const onChange = vi.fn()
    render(<YearNav value={2024} onChange={onChange} years={[2026, 2024]} />)
    expect(btn('Previous year').disabled).toBe(true)
    fireEvent.click(btn('Next year'))
    expect(onChange).toHaveBeenLastCalledWith(2026)
    fireEvent.click(btn('Back to this year'))
    expect(onChange).toHaveBeenLastCalledWith(2026)
  })
})
