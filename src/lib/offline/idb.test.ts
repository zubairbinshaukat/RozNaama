import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDB, DB_NAME, getDB } from '@/lib/db'
import { IdbOutboxStore } from './outboxStore'
import { applySnapshotPatch, emptySnapshot, idbSnapshotIO } from './snapshot'
import type { StoredOutboxRecord } from './types'
import { expenseEntry, saleEntry } from './testUtils'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(async () => {
  await closeDB()
})

const rec = (e: object) => e as unknown as StoredOutboxRecord

describe('IndexedDB v2', () => {
  it('upgrades v1 (drops unused sales / pendingSync, adds outbox + snapshots)', async () => {
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('sales', { keyPath: 'id' })
        db.createObjectStore('pendingSync', { keyPath: 'id' })
      },
    })
    v1.close()
    const db = await getDB()
    expect([...db.objectStoreNames].sort()).toEqual(['outbox', 'snapshots'])
    expect([...db.transaction('outbox').store.indexNames]).toEqual(['by_owner_createdAt'])
  })

  it('outbox store: per-owner FIFO list, get, put (replace), delete', async () => {
    const store = new IdbOutboxStore()
    await store.put(rec(saleEntry('b', { createdAt: 2 })))
    await store.put(rec(expenseEntry('a', { createdAt: 1 })))
    await store.put(rec(saleEntry('x', { owner: 'user_b', createdAt: 0 })))
    expect((await store.list('user_a')).map((r) => r.id)).toEqual(['a', 'b'])
    expect((await store.list('user_b')).map((r) => r.id)).toEqual(['x'])

    await store.put(rec(saleEntry('b', { createdAt: 2, attempts: 3 })))
    expect((await store.get('b'))?.attempts).toBe(3)
    await store.delete('b')
    expect(await store.get('b')).toBeUndefined()
    expect((await store.list('user_a')).map((r) => r.id)).toEqual(['a'])
  })

  it('snapshot IO round-trips and refuses other owners', async () => {
    const now = Date.parse('2026-03-12T10:00:00+05:00')
    const snap = applySnapshotPatch(emptySnapshot('user_a', now), { kind: 'availableYears', value: [2026] }, now)
    await idbSnapshotIO.write(snap)
    expect(await idbSnapshotIO.read('user_a')).toEqual(snap)
    expect(await idbSnapshotIO.read('user_b')).toBeNull()
    await idbSnapshotIO.remove('user_a')
    expect(await idbSnapshotIO.read('user_a')).toBeNull()
  })
})
