import { useCallback, useContext } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { useNetworkStatus } from '@/lib/network'
import { getClientTimeZone, toLocalDateKey } from '@/lib/utils'
import { ERROR_CODES, type ErrorCode } from '@/lib/errors'
import { khataCashCounted, khataSaleCounted } from '@/lib/khata'
import { OutboxContext } from '@/lib/offline/context'
import { newClientRequestId } from '@/lib/offline/ids'
import {
  KHATA_OUTBOX_ENTRY_VERSION,
  OUTBOX_ENTRY_VERSION,
  type ExpenseArgs,
  type ExpenseResult,
  type KhataAdvanceArgs,
  type KhataAdvanceResult,
  type KhataCustomerArg,
  type KhataPaymentArgs,
  type KhataPaymentResult,
  type KhataSaleArgs,
  type KhataSaleResult,
  type OutboxEntry,
  type OutboxProblem,
  type Recognition,
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

/** Udhaar sale. `recognition` comes from the cached shop settings and is always sent. */
export type SubmitKhataSaleArgs = KhataSaleArgs & {
  /** Shown on the pending row (also for an existing customer `{ id }`). */
  customerName:    string
  categoryLabels?: Record<string, string>
}
export type SubmitAdvanceArgs = KhataAdvanceArgs & { customerName: string }
/** Payment on a server-known entry; `recognition` / `entryKind` are that entry's (frozen). */
export type SubmitPaymentArgs = KhataPaymentArgs & {
  customerName: string
  entryKind:    'udhaar' | 'advance'
  recognition:  Recognition
  customerId?:  string
}

export const VIEW_AS_SUBMIT_MESSAGE = 'Switch back to your own account to add entries.'
export const SIGNED_OUT_SUBMIT_MESSAGE = 'Please sign in again to save.'
export const STORAGE_FAILED_MESSAGE = "Couldn't save on this phone. Connect to the internet and try again."

/** ConvexError so existing modal error handling (`getErrorMessage`) shows the text. */
function blocked(code: ErrorCode, message: string): ConvexError<{ code: ErrorCode; message: string }> {
  return new ConvexError({ code, message })
}

type SubmitInput =
  | { kind: 'sale'; args: SubmitSaleArgs }
  | { kind: 'expense'; args: SubmitExpenseArgs }
  | { kind: 'khataSale'; args: SubmitKhataSaleArgs }
  | { kind: 'khataAdvance'; args: SubmitAdvanceArgs }
  | { kind: 'khataPayment'; args: SubmitPaymentArgs }

/** Only the fields `saleSessions.record` accepts (extra fields would fail server validation forever). */
function pickItem(i: SaleItemArgs): SaleItemArgs {
  return {
    productName: i.productName,
    amount: i.amount,
    ...(i.categoryId !== undefined ? { categoryId: i.categoryId } : {}),
    ...(i.note !== undefined ? { note: i.note } : {}),
  }
}

function pickCustomer(c: KhataCustomerArg): KhataCustomerArg {
  if ('id' in c) return { id: c.id }
  return { name: c.name, ...(c.phone !== undefined && c.phone !== '' ? { phone: c.phone } : {}) }
}

/** Exactly the server args (no display fields) for each kind. */
export function khataSaleArgs(a: SubmitKhataSaleArgs): KhataSaleArgs {
  return {
    customer: pickCustomer(a.customer),
    items: a.items.map(pickItem),
    sessionDate: a.sessionDate,
    receivedNow: a.receivedNow,
    recognition: a.recognition,
  }
}

export function khataAdvanceArgs(a: SubmitAdvanceArgs): KhataAdvanceArgs {
  return {
    customer: pickCustomer(a.customer),
    amount: a.amount,
    receivedAt: a.receivedAt,
    ...(a.total !== undefined ? { total: a.total } : {}),
    ...(a.itemLabel !== undefined && a.itemLabel !== '' ? { itemLabel: a.itemLabel } : {}),
    ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
    ...(a.note !== undefined && a.note !== '' ? { note: a.note } : {}),
    recognition: a.recognition,
  }
}

export function khataPaymentArgs(a: SubmitPaymentArgs): KhataPaymentArgs {
  return { entryId: a.entryId, amount: a.amount, receivedAt: a.receivedAt }
}

export function buildEntry(owner: string, id: string, input: SubmitInput, now: number = Date.now()): OutboxEntry {
  const base = {
    id,
    owner,
    tz: getClientTimeZone(),
    createdAt: now,
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: 0,
  }
  const v1 = OUTBOX_ENTRY_VERSION as typeof OUTBOX_ENTRY_VERSION
  const v2 = KHATA_OUTBOX_ENTRY_VERSION as typeof KHATA_OUTBOX_ENTRY_VERSION
  switch (input.kind) {
    case 'sale': {
      const { categoryLabels, items, sessionDate } = input.args
      return {
        ...base,
        v: v1,
        kind: 'sale',
        dayKey: toLocalDateKey(sessionDate),
        args: { items: items.map(pickItem), sessionDate },
        ...(categoryLabels ? { categoryLabels: { ...categoryLabels } } : {}),
      }
    }
    case 'expense': {
      const { amount, expenseDate, note } = input.args
      return {
        ...base,
        v: v1,
        kind: 'expense',
        dayKey: toLocalDateKey(expenseDate),
        args: { amount, expenseDate, ...(note !== undefined ? { note } : {}) },
      }
    }
    case 'khataSale': {
      const args = khataSaleArgs(input.args)
      const total = args.items.reduce((s, i) => s + i.amount, 0)
      return {
        ...base,
        v: v2,
        kind: 'khataSale',
        dayKey: toLocalDateKey(args.sessionDate),
        args,
        khata: {
          customerName: input.args.customerName,
          countedAmount: khataSaleCounted(args.recognition, total, args.receivedNow),
          entryKind: 'udhaar',
          ...('id' in args.customer ? { customerId: args.customer.id } : {}),
        },
        ...(input.args.categoryLabels ? { categoryLabels: { ...input.args.categoryLabels } } : {}),
      }
    }
    case 'khataAdvance': {
      const args = khataAdvanceArgs(input.args)
      return {
        ...base,
        v: v2,
        kind: 'khataAdvance',
        dayKey: toLocalDateKey(args.receivedAt),
        args,
        khata: {
          customerName: input.args.customerName,
          countedAmount: khataCashCounted(args.recognition, args.amount),
          entryKind: 'advance',
          ...('id' in args.customer ? { customerId: args.customer.id } : {}),
        },
      }
    }
    case 'khataPayment': {
      const args = khataPaymentArgs(input.args)
      return {
        ...base,
        v: v2,
        kind: 'khataPayment',
        dayKey: toLocalDateKey(args.receivedAt),
        args,
        khata: {
          customerName: input.args.customerName,
          countedAmount: khataCashCounted(input.args.recognition, args.amount),
          entryKind: input.args.entryKind,
          ...(input.args.customerId ? { customerId: input.args.customerId } : {}),
        },
      }
    }
  }
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export type SubmitApi = {
  submitSale: (args: SubmitSaleArgs) => Promise<SubmitResult<SaleResult>>
  submitExpense: (args: SubmitExpenseArgs) => Promise<SubmitResult<ExpenseResult>>
  submitKhataSale: (args: SubmitKhataSaleArgs) => Promise<SubmitResult<KhataSaleResult>>
  submitAdvance: (args: SubmitAdvanceArgs) => Promise<SubmitResult<KhataAdvanceResult>>
  submitPayment: (args: SubmitPaymentArgs) => Promise<SubmitResult<KhataPaymentResult>>
}

/**
 * New sales / expenses / Udhaar sales / advances / payments, offline-first:
 * every submit is put in the outbox first, then flushed. Online, it waits up
 * to 4 s for the server ('saved'), else reports 'queued' ("Saved on phone —
 * will sync"). If the outbox write fails while online, the mutation is sent
 * directly with the same clientRequestId (never both). Throws a ConvexError
 * (shown by `getErrorMessage`) in admin view-as or without a signed-in owner,
 * and when the write fails offline.
 */
export function useSubmitEntry(): SubmitApi {
  const ctx = useContext(OutboxContext)
  const viewingOther = useViewAsUserIdForQuery() !== undefined
  const { isOffline } = useNetworkStatus()
  const recordSale = useMutation(api.saleSessions.record)
  const recordExpense = useMutation(api.expenses.record)
  const recordKhataSale = useMutation(api.khata.recordSale)
  const openAdvance = useMutation(api.khata.openAdvance)
  const receivePayment = useMutation(api.khata.receivePayment)

  const engine = ctx?.engine ?? null
  const owner = ctx?.owner ?? null
  const hasProvider = ctx !== null

  const submit = useCallback(
    async <R>(input: SubmitInput, direct: (clientRequestId: string) => Promise<R>): Promise<SubmitResult<R>> => {
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

  const submitKhataSale = useCallback(
    (args: SubmitKhataSaleArgs) =>
      submit<KhataSaleResult>({ kind: 'khataSale', args }, (clientRequestId) =>
        recordKhataSale({ ...khataSaleArgs(args), clientRequestId })),
    [submit, recordKhataSale],
  )

  const submitAdvance = useCallback(
    (args: SubmitAdvanceArgs) =>
      submit<KhataAdvanceResult>({ kind: 'khataAdvance', args }, (clientRequestId) =>
        openAdvance({ ...khataAdvanceArgs(args), clientRequestId })),
    [submit, openAdvance],
  )

  const submitPayment = useCallback(
    (args: SubmitPaymentArgs) =>
      submit<KhataPaymentResult>({ kind: 'khataPayment', args }, (clientRequestId) =>
        receivePayment({ ...khataPaymentArgs(args), clientRequestId })),
    [submit, receivePayment],
  )

  return { submitSale, submitExpense, submitKhataSale, submitAdvance, submitPayment }
}
