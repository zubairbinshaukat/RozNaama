import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { DataFreshness } from '@/hooks/useDataFreshness'
import DataFreshnessChip from './DataFreshnessChip'

const state: { freshness: DataFreshness; offline: boolean } = {
  freshness: { mode: 'live', updatedAt: null, isStaleDay: false, label: null },
  offline: false,
}
vi.mock('@/hooks/useDataFreshness', () => ({ useDataFreshness: () => state.freshness }))
vi.mock('@/lib/network', () => ({ useNetworkStatus: () => ({ isOffline: state.offline, browserOnline: !state.offline }) }))

afterEach(() => {
  cleanup()
  state.freshness = { mode: 'live', updatedAt: null, isStaleDay: false, label: null }
  state.offline = false
})

describe('DataFreshnessChip', () => {
  it('is hidden while live', () => {
    const { container } = render(<DataFreshnessChip />)
    expect(container.textContent).toBe('')
  })

  it('snapshot mode online: "Updating…"', () => {
    state.freshness = { mode: 'snapshot', updatedAt: 1, isStaleDay: false, label: 'Last updated 2:45 PM' }
    render(<DataFreshnessChip />)
    expect(screen.getByRole('status').textContent).toBe('Updating…')
  })

  it('offline: "Offline · last updated …"', () => {
    state.offline = true
    state.freshness = { mode: 'offline', updatedAt: 1, isStaleDay: false, label: 'Last updated 2:45 PM' }
    render(<DataFreshnessChip />)
    expect(screen.getByRole('status').textContent).toBe('Offline · last updated 2:45 PM')
  })
})
