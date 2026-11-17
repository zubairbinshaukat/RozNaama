/**
 * Outbox persistence. The engine works against `OutboxStore`; production uses
 * IndexedDB, tests use the in-memory store.
 */
import { getDB } from '@/lib/db'
import type { StoredOutboxRecord } from './types'

export interface OutboxStore {
  /** All records of `owner`, oldest first (createdAt, then id). Any `v`. */
  list(owner: string): Promise<StoredOutboxRecord[]>
  get(id: string): Promise<StoredOutboxRecord | undefined>
  /** Insert or replace. Rejects when the write did not commit. */
  put(record: StoredOutboxRecord): Promise<void>
  delete(id: string): Promise<void>
}

const byCreated = (a: StoredOutboxRecord, b: StoredOutboxRecord) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export class InMemoryOutboxStore implements OutboxStore {
  readonly records = new Map<string, StoredOutboxRecord>()
  /** Set to make the next writes fail (tests). */
  failWrites = false

  async list(owner: string): Promise<StoredOutboxRecord[]> {
    return [...this.records.values()].filter((r) => r.owner === owner).map((r) => structuredClone(r)).sort(byCreated)
  }

  async get(id: string): Promise<StoredOutboxRecord | undefined> {
    const r = this.records.get(id)
    return r ? structuredClone(r) : undefined
  }

  async put(record: StoredOutboxRecord): Promise<void> {
    if (this.failWrites) throw new Error('write failed')
    this.records.set(record.id, structuredClone(record))
  }

  async delete(id: string): Promise<void> {
    if (this.failWrites) throw new Error('write failed')
    this.records.delete(id)
  }
}

export class IdbOutboxStore implements OutboxStore {
  async list(owner: string): Promise<StoredOutboxRecord[]> {
    const db = await getDB()
    const range = IDBKeyRange.bound([owner, -Infinity], [owner, Infinity])
    const rows = await db.getAllFromIndex('outbox', 'by_owner_createdAt', range)
    return rows.sort(byCreated)
  }

  async get(id: string): Promise<StoredOutboxRecord | undefined> {
    const db = await getDB()
    return db.get('outbox', id)
  }

  async put(record: StoredOutboxRecord): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('outbox', 'readwrite')
    await Promise.all([tx.store.put(record), tx.done])
  }

  async delete(id: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('outbox', 'readwrite')
    await Promise.all([tx.store.delete(id), tx.done])
  }
}
