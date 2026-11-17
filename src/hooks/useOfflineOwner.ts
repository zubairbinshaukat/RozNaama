import { useUser } from '@clerk/clerk-react'
import { useBrowserOnline } from '@/lib/network'
import { readLastUserHint } from '@/lib/userHints'
import type { OwnerSource } from '@/lib/offline/context'

export type OfflineOwner = { owner: string | null; source: OwnerSource }

/**
 * Whose offline data (outbox, snapshot) this device should use:
 * - Clerk loaded with a user → that user ('clerk');
 * - Clerk not loaded, or signed out while offline (cannot be confirmed) →
 *   the `rn-last-user` hint ('hint');
 * - otherwise nobody.
 */
export function useOfflineOwner(): OfflineOwner {
  const { isLoaded, user } = useUser()
  const online = useBrowserOnline()
  if (isLoaded && user) return { owner: user.id, source: 'clerk' }
  if (!isLoaded || !online) {
    const hint = readLastUserHint()
    if (hint) return { owner: hint.id, source: 'hint' }
  }
  return { owner: null, source: 'none' }
}
