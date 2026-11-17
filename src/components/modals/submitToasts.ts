import type { OutboxProblem } from '@/lib/offline/types'
import type { ToastType } from '@/components/shared/Toast'

export const QUEUED_MESSAGE = 'Saved on phone — will sync'

/** Toast for a sale / expense kept in this phone's outbox (not yet on the server). */
export function queuedToast(problem: OutboxProblem | undefined): { message: string; type: ToastType } {
  if (problem?.message) return { message: `Saved on phone. ${problem.message}`, type: 'info' }
  return { message: QUEUED_MESSAGE, type: 'success' }
}
