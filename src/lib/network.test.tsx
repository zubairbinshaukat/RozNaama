import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'

const connection = { isWebSocketConnected: true, hasEverConnected: true }
vi.mock('convex/react', () => ({
  useConvexConnectionState: () => ({ ...connection }),
}))

import { OFFLINE_DEBOUNCE_MS, isConnectionDown, useNetworkStatus } from './network'
import OfflineBanner from '@/components/shared/OfflineBanner'

let online = true

function setBrowserOnline(value: boolean) {
  online = value
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

beforeEach(() => {
  vi.useFakeTimers()
  online = true
  connection.isWebSocketConnected = true
  connection.hasEverConnected = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isConnectionDown', () => {
  it('is down when the browser is offline', () => {
    expect(isConnectionDown(false, { isWebSocketConnected: true, hasEverConnected: true })).toBe(true)
  })
  it('is down when the Convex socket dropped after connecting once', () => {
    expect(isConnectionDown(true, { isWebSocketConnected: false, hasEverConnected: true })).toBe(true)
  })
  it('is not down while the first Convex handshake is still pending', () => {
    expect(isConnectionDown(true, { isWebSocketConnected: false, hasEverConnected: false })).toBe(false)
  })
})

describe('useNetworkStatus', () => {
  it('reports offline only after the drop lasts OFFLINE_DEBOUNCE_MS', () => {
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current.isOffline).toBe(false)

    act(() => setBrowserOnline(false))
    expect(result.current.browserOnline).toBe(false)
    expect(result.current.isOffline).toBe(false)

    act(() => { vi.advanceTimersByTime(OFFLINE_DEBOUNCE_MS - 1) })
    expect(result.current.isOffline).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.isOffline).toBe(true)
  })

  it('ignores a blip shorter than the debounce', () => {
    const { result } = renderHook(() => useNetworkStatus())
    act(() => setBrowserOnline(false))
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => setBrowserOnline(true))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.isOffline).toBe(false)
  })

  it('recovers immediately when back online', () => {
    const { result } = renderHook(() => useNetworkStatus())
    act(() => setBrowserOnline(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_DEBOUNCE_MS) })
    expect(result.current.isOffline).toBe(true)
    act(() => setBrowserOnline(true))
    expect(result.current.isOffline).toBe(false)
  })

  it('treats a dropped Convex socket as offline (debounced)', () => {
    connection.isWebSocketConnected = false
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current.isOffline).toBe(false)
    act(() => { vi.advanceTimersByTime(OFFLINE_DEBOUNCE_MS) })
    expect(result.current.isOffline).toBe(true)
  })
})

describe('OfflineBanner', () => {
  it('is hidden online and shows the offline copy (+ pending count) after the debounce', () => {
    const { rerender } = render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()

    act(() => setBrowserOnline(false))
    act(() => { vi.advanceTimersByTime(OFFLINE_DEBOUNCE_MS) })
    expect(screen.getByRole('status').textContent).toBe(
      "You're offline — new sales and expenses will be saved on this phone.",
    )

    rerender(<OfflineBanner pendingCount={3} />)
    expect(screen.getByRole('status').textContent).toContain('(3 waiting)')
  })
})
