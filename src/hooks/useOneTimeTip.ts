import { useCallback, useMemo, useState } from 'react'

/** Base keys of the one-time tips (bump the version to show a tip again). */
export const TIP_KEYS = {
  amountsEye: 'roznaama-tip-eye-v1',
} as const

/** Per-user key: `<base>:<clerkUserId>`, or null when nobody is signed in. */
export function tipStorageKey(base: string, userId: string | null | undefined): string | null {
  return userId ? `${base}:${userId}` : null
}

export type TipStatus = 'unseen' | 'seen' | 'unavailable'

const PROBE_KEY = 'roznaama-tip-probe'

/**
 * Seen / unseen from localStorage. Storage that can't be read or written
 * (blocked, private mode) is 'unavailable': the tip is then never shown,
 * rather than shown on every visit.
 */
export function readTipStatus(key: string): TipStatus {
  try {
    if (localStorage.getItem(key) !== null) return 'seen'
    localStorage.setItem(PROBE_KEY, '1')
    localStorage.removeItem(PROBE_KEY)
    return 'unseen'
  } catch {
    return 'unavailable'
  }
}

export function writeTipSeen(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()))
  } catch {
    /* storage went away: the in-memory flag still hides it for this visit */
  }
}

/**
 * One-time tip state for `key` (null = no user → never shown).
 * `shouldShow` is read again whenever the key changes (e.g. another user signs in).
 */
export function useOneTimeTip(key: string | null): { shouldShow: boolean; markSeen: () => void } {
  const [seenNow, setSeenNow] = useState<string | null>(null)
  const status = useMemo<TipStatus>(() => (key ? readTipStatus(key) : 'unavailable'), [key])
  const markSeen = useCallback(() => {
    if (!key) return
    writeTipSeen(key)
    setSeenNow(key)
  }, [key])
  return { shouldShow: key !== null && status === 'unseen' && seenNow !== key, markSeen }
}
