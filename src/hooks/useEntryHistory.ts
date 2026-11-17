import { useCallback, useSyncExternalStore } from 'react'
import { getEntryHistory, subscribeEntryHistory, type EntryHistory } from '@/lib/entryHistory'
import { useOfflineOwner } from './useOfflineOwner'

/**
 * The current user's smart-entry history (live: updates after a save or a
 * removed suggestion). Uses the Clerk user, or — while Clerk is unavailable
 * offline — the last signed-in user on this phone. `userId` is null when
 * signed out → empty history.
 */
export function useEntryHistory(): { userId: string | null; history: EntryHistory } {
  const { owner } = useOfflineOwner()
  const userId = owner
  const getSnapshot = useCallback(() => getEntryHistory(userId), [userId])
  const history = useSyncExternalStore(subscribeEntryHistory, getSnapshot, getSnapshot)
  return { userId, history }
}
