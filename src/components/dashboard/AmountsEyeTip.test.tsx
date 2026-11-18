import { useId, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AmountsEyeTip from './AmountsEyeTip'
import { AmountVisibilityProvider, AmountVisibilityToggle } from '@/components/shared/Amount'
import Sheet from '@/components/shared/Sheet'
import { TIP_KEYS, tipStorageKey } from '@/hooks/useOneTimeTip'

const KEY_A = tipStorageKey(TIP_KEYS.amountsEye, 'user_a')!
const TITLE = 'Your amounts are hidden'
/** Longer than the tip's 600 ms quiet time. */
const APPEAR = { timeout: 2000 }

function Harness({ userId = 'user_a', enabled = true, blocked = false, withSheet = false }: {
  userId?: string | null
  enabled?: boolean
  blocked?: boolean
  withSheet?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetTitle = useId()
  return (
    <AmountVisibilityProvider>
      <AmountVisibilityToggle ref={ref} />
      {withSheet && <button type="button" onClick={() => setSheetOpen(true)}>Open sheet</button>}
      {sheetOpen && (
        <Sheet onClose={() => setSheetOpen(false)} labelledBy={sheetTitle}>
          <h2 id={sheetTitle}>Some sheet</h2>
        </Sheet>
      )}
      <AmountsEyeTip target={ref} userId={userId} enabled={enabled} blocked={blocked} />
    </AmountVisibilityProvider>
  )
}

const findTip = () => screen.findByRole('dialog', { name: TITLE }, APPEAR)
const queryTip = () => screen.queryByRole('dialog', { name: TITLE })
const eyeButton = () => screen.getByRole('button', { name: /amounts$/ })
/** Waits past the quiet time and checks the tip still hasn't appeared. */
async function expectNoTip() {
  await act(async () => { await new Promise((r) => setTimeout(r, 900)) })
  expect(queryTip()).toBeNull()
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AmountsEyeTip', () => {
  it('shows once for a user, then never again on this device', async () => {
    const first = render(<Harness />)
    const tip = await findTip()
    expect(tip.getAttribute('aria-modal')).toBe('true')
    expect(tip.textContent).toContain('Tap the eye to show or hide money amounts')
    // Marked seen as soon as it appears.
    expect(localStorage.getItem(KEY_A)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(queryTip()).toBeNull())
    first.unmount()

    render(<Harness />)
    await expectNoTip()
  })

  it('another user on the same phone still gets it', async () => {
    localStorage.setItem(KEY_A, '1')
    render(<Harness userId="user_b" />)
    await findTip()
    expect(localStorage.getItem(tipStorageKey(TIP_KEYS.amountsEye, 'user_b')!)).not.toBeNull()
  })

  it('is not shown without a user, while not enabled (e.g. view-as), or while blocked', async () => {
    const { rerender } = render(<Harness userId={null} />)
    await expectNoTip()
    rerender(<Harness enabled={false} />)
    await expectNoTip()
    rerender(<Harness blocked />)
    await expectNoTip()
    expect(localStorage.getItem(KEY_A)).toBeNull()
    // Once allowed, it appears.
    rerender(<Harness />)
    await findTip()
  })

  it('is never shown when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    render(<Harness />)
    await expectNoTip()
  })

  it('is not shown when storage can be read but not written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    render(<Harness />)
    await expectNoTip()
  })

  it.each([
    ['Got it', () => fireEvent.click(screen.getByRole('button', { name: 'Got it' }))],
    ['backdrop', () => fireEvent.click(screen.getByTestId('coach-mark-backdrop'))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s closes it, keeps it seen and returns focus to the eye', async (_name, dismiss) => {
    render(<Harness />)
    const tip = await findTip()
    expect(document.activeElement).toBe(tip)
    act(() => dismiss())
    await waitFor(() => expect(queryTip()).toBeNull())
    expect(document.activeElement).toBe(eyeButton())
    expect(localStorage.getItem(KEY_A)).not.toBeNull()
    // Amounts untouched.
    expect(eyeButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('"Try it" moves focus to the eye; tapping the eye shows amounts and completes the tip', async () => {
    render(<Harness />)
    await findTip()
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(document.activeElement).toBe(eyeButton())
    expect(screen.getByText('Now tap the eye')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(screen.getByRole('button', { name: 'Hide amounts' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('Nice! Tap again anytime to hide.')
    // Closes by itself (~1.6 s).
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 })
    expect(document.activeElement).toBe(eyeButton())
  })

  it('Tab stays within the card buttons and the eye', async () => {
    render(<Harness />)
    await findTip()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Got it' }))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try it' }))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(eyeButton())
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Got it' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(eyeButton())
  })

  it('steps aside for good when a sheet opens, without stealing its focus', async () => {
    render(<Harness withSheet />)
    await findTip()
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    const sheet = screen.getByRole('dialog', { name: 'Some sheet' })
    await waitFor(() => expect(queryTip()).toBeNull())
    expect(document.activeElement).toBe(sheet)
    // Closing the sheet does not bring it back.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Some sheet' })).toBeNull()
    await expectNoTip()
  })

  it('waits while a sheet is already open', async () => {
    render(<Harness withSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    await expectNoTip()
    fireEvent.keyDown(document, { key: 'Escape' })
    await findTip()
  })
})
