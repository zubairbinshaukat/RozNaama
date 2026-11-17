import { PHONE_MAX, customerNameKey, phoneProblem, phoneTail, toPaisa, type KhataCustomer } from '@/lib/khata'
import type { KhataCustomerArg } from '@/lib/offline/types'
import type { Id } from '../../../convex/_generated/dataModel'

/** A saved customer chosen from the chips. */
export type ChosenCustomer = { id: Id<'customers'>; name: string; phone?: string }

/**
 * The inline "Customer name (optional)" field: what is typed, the chip that
 * was tapped (if any) and, for a new name, an optional phone.
 */
export type CustomerFieldValue = {
  text:      string
  picked:    ChosenCustomer | null
  phone:     string
  phoneOpen: boolean
}

export const EMPTY_CUSTOMER: CustomerFieldValue = { text: '', picked: null, phone: '', phoneOpen: false }

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** A typed name that is not a chosen customer (a new customer on save). */
export function isNewName(v: CustomerFieldValue): boolean {
  return v.picked === null && cleanName(v.text) !== ''
}

/** `{ id }`, `{ name, phone? }` or undefined (blank = record without a name). */
export function customerArg(v: CustomerFieldValue): KhataCustomerArg | undefined {
  if (v.picked) return { id: v.picked.id }
  const name = cleanName(v.text)
  if (!name) return undefined
  const phone = v.phone.trim()
  return { name, ...(phone ? { phone } : {}) }
}

/** The name the record will carry, or null. */
export function fieldName(v: CustomerFieldValue): string | null {
  return v.picked?.name ?? (cleanName(v.text) || null)
}

/** Chip text: "Ali" or "Ali · 4567" (last 4 phone digits tell two Alis apart). */
export function customerChipLabel(c: Pick<KhataCustomer, 'name' | 'phone'>): string {
  const tail = phoneTail(c.phone)
  return tail ? `${c.name} · ${tail}` : c.name
}

/** Name prefix matches first, then other customers whose name contains the text. */
export function rankCustomers<T extends Pick<KhataCustomer, '_id' | 'name' | 'normalizedName'>>(
  prefix: readonly T[] | undefined,
  recent: readonly T[] | undefined,
  text: string,
): T[] {
  const key = customerNameKey(text)
  if (!key) return [...(recent ?? [])]
  const out = (prefix ?? []).filter((c) => c.normalizedName.startsWith(key))
  const seen = new Set(out.map((c) => c._id))
  for (const c of recent ?? []) {
    if (!seen.has(c._id) && c.normalizedName.includes(key)) {
      out.push(c)
      seen.add(c._id)
    }
  }
  return out
}

/** Validate the field for saving (null = ok). The name itself is optional. */
export function customerProblem(v: CustomerFieldValue): string | null {
  return isNewName(v) ? phoneProblem(v.phone, PHONE_MAX) : null
}

// ── Record sale: "Full payment received?" ──────────────────────────────────

export type SalePayment = {
  /** "Full payment received?" Yes (default). */
  full:     boolean
  /** Canonical amount string; '' = 0. */
  received: string
  customer: CustomerFieldValue
}

export const FULL_PAYMENT: SalePayment = { full: true, received: '', customer: EMPTY_CUSTOMER }

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
