import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AmountInput from './AmountInput'

afterEach(cleanup)

function Harness({ quick }: { quick?: number[] }) {
  const [value, setValue] = useState('')
  return (
    <>
      <AmountInput aria-label="Amount" value={value} onChange={setValue} quickAmounts={quick} />
      <output data-testid="raw">{value}</output>
    </>
  )
}

describe('AmountInput', () => {
  it('uses the decimal keypad and a 16px+ text input (no native number spinner)', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input.inputMode).toBe('decimal')
  })

  it('formats with PKR grouping as you type and keeps the raw value clean', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Amount') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234567' } })
    expect(input.value).toBe('1,234,567')
    expect(screen.getByTestId('raw').textContent).toBe('1234567')
    fireEvent.change(input, { target: { value: '1,234,567.891' } })
    expect(input.value).toBe('1,234,567.89')
  })

  it('quick amount chips fill the field', () => {
    render(<Harness quick={[500, 1000]} />)
    fireEvent.click(screen.getByRole('button', { name: 'PKR 1,000' }))
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('1,000')
    expect(screen.getByRole('button', { name: 'PKR 1,000' }).getAttribute('aria-pressed')).toBe('true')
  })
})
