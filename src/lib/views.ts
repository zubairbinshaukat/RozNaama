/** The four dashboard periods, in order (swipe / arrow keys follow this order). */
export const VIEWS = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type View = (typeof VIEWS)[number]

export const VIEW_LABELS: Record<View, string> = {
  daily:   'Daily',
  weekly:  'Weekly',
  monthly: 'Monthly',
  yearly:  'Yearly',
}

export const VIEW_PANEL_ID = 'dashboard-view-panel'

export function viewTabId(view: View, variant: 'top' | 'bottom'): string {
  return `view-tab-${variant}-${view}`
}
