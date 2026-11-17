/**
 * Expense write helpers. Every expense write goes through these so validation,
 * ownership and the Tier 2 totals hook (`onExpenseChange`) stay in one place.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { NOTE_MAX } from '../lib/limits'
import { requireOwned } from '../lib/ownership'
import {
  assertAmount,
  assertClientRequestId,
  assertEntryDate,
  normalizeOptionalText,
} from '../lib/validation'
import { assertAppliedKind, findApplied, recordApplied } from './idempotency'
import { totalsOnExpenseChange } from './totals'

const AMOUNT_LABEL = 'Expense amount'
const NOT_FOUND_MESSAGE = 'Expense not found'

/**
 * Tier 2 hook: called after every expense insert/update/delete in the same
 * mutation with the document before and after the write (null = absent).
 * Keeps dailyTotals + userTotals in sync (convex/model/totals.ts).
 */
export async function onExpenseChange(
  ctx: MutationCtx,
  before: Doc<'expenses'> | null,
  after: Doc<'expenses'> | null,
): Promise<void> {
  await totalsOnExpenseChange(ctx, before, after)
}

export type RecordExpenseInput = {
  amount:      number
  expenseDate: number
  note?:       string
  /** Offline outbox idempotency key: a replay returns the first result and writes nothing. */
  clientRequestId?: string
}

type RecordExpenseResult = { expenseId: Id<'expenses'>; amount: number }

/** Validate and insert a new expense. Returns the legacy `{ expenseId, amount }` shape. */
export async function recordExpense(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: RecordExpenseInput,
): Promise<RecordExpenseResult> {
  const clientRequestId =
    input.clientRequestId === undefined ? undefined : assertClientRequestId(input.clientRequestId)
  if (clientRequestId !== undefined) {
    const applied = await findApplied(ctx, userId, clientRequestId)
    if (applied) {
      assertAppliedKind(applied, 'expense')
      return { expenseId: applied.expenseId as Id<'expenses'>, amount: applied.totalAmount }
    }
  }

  const result = await insertExpense(ctx, userId, input)
  if (clientRequestId !== undefined) {
    await recordApplied(ctx, {
      userId,
      clientRequestId,
      kind:        'expense',
      expenseId:   result.expenseId,
      totalAmount: result.amount,
      itemCount:   1,
    })
  }
  return result
}

async function insertExpense(
  ctx: MutationCtx,
  userId: Id<'users'>,
  input: RecordExpenseInput,
): Promise<RecordExpenseResult> {
  const amount = assertAmount(input.amount, AMOUNT_LABEL)
  const expenseDate = assertEntryDate(input.expenseDate, 'Expense date')
  const note = normalizeOptionalText(input.note, 'Note', NOTE_MAX)

  const expenseId = await ctx.db.insert('expenses', {
    userId,
    amount,
    note,
    expenseDate,
    createdAt: Date.now(),
  })

  const after = await ctx.db.get('expenses', expenseId)
  await onExpenseChange(ctx, null, after)

  return { expenseId, amount }
}

export type UpdateExpenseInput = {
  amount: number
  note?:  string
}

/**
 * Update amount/note of an expense owned by `userId`. Only fields that actually
 * change are validated, so legacy rows (e.g. a >100-char note) stay editable.
 */
export async function updateExpense(
  ctx: MutationCtx,
  userId: Id<'users'>,
  expenseId: Id<'expenses'>,
  input: UpdateExpenseInput,
): Promise<void> {
  const before = await requireOwned(ctx, 'expenses', expenseId, userId, NOT_FOUND_MESSAGE)

  const amount = input.amount === before.amount
    ? before.amount
    : assertAmount(input.amount, AMOUNT_LABEL)

  const trimmedNote = input.note?.trim() || undefined
  const note = trimmedNote === before.note
    ? before.note
    : normalizeOptionalText(trimmedNote, 'Note', NOTE_MAX)

  await ctx.db.patch('expenses', expenseId, { amount, note })

  const after: Doc<'expenses'> = { ...before, amount, note }
  await onExpenseChange(ctx, before, after)
}

/** Delete an expense owned by `userId`. */
export async function removeExpense(
  ctx: MutationCtx,
  userId: Id<'users'>,
  expenseId: Id<'expenses'>,
): Promise<void> {
  const before = await requireOwned(ctx, 'expenses', expenseId, userId, NOT_FOUND_MESSAGE)
  await ctx.db.delete('expenses', expenseId)
  await onExpenseChange(ctx, before, null)
}
