import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PeriodSwitcher from './PeriodSwitcher'

afterEach(cleanup)

function setup(overrides: Partial<Parameters<typeof PeriodSwitcher>[0]> = {}) {
  const props = {
    label: 'This week',
    sublabel: '16–22 Nov',
    unit: 'week',
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onOpenPicker: vi.fn(),
    ...overrides,
  }
  render(<PeriodSwitcher {...props} />)
  return props
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('PeriodSwitcher', () => {
  it('shows the label and sublabel, and the arrows step', () => {
    const p = setup()
    expect(screen.getByText('This week')).toBeTruthy()
    expect(screen.getByText('16–22 Nov')).toBeTruthy()
    fireEvent.click(btn('Previous week'))
    fireEvent.click(btn('Next week'))
    expect(p.onPrev).toHaveBeenCalledTimes(1)
    expect(p.onNext).toHaveBeenCalledTimes(1)
  })

  it('the centre label opens the picker', () => {
    const p = setup()
    const centre = btn(/^This week, 16–22 Nov\. Pick another week/)
    expect(centre.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(centre)
    expect(p.onOpenPicker).toHaveBeenCalledTimes(1)
  })

  it('disables next on the current period and hides the reset action', () => {
    setup({ nextDisabled: true })
    expect(btn('Next week').disabled).toBe(true)
    expect(btn('Previous week').disabled).toBe(false)
    expect(screen.queryByRole('button', { name: /back to/i })).toBeNull()
  })

  it('offers "Back to …" when given', () => {
    const onReset = vi.fn()
    setup({ label: 'Last week', resetLabel: 'Back to this week', onReset })
    fireEvent.click(btn('Back to this week'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('has 44px arrow buttons', () => {
    setup()
    expect(btn('Previous week').className).toContain('w-11 h-11')
    expect(btn('Next week').className).toContain('w-11 h-11')
  })
})
