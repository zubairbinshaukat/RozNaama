import { openDB, type IDBPDatabase } from 'idb'

/** Sale record stored locally for offline-first support */
interface SaleRecord {
  id:        string
  amount:    number
  product:   string
  quantity:  number
  timestamp: number
  synced:    boolean
}

/** Pending write operation queued while device is offline */
interface PendingSyncRecord {
  id:        string
  operation: 'create' | 'update' | 'delete'
  data:      unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: IDBPDatabase<any> | null = null

/** Get (or open) the IndexedDB instance. Lazy-initialised on first call. */
export async function getDB(): Promise<IDBPDatabase<any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!db) {
    db = await openDB('roznaama-db', 1, {
      upgrade(database) {
        const salesStore = database.createObjectStore('sales', { keyPath: 'id' })
        salesStore.createIndex('by-synced',    'synced')
        salesStore.createIndex('by-timestamp', 'timestamp')

        database.createObjectStore('pendingSync', { keyPath: 'id' })
      },
    })
  }
  return db
}

export type { SaleRecord, PendingSyncRecord }
