import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredOutboxRecord } from './offline/types'
import type { SnapshotRecord } from './offline/snapshotTypes'

export const DB_NAME = 'roznaama-db'
/**
 * v1: unused `sales` + `pendingSync` stores (never written by a released build).
 * v2: `outbox` (offline sales/expenses) + `snapshots` (instant-open dashboard).
 * Bump only with a new branch in `upgrade()`; entry shape changes use the
 * per-entry `v` field instead (see offline/types.ts).
 */
export const DB_VERSION = 2

export interface RozNaamaDB extends DBSchema {
  outbox: {
    key: string
    value: StoredOutboxRecord
    indexes: { by_owner_createdAt: [string, number] }
  }
  snapshots: {
    key: string
    value: SnapshotRecord
  }
}

export type RozNaamaDBHandle = IDBPDatabase<RozNaamaDB>

let dbPromise: Promise<RozNaamaDBHandle> | null = null

function open(): Promise<RozNaamaDBHandle> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available'))
  return openDB<RozNaamaDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 2) {
        // Untyped access: the v1 stores are not part of the v2 schema.
        const legacy = database as unknown as IDBPDatabase
        for (const name of ['sales', 'pendingSync']) {
          if (legacy.objectStoreNames.contains(name)) legacy.deleteObjectStore(name)
        }
        if (!database.objectStoreNames.contains('outbox')) {
          const outbox = database.createObjectStore('outbox', { keyPath: 'id' })
          outbox.createIndex('by_owner_createdAt', ['owner', 'createdAt'])
        }
        if (!database.objectStoreNames.contains('snapshots')) {
          database.createObjectStore('snapshots', { keyPath: 'key' })
        }
      }
    },
    blocking(_currentVersion, _blockedVersion, event) {
      // A newer tab wants to upgrade: let it (this tab reopens on next access).
      const target = event.target
      if (target instanceof IDBDatabase) target.close()
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
  })
}

/** Get (or open) the IndexedDB instance. Lazy; rejects when IndexedDB is unavailable. */
export function getDB(): Promise<RozNaamaDBHandle> {
  if (!dbPromise) {
    const p = open()
    dbPromise = p
    // A failed open must not be cached (private mode, quota, blocked upgrade).
    p.catch(() => { if (dbPromise === p) dbPromise = null })
  }
  return dbPromise
}

/** Close and forget the connection (tests, sign-out cleanup). */
export async function closeDB(): Promise<void> {
  const p = dbPromise
  dbPromise = null
  if (!p) return
  try {
    ;(await p).close()
  } catch {
    // never opened
  }
}
