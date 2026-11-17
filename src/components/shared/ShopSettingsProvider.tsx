import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { useLiveQueriesEnabled } from '@/hooks/offlineData'
import { useOfflineOwner } from '@/hooks/useOfflineOwner'
import { ShopSettingsContext, type ShopSettingsContextValue } from '@/hooks/useShopSettings'
import {
  DEFAULT_SHOP_SETTINGS,
  parseShopSettings,
  readCachedSettings,
  settingsCacheKey,
  writeCachedSettings,
  type ShopSettings,
} from '@/lib/khata'

function sameSettings(a: ShopSettings | null, b: ShopSettings): boolean {
  return a !== null && a.khataEnabled === b.khataEnabled && a.advanceRecognition === b.advanceRecognition &&
    a.udhaarRecognition === b.udhaarRecognition && a.updatedAt === b.updatedAt
}

/**
 * Runs the one always-on khata query (`settings.get`, tiny) for the signed-in
 * (or view-as) shop. The live result always wins and immediately overwrites
 * this phone's copy (`roznaama-settings:<clerkUserId>`) whenever it differs —
 * also when an admin changes the settings remotely while the app is open.
 * The copy is only used until the first live result (startup / offline).
 * Admin view-as never reads or writes the admin's own cache key (nothing is
 * cached for a viewed user). Mount inside ViewAsProvider.
 */
export default function ShopSettingsProvider({ children }: { children: ReactNode }) {
  const { owner } = useOfflineOwner()
  const viewAsUserId = useViewAsUserIdForQuery()
  const ready = useLiveQueriesEnabled()
  const live = useQuery(api.settings.get, ready ? (viewAsUserId ? { viewAsUserId } : {}) : 'skip')
  // Own data only: view-as must never touch the admin's cache.
  const key = owner && viewAsUserId === undefined ? settingsCacheKey(owner) : null
  const fromLive = useMemo(() => (live ? parseShopSettings(live) : null), [live])
  // Last known value for this key: the cache at startup, then every live result.
  const [known, setKnown] = useState<{ key: string | null; value: ShopSettings | null }>(() => ({
    key,
    value: key ? readCachedSettings(key) : null,
  }))
  if (known.key !== key) setKnown({ key, value: key ? readCachedSettings(key) : null })
  else if (fromLive && !sameSettings(known.value, fromLive)) setKnown({ key, value: fromLive })
  // View-as (no key): nothing cached, so another user's settings never flash.
  const cached = key !== null && known.key === key ? known.value : null

  // The server always wins: overwrite this phone's copy whenever it differs.
  useEffect(() => {
    if (!key || !fromLive) return
    if (sameSettings(readCachedSettings(key), fromLive)) return
    writeCachedSettings(key, fromLive)
  }, [key, fromLive])

  const value = useMemo((): ShopSettingsContextValue => {
    const settings = fromLive ?? cached ?? DEFAULT_SHOP_SETTINGS
    return {
      settings,
      isLoading: !fromLive && !cached,
      khataOn: settings.khataEnabled,
      isLive: fromLive !== null,
      viewAsUserId,
    }
  }, [fromLive, cached, viewAsUserId])

  return <ShopSettingsContext.Provider value={value}>{children}</ShopSettingsContext.Provider>
}
