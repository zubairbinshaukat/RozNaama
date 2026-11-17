import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { formatCurrency } from '@/lib/utils'
import { CATEGORY_COLORS, MAX_SALE_ITEMS } from '@/lib/constants'

describe('frontend test harness', () => {
  it('runs in Asia/Karachi time', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Karachi')
    // 2026-03-10T19:30Z is already 11 March in Pakistan.
    expect(new Date(Date.parse('2026-03-10T19:30:00Z')).getDate()).toBe(11)
  })

  it('renders React with jsdom and resolves the @ alias', () => {
    render(<p>{formatCurrency(1234)}</p>)
    expect(screen.getByText('PKR 1,234')).toBeTruthy()
  })

  it('shares limits with the backend', () => {
    expect(MAX_SALE_ITEMS).toBe(20)
    expect(CATEGORY_COLORS).toHaveLength(8)
  })
})
