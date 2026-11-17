import { useNetworkStatus } from '@/lib/network'
import { useLiveQueriesEnabled } from './offlineData'

/** Shown when an edit / delete / category change is tried without a connection. */
export const OFFLINE_EDIT_MESSAGE = 'Editing needs internet. New sales and expenses still save offline.'

/**
 * Edits, deletes and category changes go straight to the server (only NEW
 * sales and expenses are queued offline). False while offline, and in
 * snapshot mode (signed-in session not confirmed yet).
 */
export function useCanEditOnline(): boolean {
  const { isOffline } = useNetworkStatus()
  const live = useLiveQueriesEnabled()
  return live && !isOffline
}
