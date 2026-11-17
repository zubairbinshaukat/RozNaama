import { describe, expect, it } from 'vitest'
import { decideGuard, snapshotAvailability, type GuardInput, type GuardView } from './guardDecision'
import type { SnapshotRecord } from '@/lib/offline/snapshotTypes'

const base: GuardInput = {
  isLoaded: true,
  isSignedIn: true,
  browserOnline: true,
  clerkFailed: false,
  convexAuthenticated: true,
  syncStatus: 'ready',
  alreadySynced: true,
  snapshot: 'none',
}

describe('decideGuard decision table', () => {
  const rows: Array<[string, Partial<GuardInput>, GuardView]> = [
    // Clerk not loaded
    ['clerk loading, online, no snapshot', { isLoaded: false, isSignedIn: undefined }, 'loading-signin'],
    ['clerk loading + snapshot → instant open', { isLoaded: false, isSignedIn: undefined, snapshot: 'available' }, 'snapshot'],
    ['clerk loading, offline, no snapshot', { isLoaded: false, isSignedIn: undefined, browserOnline: false }, 'offline'],
    ['clerk loading, offline, snapshot still reading', { isLoaded: false, isSignedIn: undefined, browserOnline: false, snapshot: 'loading' }, 'loading-signin'],
    ['clerk loading, offline + snapshot', { isLoaded: false, isSignedIn: undefined, browserOnline: false, snapshot: 'available' }, 'snapshot'],
    ['clerk failed, no snapshot', { isLoaded: false, isSignedIn: undefined, clerkFailed: true }, 'offline'],
    ['clerk failed + snapshot', { isLoaded: false, isSignedIn: undefined, clerkFailed: true, snapshot: 'available' }, 'snapshot'],
    // Signed out
    ['signed out online → sign-in, even with a snapshot', { isSignedIn: false, snapshot: 'available' }, 'redirect'],
    ['signed out offline, no snapshot', { isSignedIn: false, browserOnline: false }, 'offline'],
    ['signed out offline + snapshot', { isSignedIn: false, browserOnline: false, snapshot: 'available' }, 'snapshot-signed-out'],
    ['signed out offline, snapshot still reading', { isSignedIn: false, browserOnline: false, snapshot: 'loading' }, 'loading-signin'],
    // Signed in, Convex auth pending
    ['connecting online, no snapshot', { convexAuthenticated: false }, 'loading-connecting'],
    ['connecting + snapshot → keep the dashboard', { convexAuthenticated: false, snapshot: 'available' }, 'snapshot'],
    ['connecting offline, no snapshot', { convexAuthenticated: false, browserOnline: false }, 'offline'],
    ['connecting offline + snapshot', { convexAuthenticated: false, browserOnline: false, snapshot: 'available' }, 'snapshot'],
    // Ready / user sync
    ['ready', {}, 'ready'],
    ['ready wins over a snapshot', { snapshot: 'available' }, 'ready'],
    ['first sync on this device blocks', { syncStatus: 'syncing', alreadySynced: false }, 'loading-setup'],
    ['background sync does not block', { syncStatus: 'syncing', alreadySynced: true }, 'ready'],
    ['sync error', { syncStatus: 'error' }, 'sync-error'],
  ]

  it.each(rows)('%s', (_name, patch, expected) => {
    expect(decideGuard({ ...base, ...patch })).toBe(expected)
  })
})

describe('snapshotAvailability', () => {
  const record = (owner: string) => ({ owner } as SnapshotRecord)

  it('none without a provider or owner', () => {
    expect(snapshotAvailability(null, null)).toBe('none')
    expect(snapshotAvailability({ owner: null, record: null, loaded: true }, null)).toBe('none')
  })

  it('available for the hint owner while Clerk is not loaded', () => {
    expect(snapshotAvailability({ owner: 'user_a', record: record('user_a'), loaded: true }, null)).toBe('available')
  })

  it('loading while IndexedDB is read, none when nothing was saved', () => {
    expect(snapshotAvailability({ owner: 'user_a', record: null, loaded: false }, null)).toBe('loading')
    expect(snapshotAvailability({ owner: 'user_a', record: null, loaded: true }, null)).toBe('none')
  })

  it("never another user's snapshot", () => {
    // Loaded Clerk user differs from the snapshot owner.
    expect(snapshotAvailability({ owner: 'user_a', record: record('user_a'), loaded: true }, 'user_b')).toBe('none')
    // Record of someone else under this owner key.
    expect(snapshotAvailability({ owner: 'user_a', record: record('user_b'), loaded: true }, null)).toBe('none')
  })
})
