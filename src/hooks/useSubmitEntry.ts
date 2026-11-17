import { useCallback, useContext } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { useNetworkStatus } from '@/lib/network'
import { getClientTimeZone, toLocalDateKey } from '@/lib/utils'
import { ERROR_CODES, type ErrorCode } from '@/lib/errors'
import { OutboxContext } from '@/lib/offline/context'
import { newClientRequestId } from '@/lib/offline/ids'
import {
  OUTBOX_ENTRY_VERSION,
  type ExpenseArgs,
  type ExpenseResult,
  type OutboxEntry,
  type OutboxProblem,
  type SaleArgs,
  type SaleItemArgs,
  type SaleResult,
} from '@/lib/offline/types'

/** How long an online submit waits for the server before reporting "queued". */
export const SUBMIT_ONLINE_WAIT_MS = 4000

export type SubmitResult<R> =
  /** Confirmed by the server. */
  | { status: 'saved'; entryId: string; result: R }
  /** Saved on this phone; syncs later. `problem` set when it already needs attention. */
  | { status: 'queued'; entryId: string; problem?: OutboxProblem }

export type SubmitSaleArgs = SaleArgs & {
  /** categoryId → name, so the pending row can show the category offline. */
  categoryLabels?: Record<string, string>
}
export type SubmitExpenseArgs = ExpenseArgs

export const VIEW_AS_SUBMIT_MESSAGE = 'Switch back to your own account to add entries.'
export const SIGNED_OUT_SUBMIT_MESSAGE = 'Please sign in again to save.'
export const STORAGE_FAILED_MESSAGE = "Couldn't save on this phone. Connect to the internet and try again."

/** ConvexError so existing modal error handling (`getErrorMessage`) shows the text. */
function blocked(code: ErrorCode, message: string): ConvexError<{ code: ErrorCode; message: string }> {
  return new ConvexError({ code, message })
}

function buildEntry(owner: string, id: string, input: { kind: 'sale'; args: SubmitSaleArgs } | { kind: 'expense'; args: SubmitExpenseArgs }): OutboxEntry {
  const now = Date.now()
  const base = {
    v: OUTBOX_ENTRY_VERSION as typeof OUTBOX_ENTRY_VERSION,
    id,
    owner,
    tz: getClientTimeZone(),
    createdAt: now,
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: 0,
  }
  if (input.kind === 'sale') {
    const { categoryLabels, items, sessionDate } = input.args
    return {
      ...base,
      kind: 'sale',
      dayKey: toLocalDateKey(sessionDate),
      args: { items: items.map(pickItem), sessionDate },
      ...(categoryLabels ? { categoryLabels: { ...categoryLabels } } : {}),
    }
  }
  const { amount, expenseDate, note } = input.args
  return {
    ...base,
    kind: 'expense',
    dayKey: toLocalDateKey(expenseDate),
    args: { amount, expenseDate, ...(note !== undefined ? { note } : {}) },
  }
}

/** Only the fields `saleSessions.record` accepts (extra fields would fail server validation forever). */
function pickItem(i: SaleItemArgs): SaleItemArgs {
  return {
    productName: i.productName,
    amount: i.amount,
    ...(i.categoryId !== undefined ? { categoryId: i.categoryId } : {}),
    ...(i.note !== undefined ? { note: i.note } : {}),
  }
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * New sales / expenses, offline-first: every submit is put in the outbox
 * first, then flushed. Online, it waits up to 4 s for the server ('saved'),
 * else reports 'queued' ("Saved on phone — will sync"). If the outbox write
 * fails while online, the mutation is sent directly with the same
 * clientRequestId (never both). Throws a ConvexError (shown by
 * `getErrorMessage`) in admin view-as or without a signed-in owner, and when
 * the write fails offline.
 */
export function useSubmitEntry(): {
  submitSale: (args: SubmitSaleArgs) => Promise<SubmitResult<SaleResult>>
  submitExpense: (args: SubmitExpenseArgs) => Promise<SubmitResult<ExpenseResult>>
} {
  const ctx = useContext(OutboxContext)
  const viewingOther = useViewAsUserIdForQuery() !== undefined
  const { isOffline } = useNetworkStatus()
  const recordSale = useMutation(api.saleSessions.record)
  const recordExpense = useMutation(api.expenses.record)

  const engine = ctx?.engine ?? null
  const owner = ctx?.owner ?? null
  const hasProvider = ctx !== null

  const submit = useCallback(
    async <R>(
      input: { kind: 'sale'; args: SubmitSaleArgs } | { kind: 'expense'; args: SubmitExpenseArgs },
      direct: (clientRequestId: string) => Promise<R>,
    ): Promise<SubmitResult<R>> => {
      if (viewingOther) throw blocked(ERROR_CODES.FORBIDDEN, VIEW_AS_SUBMIT_MESSAGE)
      const id = newClientRequestId()
      if (!hasProvider) {
        // Outside OutboxProvider (legacy mounts / tests): plain mutation, still idempotent.
        return { status: 'saved', entryId: id, result: await direct(id) }
      }
      if (!engine || !owner) throw blocked(ERROR_CODES.UNAUTHORIZED, SIGNED_OUT_SUBMIT_MESSAGE)

      const online = browserOnline() && !isOffline
      const entry = buildEntry(owner, id, input)
      // Register before enqueue so a very fast sync is not missed.
      const outcome = online ? engine.waitFor(id, SUBMIT_ONLINE_WAIT_MS) : null
      try {
        await engine.enqueue(entry)
      } catch {
        if (online) return { status: 'saved', entryId: id, result: await direct(id) }
        throw blocked(ERROR_CODES.VALIDATION, STORAGE_FAILED_MESSAGE)
      }
      if (!outcome) return { status: 'queued', entryId: id }
      const o = await outcome
      if (o.status === 'saved') return { status: 'saved', entryId: id, result: o.result.result as R }
      return o.problem ? { status: 'queued', entryId: id, problem: o.problem } : { status: 'queued', entryId: id }
    },
    [viewingOther, hasProvider, engine, owner, isOffline],
  )

  const submitSale = useCallback(
    (args: SubmitSaleArgs) => {
      const plain = { items: args.items.map(pickItem), sessionDate: args.sessionDate }
      return submit<SaleResult>({ kind: 'sale', args }, (clientRequestId) => recordSale({ ...plain, clientRequestId }))
    },
    [submit, recordSale],
  )

  const submitExpense = useCallback(
    (args: SubmitExpenseArgs) =>
      submit<ExpenseResult>({ kind: 'expense', args }, (clientRequestId) => recordExpense({
        amount: args.amount,
        expenseDate: args.expenseDate,
        ...(args.note !== undefined ? { note: args.note } : {}),
        clientRequestId,
      })),
    [submit, recordExpense],
  )

  return { submitSale, submitExpense }
}
