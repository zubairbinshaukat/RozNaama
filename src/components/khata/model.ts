/** Khata UI view-model helpers (pure). */
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { NO_NAME, sinceLabel, type KhataOpenRow, type Recognition } from '@/lib/khata'
import type { KhataOutboxEntry } from '@/lib/offline/types'
import { dayRange, monthRange, weekRange, type PeriodView } from '@/lib/period'
import { endOfYear, startOfYear } from '@/lib/utils'

/** What the Receive payment / Complete order sheets need about one open record. */
export type EntryTarget = {
  entryId:      Id<'khataEntries'>
  /** Null for a record without a name. */
  customerId:   Id<'customers'> | null
  customerName: string | null
  kind:         'udhaar' | 'advance'
  status:       'booked' | 'due' | 'settled' | 'cancelled'
  recognition:  Recognition
  /** total − paid − forgiven; null = advance without a total yet. */
  remaining:    number | null
  paid:         number
  total?:       number
  itemLabel?:   string
  openedAt:     number
}

/** Any record shape the queries return (customerId may be missing on nameless records). */
export type EntryLike = {
  _id:         Id<'khataEntries'>
  customerId?: Id<'customers'> | null
  kind:        'udhaar' | 'advance'
  status:      'booked' | 'due' | 'settled' | 'cancelled'
  recognition: Recognition
  remaining:   number | null
  paid:        number
  total?:      number
  itemLabel?:  string
  openedAt:    number
}

export function toTarget(entry: EntryLike, customerName: string | null | undefined): EntryTarget {
  return {
    entryId:      entry._id,
    customerId:   entry.customerId ?? null,
    customerName: customerName?.trim() || null,
    kind:         entry.kind,
    status:       entry.status,
    recognition:  entry.recognition,
    remaining:    entry.remaining,
    paid:         entry.paid,
    ...(entry.total !== undefined ? { total: entry.total } : {}),
    ...(entry.itemLabel !== undefined ? { itemLabel: entry.itemLabel } : {}),
    openedAt:     entry.openedAt,
  }
}

export function targetFromRow(row: KhataOpenRow): EntryTarget {
  return toTarget(row as EntryLike, row.customerName)
}

/** "Ali" or "No name". */
export function displayName(name: string | null | undefined): string {
  return name?.trim() || NO_NAME
}

/** "Suit · since 12 Nov" (item label when there is one). */
export function recordSub(e: { itemLabel?: string; openedAt: number }): string {
  return `${e.itemLabel ? `${e.itemLabel} · ` : ''}${sinceLabel(e.openedAt)}`
}

/** Toast suffix: " (Ali)" or "" for a record without a name. */
export function nameSuffix(name: string | null | undefined): string {
  const n = name?.trim()
  return n ? ` (${n})` : ''
}

export const isOpenStatus = (s: EntryTarget['status']) => s === 'booked' || s === 'due'

/** "Udhaar · Suit" / "Advance · Order" / "Udhaar". */
export function entryTitle(e: { kind: 'udhaar' | 'advance'; itemLabel?: string }): string {
  const kind = e.kind === 'udhaar' ? 'Udhaar' : 'Advance'
  return e.itemLabel ? `${kind} · ${e.itemLabel}` : kind
}

/** The amount a row shows: Baqi for Udhaar (due), money held for an advance (booked). */
export function rowAmount(e: { status: string; remaining: number | null; paid: number }): number {
  return e.status === 'booked' ? e.paid : (e.remaining ?? 0)
}

export type TimelineEvent = {
  key:    string
  at:     number
  kind:   'sale' | 'booked' | 'handover' | 'payment' | 'refund' | 'forgiven' | 'cancelled' | 'kept' | 'pending'
  title:  string
  amount?: number
  /** Money in (+) / out (−) / neutral. */
  tone:   'in' | 'out' | 'neutral'
  paymentId?: Id<'khataPayments'>
  pendingId?: string
}

/** Every event of a customer's records, newest first (+ payments still on this phone). */
export type TimelineEntry = EntryLike & {
  deliveredAt?: number
  forgiven?:    number
  refunded?:    number
  closedAt?:    number
  updatedAt:    number
  payments:     readonly Pick<Doc<'khataPayments'>, '_id' | 'kind' | 'amount' | 'receivedAt'>[]
}

export function buildTimeline(entries: readonly TimelineEntry[], pending: readonly KhataOutboxEntry[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const e of entries) {
    const label = e.itemLabel ? ` · ${e.itemLabel}` : ''
    if (e.kind === 'udhaar') {
      out.push({ key: `${e._id}:sale`, at: e.openedAt, kind: 'sale', title: `Sale${label}`, ...(e.total !== undefined ? { amount: e.total } : {}), tone: 'neutral' })
    } else {
      out.push({ key: `${e._id}:booked`, at: e.openedAt, kind: 'booked', title: `Booked${label}`, ...(e.total !== undefined ? { amount: e.total } : {}), tone: 'neutral' })
      if (e.deliveredAt !== undefined) {
        out.push({ key: `${e._id}:handover`, at: e.deliveredAt, kind: 'handover', title: `Handed over${label}`, ...(e.total !== undefined ? { amount: e.total } : {}), tone: 'neutral' })
      }
    }
    for (const p of e.payments) {
      out.push(p.kind === 'refund'
        ? { key: p._id, at: p.receivedAt, kind: 'refund', title: 'Refunded', amount: p.amount, tone: 'out', paymentId: p._id }
        : { key: p._id, at: p.receivedAt, kind: 'payment', title: 'Received', amount: p.amount, tone: 'in', paymentId: p._id })
    }
    if (e.forgiven !== undefined && e.forgiven > 0) {
      out.push({ key: `${e._id}:forgiven`, at: e.closedAt ?? e.updatedAt, kind: 'forgiven', title: 'Baqi forgiven', amount: e.forgiven, tone: 'neutral' })
    }
    if (e.status === 'cancelled') {
      const kept = !(e.refunded !== undefined && e.refunded > 0) && e.paid > 0
      out.push({
        key: `${e._id}:cancelled`, at: e.closedAt ?? e.updatedAt, kind: kept ? 'kept' : 'cancelled',
        title: kept ? 'Cancelled · advance kept' : 'Cancelled', tone: 'neutral',
      })
    }
  }
  for (const p of pending) {
    out.push({
      key: `pending:${p.id}`, at: p.kind === 'khataSale' ? p.args.sessionDate : p.args.receivedAt, kind: 'pending',
      title: p.kind === 'khataPayment' ? 'Received' : p.kind === 'khataAdvance' ? 'Advance' : 'Udhaar sale',
      amount: p.kind === 'khataSale' ? p.args.items.reduce((s, i) => s + i.amount, 0) : p.args.amount,
      tone: 'in', pendingId: p.id,
    })
  }
  return out.sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : -1))
}

/** Pending outbox khata entries that belong to `customerId` (by id or by saved name). */
export function pendingForCustomer(
  pending: readonly KhataOutboxEntry[],
  customer: { _id: string; normalizedName: string },
  entryIds: ReadonlySet<string>,
): KhataOutboxEntry[] {
  return pending.filter((p) => {
    if (p.kind === 'khataPayment') return entryIds.has(p.args.entryId)
    const c = p.args.customer
    if (!c) return false
    if ('id' in c) return c.id === customer._id
    return c.name.trim().replace(/\s+/g, ' ').toLowerCase() === customer.normalizedName
  })
}

/** Pending payments for one record. */
export function pendingForEntry(pending: readonly KhataOutboxEntry[], entryId: string): KhataOutboxEntry[] {
  return pending.filter((p) => p.kind === 'khataPayment' && p.args.entryId === entryId)
}

/** Open rows → named customers (grouped) and nameless records (one row each). */
export type OpenGroup =
  | { kind: 'customer'; customerId: Id<'customers'>; name: string; phone?: string; rows: KhataOpenRow[] }
  | { kind: 'record'; row: KhataOpenRow }

export function groupOpenRows(rows: readonly KhataOpenRow[]): OpenGroup[] {
  const out: OpenGroup[] = []
  const byCustomer = new Map<string, Extract<OpenGroup, { kind: 'customer' }>>()
  for (const row of rows) {
    const id = (row as { customerId?: Id<'customers'> | null }).customerId ?? null
    const name = nameOrNullOf(row.customerName)
    if (!id || !name) { out.push({ kind: 'record', row }); continue }
    let g = byCustomer.get(id)
    if (!g) {
      g = { kind: 'customer', customerId: id, name, ...(row.customerPhone ? { phone: row.customerPhone } : {}), rows: [] }
      byCustomer.set(id, g)
      out.push(g)
    }
    g.rows.push(row)
  }
  return out
}

function nameOrNullOf(name: string | null | undefined): string | null {
  return name?.trim() || null
}

/** [start, end] ms of the selected period (`value` is a period start, or the year). */
export function periodBounds(view: PeriodView, value: number): { start: number; end: number } {
  if (view === 'daily') return dayRange(value)
  if (view === 'weekly') return weekRange(value)
  if (view === 'monthly') return monthRange(value)
  const d = new Date(value, 0, 1)
  return { start: startOfYear(d), end: endOfYear(d) }
}
