import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Amount, { AmountVisibilityProvider, AmountVisibilityToggle } from './Amount'
import { AMOUNT_VISIBILITY_KEY } from '@/context/amountVisibility'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

function Dashboardish() {
  return (
    <AmountVisibilityProvider>
      <AmountVisibilityToggle />
      <p data-testid="a"><Amount value={1210} /></p>
      <p data-testid="b"><Amount value={-1210} signed colored /></p>
    </AmountVisibilityProvider>
  )
}

describe('Amount', () => {
  it('outside the dashboard provider amounts are shown', () => {
    render(<Amount value={1234} />)
    expect(screen.getByText('PKR 1,234')).toBeTruthy()
  })

  it('signed: loss gets a minus sign and the negative colour; profit has no sign', () => {
    render(<><Amount value={-1210} signed colored /><Amount value={500} signed colored /></>)
    expect(screen.getByText('−PKR 1,210').className).toContain('text-negative')
    expect(screen.getByText('PKR 500').className).toContain('text-positive')
  })

  it('defaults to hidden on first load', () => {
    render(<Dashboardish />)
    expect(screen.getByTestId('a').textContent).toContain('PKR ••••')
    expect(screen.getByTestId('b').textContent).not.toContain('1,210')
    const btn = screen.getByRole('button', { name: 'Show amounts' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('toggle reveals amounts and the choice is remembered per device', () => {
    const { unmount } = render(<Dashboardish />)
    fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(screen.getByTestId('a').textContent).toBe('PKR 1,210')
    expect(screen.getByRole('button', { name: 'Hide amounts' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(AMOUNT_VISIBILITY_KEY)).toBe('false')
    unmount()
    render(<Dashboardish />)
    expect(screen.getByTestId('a').textContent).toBe('PKR 1,210')
  })

  it('a corrupt stored value falls back to hidden', () => {
    localStorage.setItem(AMOUNT_VISIBILITY_KEY, 'banana')
    render(<Dashboardish />)
    expect(screen.getByTestId('a').textContent).toContain('••••')
  })
})
