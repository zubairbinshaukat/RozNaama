/**
 * Advance & Udhaar (Khata) client helpers (pure): shop settings defaults and
 * cache, phone / WhatsApp helpers and server message parsing.
 */
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../convex/_generated/api'
import { formatCurrency } from '@/lib/utils'

export { CUSTOMER_NAME_MAX, PHONE_MAX, KHATA_ITEM_LABEL_MAX, CUSTOMER_SEARCH_MAX } from '../../convex/lib/limits'

export type Recognition = 'delivery' | 'cash'
export type ShopSettings = FunctionReturnType<typeof api.settings.get>
export type KhataTotals = FunctionReturnType<typeof api.khata.getTotals>
export type KhataOpenRow = FunctionReturnType<typeof api.khata.listOpen>['page'][number]
export type KhataCustomer = FunctionReturnType<typeof api.khata.searchCustomers>[number]
export type KhataCustomerDetail = NonNullable<FunctionReturnType<typeof api.khata.customerDetail>>
export type KhataDetailEntry = KhataCustomerDetail['entries'][number]
export type KhataBadge = FunctionReturnType<typeof api.khata.badgesForRange>[number]
export type KhataSegment = 'due' | 'booked'
/** khata.entryDetail: one record with its payments and (optional) customer. */
export type KhataEntryDetail = NonNullable<FunctionReturnType<typeof api.khata.entryDetail>>
/** A record as the action sheets need it (entry doc + remaining). */
export type KhataRecord = KhataDetailEntry | (KhataEntryDetail['entry'] & { payments?: KhataDetailEntry['payments'] })

/** How a khata record without a customer is shown. */
export const NO_NAME = 'No name'

/** The customer's name, or null for a record without one. */
export function nameOrNull(name: string | null | undefined): string | null {
  return name?.trim() || null
}

/** Same as the server's defaults (no row = off, both 'delivery'). */
export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  khataEnabled:       false,
  advanceRecognition: 'delivery',
  udhaarRecognition:  'delivery',
  updatedAt:          0,
}

// ── settings cache (per Clerk user, so the switch never flashes) ────────────

export const SETTINGS_CACHE_PREFIX = 'roznaama-settings:'

/** `roznaama-settings:<clerkUserId>`; admin view-as caches the target separately. */
export function settingsCacheKey(owner: string, viewAsUserId?: string): string {
  return viewAsUserId ? `${SETTINGS_CACHE_PREFIX}${owner}:view:${viewAsUserId}` : `${SETTINGS_CACHE_PREFIX}${owner}`
}

const isRecognition = (v: unknown): v is Recognition => v === 'delivery' || v === 'cash'

export function parseShopSettings(raw: unknown): ShopSettings | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.khataEnabled !== 'boolean') return null
  if (!isRecognition(r.advanceRecognition) || !isRecognition(r.udhaarRecognition)) return null
  return {
    khataEnabled:       r.khataEnabled,
    advanceRecognition: r.advanceRecognition,
    udhaarRecognition:  r.udhaarRecognition,
    updatedAt:          typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  }
}

export function readCachedSettings(key: string): ShopSettings | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? parseShopSettings(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeCachedSettings(key: string, settings: ShopSettings): void {
  try {
    localStorage.setItem(key, JSON.stringify(settings))
  } catch {
    /* private mode / quota: live value still works */
  }
}

// ── money / text ────────────────────────────────────────────────────────────

/** Paisa-exact compare helpers (the server compares in paisa too). */
export const toPaisa = (x: number) => Math.round(x * 100)
export const fromPaisa = (p: number) => p / 100
export const subMoney = (a: number, b: number) => fromPaisa(toPaisa(a) - toPaisa(b))

/** Last 4 digits of a phone, to tell two "Ali"s apart. */
export function phoneTail(phone: string | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits.length > 0 ? digits : null
}

/** Same cleanup the server does before validating (spaces, dashes, dots, brackets). */
export function compactPhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, '')
}

/** Client check matching the server's `normalizePhone` (null = ok). */
export function phoneProblem(phone: string, max: number): string | null {
  const compact = compactPhone(phone)
  if (compact === '') return null
  if (!/^\+?\d+$/.test(compact)) return 'Phone number can only have digits and +'
  if (compact.length > max) return `Phone number must be ${max} characters or fewer`
  return null
}

/** Lowercased, trimmed, single spaces: the server's customer name key. */
export function customerNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Phone → WhatsApp number (digits only, international): "0300-1234567" →
 * "923001234567", "+92 300…" → "92300…", "300…" (10 digits) → "92300…".
 * null when it does not look like a phone number.
 */
export function whatsAppNumber(phone: string | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (/^03\d{9}$/.test(digits)) digits = `92${digits.slice(1)}`
  else if (/^3\d{9}$/.test(digits)) digits = `92${digits}`
  digits = digits.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** "Assalam o Alaikum Ali, aap ka baqi PKR 3,000 hai. Shukriya – Shop". */
export function reminderText(name: string, baqi: number, shopName: string): string {
  const shop = shopName.trim()
  return `Assalam o Alaikum ${name}, aap ka baqi ${formatCurrency(baqi)} hai. Shukriya${shop ? ` – ${shop}` : ''}`
}

/** wa.me link with the reminder prefilled, or null without a usable phone. */
export function whatsAppReminderLink(phone: string | undefined, name: string, baqi: number, shopName: string): string | null {
  const number = whatsAppNumber(phone)
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(reminderText(name, baqi, shopName))}`
}

/** "More than Baqi (PKR 1,000)" → 1000; null for any other message. */
export function parseMoreThanBaqi(message: string | undefined): number | null {
  if (!message) return null
  const m = /More than Baqi \(PKR ([\d,]+(?:\.\d+)?)\)/.exec(message)
  if (!m?.[1]) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** "since 12 Nov" (or "since 12 Nov 2025" in an earlier year). */
export function sinceLabel(ms: number, now: number = Date.now()): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `since ${d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

/** Sale counted in sales by a khata write (mirrors the server, see convex/model/khata.ts). */
export function khataSaleCounted(recognition: Recognition, total: number, receivedNow: number): number {
  return recognition === 'delivery' ? total : receivedNow
}

/** Advances / later payments count as sales only in 'cash' mode. */
export function khataCashCounted(recognition: Recognition, amount: number): number {
  return recognition === 'cash' ? amount : 0
}
