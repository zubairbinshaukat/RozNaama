import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ToastProvider } from '@/components/shared/Toast'
import { KHATA_TURNED_OFF_MESSAGE, useOnKhataTurnedOff, useShopSettings } from '@/hooks/useShopSettings'
import { DEFAULT_SHOP_SETTINGS, readCachedSettings, settingsCacheKey, writeCachedSettings, type ShopSettings } from '@/lib/khata'
import { useToast } from './Toast'
import ShopSettingsProvider from './ShopSettingsProvider'

const state = vi.hoisted(() => ({
  live: undefined as unknown,
  viewAs: undefined as string | undefined,
  args: [] as unknown[],
}))

vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    state.args.push(args)
    return args === 'skip' ? undefined : state.live
  },
}))
vi.mock('@/hooks/useOfflineOwner', () => ({ useOfflineOwner: () => ({ owner: 'user_a', source: 'clerk' }) }))
vi.mock('@/context/ViewAsContext', () => ({ useViewAsUserIdForQuery: () => state.viewAs }))

const ON: ShopSettings = { ...DEFAULT_SHOP_SETTINGS, khataEnabled: true, updatedAt: 2 }
const OFF: ShopSettings = { ...DEFAULT_SHOP_SETTINGS, khataEnabled: false, updatedAt: 3 }
const KEY = settingsCacheKey('user_a')

/** Stands in for a khata screen: shows its state and closes "a sheet" when khata turns off. */
function Probe() {
  const { khataOn, isLoading } = useShopSettings()
  const { showToast } = useToast()
  useOnKhataTurnedOff(() => showToast(KHATA_TURNED_OFF_MESSAGE, 'info'))
  return <p data-testid="probe">{isLoading ? 'loading' : khataOn ? 'on' : 'off'}</p>
}

const tree = () => <ToastProvider><ShopSettingsProvider><Probe /></ShopSettingsProvider></ToastProvider>

beforeEach(() => {
  localStorage.clear()
  state.live = undefined
  state.viewAs = undefined
  state.args = []
})
afterEach(cleanup)

describe('ShopSettingsProvider', () => {
  it('opens from the cached copy (no flash) until the server answers', () => {
    writeCachedSettings(KEY, ON)
    render(tree())
    expect(screen.getByTestId('probe').textContent).toBe('on')
  })

  it('first ever load: loading (treated as off), then the live value', () => {
    const { rerender } = render(tree())
    expect(screen.getByTestId('probe').textContent).toBe('loading')
    state.live = ON
    rerender(tree())
    expect(screen.getByTestId('probe').textContent).toBe('on')
    expect(readCachedSettings(KEY)).toEqual(ON)
  })

  it('remote change (admin turns it off): live wins, cache is overwritten, the UI follows with a toast', async () => {
    writeCachedSettings(KEY, ON)
    state.live = ON
    const { rerender } = render(tree())
    expect(screen.getByTestId('probe').textContent).toBe('on')

    state.live = OFF
    await act(async () => { rerender(tree()) })
    expect(screen.getByTestId('probe').textContent).toBe('off')
    expect(readCachedSettings(KEY)).toEqual(OFF)
    expect(screen.getByText(KHATA_TURNED_OFF_MESSAGE)).toBeTruthy()

    // …and back on again without a reload.
    state.live = { ...ON, updatedAt: 4 }
    await act(async () => { rerender(tree()) })
    expect(screen.getByTestId('probe').textContent).toBe('on')
    expect(readCachedSettings(KEY)?.updatedAt).toBe(4)
  })

  it('a stale cache never beats the server', () => {
    writeCachedSettings(KEY, ON)
    state.live = OFF
    render(tree())
    expect(screen.getByTestId('probe').textContent).toBe('off')
    expect(readCachedSettings(KEY)).toEqual(OFF)
  })

  it('admin view-as: queries the viewed user and never writes the admin cache', () => {
    writeCachedSettings(KEY, OFF)
    state.viewAs = 'u_other'
    state.live = ON
    render(tree())
    expect(state.args).toContainEqual({ viewAsUserId: 'u_other' })
    expect(screen.getByTestId('probe').textContent).toBe('on')
    expect(readCachedSettings(KEY)).toEqual(OFF)
    expect(Object.keys(localStorage).filter((k) => k.startsWith('roznaama-settings:'))).toEqual([KEY])
  })

  it('outside the provider (other screens, tests) khata is off', () => {
    render(<ToastProvider><Probe /></ToastProvider>)
    expect(screen.getByTestId('probe').textContent).toBe('off')
  })
})
