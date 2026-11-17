/**
 * Small localStorage hints that let the app start without waiting on the network.
 * Every access is guarded: storage may be unavailable (private mode, quota, policy).
 */

const SYNCED_PREFIX = 'rn-user-synced:'
export const LAST_USER_KEY = 'rn-last-user'

export interface LastUserHint {
  /** Clerk user id */
  id: string
  name: string
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable — the app just takes the slower (blocking) path.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** True once `upsertUser` has succeeded for this Clerk user on this device. */
export function isUserSynced(clerkUserId: string): boolean {
  return safeGet(SYNCED_PREFIX + clerkUserId) === '1'
}

export function markUserSynced(clerkUserId: string): void {
  safeSet(SYNCED_PREFIX + clerkUserId, '1')
}

export function clearUserSynced(clerkUserId: string): void {
  safeRemove(SYNCED_PREFIX + clerkUserId)
}

/** Last signed-in user on this device (for WP-B snapshot mode while Clerk is unavailable). */
export function readLastUserHint(): LastUserHint | null {
  const raw = safeGet(LAST_USER_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      typeof (parsed as { name?: unknown }).name === 'string'
    ) {
      const { id, name } = parsed as LastUserHint
      return { id, name }
    }
  } catch {
    // fall through
  }
  return null
}

export function writeLastUserHint(hint: LastUserHint): void {
  const current = readLastUserHint()
  if (current && current.id === hint.id && current.name === hint.name) return
  safeSet(LAST_USER_KEY, JSON.stringify({ id: hint.id, name: hint.name }))
}

/** Only on a confirmed ONLINE sign-out (Clerk loaded, signed out, navigator online). */
export function clearLastUserHint(): void {
  safeRemove(LAST_USER_KEY)
}
