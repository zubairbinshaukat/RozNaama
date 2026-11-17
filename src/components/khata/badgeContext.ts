import { createContext, useContext } from 'react'
import type { KhataBadge } from '@/lib/khata'

export type KhataBadgeScopeValue = {
  /** Badges of the visible days, by sale session id. */
  badges: ReadonlyMap<string, KhataBadge>
  /** Open the badge's customer sheet; `openSale` shows the sale itself ("See sale"). */
  open:   (badge: KhataBadge, openSale: () => void) => void
}

/** Provided by KhataBadgeScope (Advance & Udhaar on). Null → plain day list. */
export const KhataBadgeContext = createContext<KhataBadgeScopeValue | null>(null)

export function useKhataBadgeScope(): KhataBadgeScopeValue | null {
  return useContext(KhataBadgeContext)
}

/** "Baqi 3,000" (amber) / "Advance · Ali" / "Received · Ali" / "Udhaar · Ali". */
export function badgeText(b: KhataBadge): { kind: 'baqi'; amount: number } | { kind: 'label'; text: string } {
  const name = (b.customerName as string | null | undefined)?.trim()
  const withName = (label: string) => (name ? `${label} · ${name}` : label)
  if (b.role === 'payment') return { kind: 'label', text: withName('Received') }
  if (b.kind === 'udhaar' && b.status === 'due' && b.remaining !== null && b.remaining > 0) {
    return { kind: 'baqi', amount: b.remaining }
  }
  return { kind: 'label', text: withName(b.kind === 'udhaar' ? 'Udhaar' : 'Advance') }
}
