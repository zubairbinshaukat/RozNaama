/**
 * `returns` validators for public functions. These are enforced at runtime,
 * so they must describe the EXISTING response shapes exactly (old PWA clients).
 */
import { v, type Validator, type Value } from 'convex/values'
import { paginationResultValidator } from 'convex/server'
import { doc } from 'convex-helpers/validators'
import schema from '../schema'

export const userDoc = doc(schema, 'users')
export const categoryDoc = doc(schema, 'categories')
export const saleSessionDoc = doc(schema, 'saleSessions')
export const saleDoc = doc(schema, 'sales')
export const expenseDoc = doc(schema, 'expenses')

/** A session document with its sale line items. */
export const sessionWithItems = v.object({
  ...saleSessionDoc.fields,
  items: v.array(saleDoc),
})

/** saleSessions.getDailyTotals row. */
export const dailyTotal = v.object({
  date:  v.string(),
  total: v.number(),
})

/** saleSessions.getYearlyMonthlyTotals row. */
export const monthlyTotal = v.object({
  monthIndex: v.number(),
  salesTotal: v.number(),
  netTotal:   v.number(),
})

/** saleSessions.getStats result (15 fields; see src/hooks/useSales.ts). */
export const statsValidator = v.object({
  todayTotal:          v.number(),
  todaySalesTotal:     v.number(),
  todayNetTotal:       v.number(),
  todayCount:          v.number(),
  todayExpenseTotal:   v.number(),
  todayExpenseCount:   v.number(),
  weekTotal:           v.number(),
  weekCount:           v.number(),
  monthTotal:          v.number(),
  monthCount:          v.number(),
  allTimeTotal:        v.number(),
  allTimeCount:        v.number(),
  allTimeSalesTotal:   v.number(),
  allTimeExpenseTotal: v.number(),
  topCategoryName:     v.union(v.string(), v.null()),
})

/** users.listForAdmin row. */
export const adminUserRow = v.object({
  _id:   v.id('users'),
  name:  v.string(),
  email: v.string(),
})

/** sales.getCountsByCategory row. */
export const categoryCount = v.object({
  categoryId: v.id('categories'),
  count:      v.number(),
})

// ─── Advance & Udhaar (Khata) ───────────────────────────────────────────────

export const recognitionValidator = v.union(v.literal('delivery'), v.literal('cash'))
export const khataStatusValidator = v.union(
  v.literal('booked'), v.literal('due'), v.literal('settled'), v.literal('cancelled'),
)
export const khataKindValidator = v.union(v.literal('advance'), v.literal('udhaar'))

/** settings.get / settings.update result. */
export const shopSettingsValue = v.object({
  khataEnabled:       v.boolean(),
  advanceRecognition: recognitionValidator,
  udhaarRecognition:  recognitionValidator,
  updatedAt:          v.number(),
})

export const customerDoc = doc(schema, 'customers')
export const khataEntryDoc = doc(schema, 'khataEntries')
export const khataPaymentDoc = doc(schema, 'khataPayments')

/** khata.getTotals result. */
export const khataTotalsValue = v.object({
  dueTotal:  v.number(),
  dueCount:  v.number(),
  heldTotal: v.number(),
  heldCount: v.number(),
})

/**
 * An entry plus its computed `remaining` (PKR): total − paid − forgiven, or
 * null for an advance without a total yet.
 */
export const khataEntryWithRemaining = v.object({
  ...khataEntryDoc.fields,
  remaining: v.union(v.number(), v.null()),
})

/** khata.listOpen row: entry + remaining + joined customer name/phone. */
export const khataOpenRow = v.object({
  ...khataEntryDoc.fields,
  remaining:     v.union(v.number(), v.null()),
  customerName:  v.string(),
  customerPhone: v.optional(v.string()),
})

/** khata.customerDetail entry: entry + remaining + its payments (newest first). */
export const khataDetailEntry = v.object({
  ...khataEntryDoc.fields,
  remaining:      v.union(v.number(), v.null()),
  payments:       v.array(khataPaymentDoc),
  paymentsCapped: v.boolean(),
})

/** khata.badgesForRange row. */
export const khataBadge = v.object({
  saleSessionId: v.id('saleSessions'),
  role:          v.union(v.literal('delivery'), v.literal('payment')),
  entryId:       v.id('khataEntries'),
  customerId:    v.id('customers'),
  kind:          khataKindValidator,
  status:        khataStatusValidator,
  remaining:     v.union(v.number(), v.null()),
  customerName:  v.string(),
})

/** Pagination result for `item` (accepts the `{ page: [], isDone: true, continueCursor: '' }` empty shape). */
export function paginated<T extends Validator<Value, 'required', string>>(item: T) {
  return paginationResultValidator(item)
}

export { paginationResultValidator }
