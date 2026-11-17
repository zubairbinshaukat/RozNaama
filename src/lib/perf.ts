/**
 * Startup performance marks. Always cheap (`performance.mark`, once per name);
 * printed with `console.table` only when the page was opened with `?perf=1`
 * (remembered for the tab, so it survives the /sign-in → /dashboard redirect).
 */
export const PERF_MARKS = {
  boot: 'rn:boot',
  clerkLoaded: 'rn:clerk-loaded',
  convexAuth: 'rn:convex-auth',
  upsertDone: 'rn:upsert-done',
  // Reserved for WP-B (instant-open snapshot):
  firstDataSnapshot: 'rn:first-data-snapshot',
  firstDataLive: 'rn:first-data-live',
} as const

export type PerfMarkName = (typeof PERF_MARKS)[keyof typeof PERF_MARKS]

const PERF_FLAG_KEY = 'rn-perf'
const REPORT_DEBOUNCE_MS = 500

const marked = new Set<PerfMarkName>()
let reportTimer: ReturnType<typeof setTimeout> | null = null

export function isPerfReportingEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const param = new URLSearchParams(window.location.search).get('perf')
    if (param === '1') sessionStorage.setItem(PERF_FLAG_KEY, '1')
    else if (param === '0') sessionStorage.removeItem(PERF_FLAG_KEY)
    return sessionStorage.getItem(PERF_FLAG_KEY) === '1'
  } catch {
    return new URLSearchParams(window.location.search).get('perf') === '1'
  }
}

/** Records `name` once per page load. */
export function perfMark(name: PerfMarkName): void {
  if (marked.has(name) || typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  marked.add(name)
  performance.mark(name)
  if (isPerfReportingEnabled()) scheduleReport()
}

function scheduleReport(): void {
  if (reportTimer) clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    reportTimer = null
    const rows: Record<string, { ms: number }> = {}
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav) {
      rows['nav:responseEnd'] = { ms: Math.round(nav.responseEnd) }
      rows['nav:domContentLoaded'] = { ms: Math.round(nav.domContentLoadedEventEnd) }
    }
    for (const entry of performance.getEntriesByType('mark')) {
      if (entry.name.startsWith('rn:')) rows[entry.name] = { ms: Math.round(entry.startTime) }
    }
    console.table(rows)
  }, REPORT_DEBOUNCE_MS)
}
