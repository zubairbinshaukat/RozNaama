import { PHONE_MAX, phoneProblem, phoneTail, toPaisa, type KhataCustomer } from '@/lib/khata'
import type { Id } from '../../../convex/_generated/dataModel'

/** The customer chosen in a form: an existing one, or a new one (created on save). */
export type PickedCustomer =
  | { kind: 'existing'; id: Id<'customers'>; name: string; phone?: string }
  | { kind: 'new'; name: string; phone: string }

export function pickedName(c: PickedCustomer): string {
  return c.name.trim().replace(/\s+/g, ' ')
}

/** `{ id }` or `{ name, phone? }` for khata mutations. */
export function customerArg(c: PickedCustomer): { id: Id<'customers'> } | { name: string; phone?: string } {
  if (c.kind === 'existing') return { id: c.id }
  const phone = c.phone.trim()
  return { name: pickedName(c), ...(phone ? { phone } : {}) }
}

/** Chip text: "Ali" or "Ali · 4567" (last 4 phone digits tell two Alis apart). */
export function customerChipLabel(c: Pick<KhataCustomer, 'name' | 'phone'>): string {
  const tail = phoneTail(c.phone)
  return tail ? `${c.name} · ${tail}` : c.name
}

/** Validate a picked customer for saving (null = ok). */
export function customerProblem(c: PickedCustomer | null): string | null {
  if (!c) return 'Choose the customer.'
  if (c.kind === 'new') {
    if (!pickedName(c)) return 'Write the customer name.'
    return phoneProblem(c.phone, PHONE_MAX)
  }
  return null
}

// ── Record sale: "Full payment received?" ──────────────────────────────────

export type SalePayment = {
  /** "Full payment received?" Yes (default). */
  full:     boolean
  /** Canonical amount string; '' = 0. */
  received: string
  customer: PickedCustomer | null
}

export const FULL_PAYMENT: SalePayment = { full: true, received: '', customer: null }

export type SalePaymentErrors = { received?: string; customer?: string }

/** Cash received now (0 when empty). */
export function receivedValue(p: SalePayment): number {
  const v = parseFloat(p.received)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** True when this sale is an Udhaar sale (paid less than the bill). */
export function isUdhaarSale(p: SalePayment, total: number): boolean {
  return !p.full && total > 0 && toPaisa(receivedValue(p)) < toPaisa(total)
}
