import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

type Settings = { khataEnabled: boolean; advanceRecognition: 'delivery' | 'cash'; udhaarRecognition: 'delivery' | 'cash'; updatedAt: number }
const state = {
  settings: undefined as Settings | null | undefined,
  online: true,
}
const setSettings = vi.fn()
const showToast = vi.fn()

vi.mock('@/hooks/useAdmin', () => ({
  useAdminUserSettings: () => state.settings,
  useSetAdminUserSettings: () => setSettings,
}))
vi.mock('@/lib/network', () => ({ useBrowserOnline: () => state.online }))
vi.mock('@/components/shared/Toast', () => ({ useToast: () => ({ showToast }) }))

import ShopSettingsCard from './ShopSettingsCard'

const OFF: Settings = { khataEnabled: false, advanceRecognition: 'delivery', udhaarRecognition: 'delivery', updatedAt: 0 }

beforeEach(() => {
  state.settings = { ...OFF }
  state.online = true
  setSettings.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  setSettings.mockReset()
  showToast.mockClear()
})

const renderCard = () => render(<ShopSettingsCard userId="u1" name="Ali" />)
const toggle = () => screen.getByRole('switch', { name: 'Advance & Udhaar' })

describe('ShopSettingsCard', () => {
  it('skeleton while loading; nothing for a missing user', () => {
    state.settings = undefined
    const { unmount } = renderCard()
    expect(screen.getByTestId('shop-settings-skeleton')).toBeTruthy()
    unmount()
    state.settings = null
    const { container } = renderCard()
    expect(container.textContent).toBe('')
  })

  it('off: switch only, no choices; turning on saves for that user with a toast', async () => {
    renderCard()
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('Changes apply to new entries only.')).toBeTruthy()
    await act(async () => { fireEvent.click(toggle()) })
    expect(setSettings).toHaveBeenCalledWith({ userId: 'u1', khataEnabled: true })
    expect(showToast).toHaveBeenCalledWith('Saved for Ali', 'success')
  })

  it('on: shows both choices with the current values; picking one saves it', async () => {
    state.settings = { ...OFF, khataEnabled: true, udhaarRecognition: 'cash' }
    renderCard()
    const advance = screen.getByRole('radiogroup', { name: 'Advance counts in sales' })
    const udhaar = screen.getByRole('radiogroup', { name: 'Udhaar counts in sales' })
    expect(advance.querySelector('[aria-checked="true"]')?.textContent).toContain('On handover day')
    expect(udhaar.querySelector('[aria-checked="true"]')?.textContent).toContain('Only cash received')

    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /When cash comes/ })) })
    expect(setSettings).toHaveBeenCalledWith({ userId: 'u1', advanceRecognition: 'cash' })
    // Tapping the already-selected choice does nothing.
    setSettings.mockClear()
    fireEvent.click(screen.getByRole('radio', { name: /Only cash received/ }))
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('save errors show an error toast', async () => {
    setSettings.mockRejectedValue(new Error('boom'))
    renderCard()
    await act(async () => { fireEvent.click(toggle()) })
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('offline: explains and disables every control', () => {
    state.online = false
    state.settings = { ...OFF, khataEnabled: true }
    renderCard()
    expect(screen.getByText('Connect to the internet to change shop settings.')).toBeTruthy()
    expect((toggle() as HTMLButtonElement).disabled).toBe(true)
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true)
  })
})
