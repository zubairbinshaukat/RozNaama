/**
 * Admin dashboard helpers: card show/hide preferences (per device,
 * localStorage) and "last active" wording. Only imported by the lazy admin
 * chunk (and its tests).
 */
import { startOfDay } from '@/lib/utils'
import { shortDayText } from '@/lib/period'

export const ADMIN_CARDS = [
  { id: 'users',        group: 'Platform overview', label: 'Total users' },
  { id: 'activeToday',  group: 'Platform overview', label: 'Active today' },
  { id: 'active7d',     group: 'Platform overview', label: 'Active, last 7 days' },
  { id: 'active30d',    group: 'Platform overview', label: 'Active, last 30 days' },
  { id: 'todaySales',   group: 'Platform overview', label: "Today's sales" },
  { id: 'monthSales',   group: 'Platform overview', label: "This month's sales" },
  { id: 'newUsers',     group: 'Platform overview', label: 'New users this month' },
  { id: 'userFigures',  group: 'User detail',       label: 'Today / month / all-time strip' },
  { id: 'userSummary',  group: 'User detail',       label: 'Period KPI cards' },
  { id: 'userCharts',   group: 'User detail',       label: 'Charts and entries' },
] as const

export type AdminCardId = (typeof ADMIN_CARDS)[number]['id']

export const ADMIN_CARDS_KEY = 'roznaama-admin-hidden-cards'

const CARD_IDS = new Set<string>(ADMIN_CARDS.map((c) => c.id))

function isCardId(value: unknown): value is AdminCardId {
  return typeof value === 'string' && CARD_IDS.has(value)
}

/** Hidden card ids saved on this device (unknown / corrupt entries are dropped). */
export function readHiddenCards(): AdminCardId[] {
  try {
    const raw = localStorage.getItem(ADMIN_CARDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isCardId))] : []
  } catch {
    return []
  }
}

export function writeHiddenCards(ids: readonly AdminCardId[]): void {
  try {
    localStorage.setItem(ADMIN_CARDS_KEY, JSON.stringify(ids))
  } catch {
    /* private mode / blocked storage: keep in memory only */
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "Never", "Today", "Yesterday", "3 days ago" (under 30 days), else the date
 * (shortDayText with the year). Calendar days on this device.
 */
export function lastActiveLabel(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'Never'
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(ms))) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return shortDayText(ms, true)
}

/** Client-side orders of the loaded rows; 'newest' / 'name' come from the server. */
export const USER_SORTS = [
  { id: 'recent',  label: 'Recent activity', server: 'newest' },
  { id: 'name',    label: 'Name',            server: 'name' },
  { id: 'allTime', label: 'All-time sales',  server: 'newest' },
  { id: 'newest',  label: 'Newest',          server: 'newest' },
] as const

export type UserSortId = (typeof USER_SORTS)[number]['id']

export type SortableUser = { name: string; lastActivityAt: number | null; allTimeSales: number }

/**
 * Order loaded rows for sorts the server cannot do across all users
 * (recent activity, all-time sales). 'name' / 'newest' keep the server order.
 */
export function sortLoadedUsers<T extends SortableUser>(rows: readonly T[], sort: UserSortId): T[] {
  if (sort === 'recent') {
    return [...rows].sort((a, b) => (b.lastActivityAt ?? -Infinity) - (a.lastActivityAt ?? -Infinity))
  }
  if (sort === 'allTime') return [...rows].sort((a, b) => b.allTimeSales - a.allTimeSales)
  return [...rows]
}
