import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import SheetFallback from '@/components/shared/SheetFallback'
import { useKhataBadges } from '@/hooks/useKhata'
import { dateKeyToLocalMs } from '@/lib/dayGroups'
import type { KhataBadge } from '@/lib/khata'
import { endOfDay } from '@/lib/utils'
import { KhataBadgeContext, type KhataBadgeScopeValue } from './badgeContext'

const CustomerSheet = lazy(() => import('./CustomerSheet'))

const EMPTY = new Map<string, KhataBadge>()

type OpenSheet = { badge: KhataBadge; openSale: () => void }

/**
 * Advance & Udhaar on: loads `khata.badgesForRange` for the visible days and
 * lets day-list rows open their customer sheet. Mounted only when khata is on.
 */
export default function KhataBadgeScope({ dateKeys, onSheetOpenChange, children }: {
  dateKeys: readonly string[]
  /** Tells the (always mounted) list whether a customer sheet is open. */
  onSheetOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  const { start, end } = useMemo(() => {
    const ms = dateKeys.map(dateKeyToLocalMs).filter(Number.isFinite)
    if (ms.length === 0) return { start: null, end: null }
    return { start: Math.min(...ms), end: endOfDay(new Date(Math.max(...ms))) }
  }, [dateKeys])
  const badges = useKhataBadges(start, end)
  const [open, setOpenState] = useState<OpenSheet | null>(null)
  const setOpen = useCallback((next: OpenSheet | null) => {
    setOpenState(next)
    onSheetOpenChange?.(next !== null)
  }, [onSheetOpenChange])

  const openBadge = useCallback((badge: KhataBadge, openSale: () => void) => setOpen({ badge, openSale }), [setOpen])
  const value = useMemo((): KhataBadgeScopeValue => ({ badges: badges ?? EMPTY, open: openBadge }), [badges, openBadge])

  return (
    <KhataBadgeContext.Provider value={value}>
      {children}
      {open && (
        <Suspense fallback={<SheetFallback />}>
          <CustomerSheet
            customerId={open.badge.customerId}
            focusEntryId={open.badge.entryId}
            onOpenSale={() => { const s = open.openSale; setOpen(null); s() }}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </KhataBadgeContext.Provider>
  )
}
