import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import DateField from './DateField'
import { addDays, startOfDay } from '@/lib/utils'

afterEach(cleanup)

function open(value = startOfDay(), onChange = vi.fn()) {
  render(<DateField label="Sale date" value={value} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /^Sale date:/ }))
  return { onChange, dialog: screen.getByRole('dialog', { name: 'Sale date' }) }
}

describe('DateField + DatePickerSheet', () => {
  it('shows a friendly label and no native date input', () => {
    const { container } = render(<DateField label="Sale date" value={startOfDay()} onChange={vi.fn()} />)
    expect(screen.getByTestId('date-field-value').textContent).toBe('Today')
    expect(container.querySelector('input[type="date"]')).toBeNull()
  })

  it('opens a dialog with quick chips; "Today" is pressed for today', () => {
    const { dialog } = open()
    const today = within(dialog).getByRole('button', { name: 'Today' })
    expect(today.getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('"Yesterday" selects yesterday\'s local midnight and closes the sheet', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }))
    expect(onChange).toHaveBeenCalledWith(addDays(startOfDay(), -1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"2 days ago" selects two days back', () => {
    const { onChange } = open()
    fireEvent.click(screen.getByRole('button', { name: '2 days ago' }))
    expect(onChange).toHaveBeenCalledWith(addDays(startOfDay(), -2))
  })

  it('Escape closes the picker without changing the date', () => {
    const { onChange } = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('tomorrow is disabled in the calendar', () => {
    const { dialog } = open()
    const tomorrow = addDays(startOfDay(), 1)
    // Tomorrow may fall in next month, which is not shown at all — only check when visible.
    const label = new Date(tomorrow).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const btn = within(dialog).queryByRole('button', { name: new RegExp(`^${label}`) }) as HTMLButtonElement | null
    if (btn) expect(btn.disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
