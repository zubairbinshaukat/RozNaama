import { createContext, useContext, useEffect, useRef } from 'react'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { DEFAULT_SHOP_SETTINGS, type ShopSettings } from '@/lib/khata'
import { useLiveQueriesEnabled } from './offlineData'

export type ShopSettingsState = {
  /** Live, else this phone's cached copy, else the defaults (khata off). */
  settings:  ShopSettings
  /** Nothing live or cached yet (first ever load): treat as off, no flash. */
  isLoading: boolean
  /** Advance & Udhaar is switched on for the (view-as) shop. */
  khataOn:   boolean
  /** The settings came from the server in this session (not only the cache). */
  isLive:    boolean
}

export type ShopSettingsContextValue = ShopSettingsState & {
  /** Which user the provider read (view-as target), to ignore it under ViewAsOverride. */
  viewAsUserId: string | undefined
}

/** Set by ShopSettingsProvider (protected routes). Null elsewhere → khata off. */
export const ShopSettingsContext = createContext<ShopSettingsContextValue | null>(null)

const OFF: ShopSettingsState = { settings: DEFAULT_SHOP_SETTINGS, isLoading: false, khataOn: false, isLive: false }

/**
 * Shop settings (Advance & Udhaar opt-in + recognition modes), view-as aware.
 * Outside the provider, or for a different scoped user (admin watchlist
 * `ViewAsOverride`), it reports khata off so those screens stay as they are.
 */
export function useShopSettings(): ShopSettingsState {
  const ctx = useContext(ShopSettingsContext)
  const scoped = useViewAsUserIdForQuery()
  if (!ctx || ctx.viewAsUserId !== scoped) return OFF
  return ctx
}

/** Shown when khata is switched off elsewhere (another phone / admin) while a khata sheet is open. */
export const KHATA_TURNED_OFF_MESSAGE = 'Advance & Udhaar was turned off.'

/**
 * Calls `onOff` once when khata flips from on to off while mounted (e.g. an
 * admin changed the setting remotely), so open khata sheets can close.
 */
export function useOnKhataTurnedOff(onOff: () => void): void {
  const { khataOn } = useShopSettings()
  const prev = useRef(khataOn)
  const cb = useRef(onOff)
  useEffect(() => { cb.current = onOff }, [onOff])
  useEffect(() => {
    if (prev.current && !khataOn) cb.current()
    prev.current = khataOn
  }, [khataOn])
}

/**
 * True when khata queries may run: khata on and live queries enabled (not in
 * snapshot-only mode). Khata hooks pass 'skip' otherwise.
 */
export function useKhataQueriesEnabled(): boolean {
  const { khataOn } = useShopSettings()
  const live = useLiveQueriesEnabled()
  return khataOn && live
}
