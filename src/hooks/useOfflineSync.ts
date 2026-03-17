import { useState, useEffect } from 'react'
import { getDB } from '@/lib/db'

/** Drain unsynced writes from IndexedDB when connectivity is restored. */
async function syncPendingOperations(): Promise<void> {
  const db = await getDB()
  const pending = await db.getAll('pendingSync')

  if (pending.length === 0) return

  // TODO: iterate pending operations and replay them against Convex
  // e.g. await convex.mutation(api.sales.create, op.data)
  // For now just log — full sync implemented with auth/dashboard work
  console.log(`[offline-sync] ${pending.length} operations queued for sync`)
}

/**
 * Monitors online/offline state and auto-syncs pending IndexedDB writes
 * when connectivity is restored.
 */
export function useOfflineSync(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      syncPendingOperations().catch(console.error)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline }
}
