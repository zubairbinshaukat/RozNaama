import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import OfflineBanner, { SYNCING_SHOW_DELAY_MS } from './OfflineBanner'

const net = { offline: false }
vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: net.offline, browserOnline: !net.offline }),
}))

afterEach(() => {
  cleanup()
  net.offline = false
  vi.useRealTimers()
})

describe('OfflineBanner', () => {
  it('shows nothing online with nothing waiting', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.textContent).toBe('')
  })

  it('offline: explains that entries are kept on the phone, with the waiting count', () => {
    net.offline = true
    render(<OfflineBanner pendingCount={3} syncingCount={3} />)
    expect(screen.getByRole('status').textContent).toContain('saved on this phone')
    expect(screen.getByRole('status').textContent).toContain('(3 waiting)')
  })

  it('online: "Syncing N…" only once entries have waited a moment (no flash on normal saves)', () => {
    vi.useFakeTimers()
    const view = render(<OfflineBanner pendingCount={2} syncingCount={2} />)
    expect(screen.queryByText('Syncing 2…')).toBeNull()
    act(() => { vi.advanceTimersByTime(SYNCING_SHOW_DELAY_MS) })
    expect(screen.getByText('Syncing 2…')).toBeTruthy()
    view.rerender(<OfflineBanner pendingCount={0} syncingCount={0} />)
    expect(screen.queryByText(/Syncing/)).toBeNull()
  })

  it('entries that only need a fix do not show "Syncing"', () => {
    vi.useFakeTimers()
    render(<OfflineBanner pendingCount={1} syncingCount={0} />)
    act(() => { vi.advanceTimersByTime(SYNCING_SHOW_DELAY_MS * 2) })
    expect(screen.queryByText(/Syncing/)).toBeNull()
  })

  it('paused (signed out): short message + Try again', () => {
    const onRetry = vi.fn()
    render(
      <OfflineBanner
        pendingCount={2}
        syncingCount={2}
        paused={{ reason: 'unauthorized', message: 'Please sign in again.' }}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('Sign in again to sync 2 entries.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('paused (forbidden): shows the server message', () => {
    render(
      <OfflineBanner pendingCount={1} paused={{ reason: 'forbidden', message: 'Account disabled.' }} onRetry={vi.fn()} />,
    )
    expect(screen.getByText('Account disabled. (1 waiting)')).toBeTruthy()
  })

  it('paused (app too old): offers Reload', () => {
    render(<OfflineBanner pendingCount={1} paused={{ reason: 'missingBackend', message: '' }} />)
    expect(screen.getByText('Update needed to sync 1 entry.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
  })

  it('paused with nothing waiting shows nothing', () => {
    const { container } = render(<OfflineBanner pendingCount={0} paused={{ reason: 'forbidden', message: 'x' }} />)
    expect(container.textContent).toBe('')
  })

  it('offline wins over paused', () => {
    net.offline = true
    render(<OfflineBanner pendingCount={1} paused={{ reason: 'forbidden', message: 'x' }} />)
    expect(screen.getByRole('status').textContent).toContain("You're offline")
  })
})
