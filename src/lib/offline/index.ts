/** Offline core public API (WP-B). Hooks live in src/hooks. */
export { default as SnapshotProvider } from './SnapshotProvider'
export { default as OutboxProvider } from './OutboxProvider'
export { default as DataReadyProvider } from './DataReadyProvider'
export { DataReadyContext, type DataReadyMode } from './context'
export { preloadSnapshot, clearSnapshot, readLastUserHint, type SnapshotRecord, type LastUserHint } from './snapshot'
export { isPendingId, pendingEntryIdOf, applyPendingToStats, applyPendingToFeed } from './overlay'
export type { OutboxEntry, OutboxProblem, OutboxProblemReason, SaleArgs, ExpenseArgs } from './types'
