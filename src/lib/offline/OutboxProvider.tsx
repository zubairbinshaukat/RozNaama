import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useConvex, useConvexAuth, useConvexConnectionState } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useOfflineOwner } from '@/hooks/useOfflineOwner'
import { OutboxContext, type OutboxContextValue } from './context'
import type { OutboxEngineState } from './outboxEngine'
import { configureOutboxSender, getOutboxEngine, startOutboxEngine } from './outboxRuntime'
import type { OutboxEntry, SendResult } from './types'

/** While entries wait and the page is visible, try again this often. */
export const OUTBOX_INTERVAL_MS = 30_000

const noopSubscribe = () => () => {}
const nullState = (): OutboxEngineState | null => null

/**
 * Runs the offline outbox for the current owner: sends queued sales /
 * expenses when Convex is authenticated, and re-tries on online / visible /
 * Convex reconnect / every 30 s while entries wait.
 * Mount inside ClerkProvider + ConvexProvider (above the routes, so the
 * offline banner and every page see the same queue).
 */
export default function OutboxProvider({ children }: { children: ReactNode }) {
  const { owner, source } = useOfflineOwner()
  const convex = useConvex()
  const { isAuthenticated } = useConvexAuth()
  const { isWebSocketConnected } = useConvexConnectionState()
  const engine = owner ? getOutboxEngine(owner) : null
  const state = useSyncExternalStore(
    engine?.subscribe ?? noopSubscribe,
    engine?.getState ?? nullState,
    engine?.getState ?? nullState,
  )

  useEffect(() => {
    configureOutboxSender(async (entry: OutboxEntry): Promise<SendResult> => {
      const clientRequestId = entry.id
      switch (entry.kind) {
        case 'sale':
          return { kind: 'sale', result: await convex.mutation(api.saleSessions.record, { ...entry.args, clientRequestId }) }
        case 'expense':
          return { kind: 'expense', result: await convex.mutation(api.expenses.record, { ...entry.args, clientRequestId }) }
        case 'khataSale':
          return { kind: 'khataSale', result: await convex.mutation(api.khata.recordSale, { ...entry.args, clientRequestId }) }
        case 'khataAdvance':
          return { kind: 'khataAdvance', result: await convex.mutation(api.khata.openAdvance, { ...entry.args, clientRequestId }) }
        case 'khataPayment':
          return { kind: 'khataPayment', result: await convex.mutation(api.khata.receivePayment, { ...entry.args, clientRequestId }) }
      }
    })
  }, [convex])

  useEffect(() => {
    if (engine) startOutboxEngine(engine)
  }, [engine])

  // Only a Clerk-confirmed session may send (never on the last-user hint alone).
  const authReady = isAuthenticated && source === 'clerk'
  useEffect(() => {
    engine?.setAuthReady(authReady)
  }, [engine, authReady])

  // Convex reconnect.
  useEffect(() => {
    if (isWebSocketConnected) engine?.trigger()
  }, [engine, isWebSocketConnected])

  useEffect(() => {
    if (!engine) return
    const onOnline = () => engine.trigger()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void engine.refresh().then(() => engine.trigger())
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [engine])

  const hasPending = (state?.entries.some((e) => e.status === 'pending')) ?? false
  useEffect(() => {
    if (!engine || !hasPending) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') engine.trigger()
    }, OUTBOX_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [engine, hasPending])

  const value = useMemo(
    (): OutboxContextValue => ({ owner, ownerSource: source, engine, state }),
    [owner, source, engine, state],
  )
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>
}
