/**
 * Shared input limits. Imported by Convex functions (server-side validation)
 * and re-exported by `src/lib/constants.ts` so the UI uses the same values.
 *
 * Keep this file dependency-free: it is bundled into both the frontend and
 * the Convex backend.
 */

/** Max sale line items per Add Sale submission (one session). */
export const MAX_SALE_ITEMS = 20

/** Max characters for a sale product name (after trimming). */
export const PRODUCT_NAME_MAX = 80

/** Max characters for a sale or expense note (after trimming). */
export const NOTE_MAX = 100

/** Max characters for a category name (after trimming). */
export const CATEGORY_NAME_MAX = 40

/** Max characters stored for a user's display name. */
export const USER_NAME_MAX = 100

/** Largest single amount (PKR) accepted on new writes. */
export const AMOUNT_MAX = 1_000_000_000

/** Earliest entry date accepted on new writes (2000-01-01T00:00:00Z). */
export const MIN_DATE_MS = Date.UTC(2000, 0, 1)

/**
 * How far in the future (relative to server "now") an entry date may be.
 * 36h covers "start of local day" in any time zone plus clock skew.
 */
export const FUTURE_SLACK_MS = 36 * 60 * 60 * 1000

/**
 * Offline outbox idempotency key sent with new sales / expenses.
 * 16–64 chars of [A-Za-z0-9_-]; a `crypto.randomUUID()` (36 chars) fits.
 */
export const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

/** How long applied clientRequestIds are remembered (replays older than this would re-apply). */
export const CLIENT_REQUEST_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

// ─── Advance & Udhaar (Khata) ───────────────────────────────────────────────

/** Max characters for a customer name (after trimming / collapsing spaces). */
export const CUSTOMER_NAME_MAX = 40

/** Max characters for a customer phone (digits and an optional leading '+'). */
export const PHONE_MAX = 20

/** Max characters for a khata item label ("Suit stitching"). */
export const KHATA_ITEM_LABEL_MAX = 80

/** Max payments (incl. refunds) per khata entry. */
export const MAX_KHATA_PAYMENTS_PER_ENTRY = 200

/** A due date may be at most this far ahead of server "now" (2 years). */
export const DUE_DATE_MAX_AHEAD_MS = 2 * 366 * 24 * 60 * 60 * 1000

/** Max customers returned by khata.searchCustomers. */
export const CUSTOMER_SEARCH_MAX = 20

/** Color swatches for categories (UI palette and server-side allow-list). */
export const CATEGORY_COLORS = [
  '#6366F1',  // indigo
  '#8B5CF6',  // violet
  '#EC4899',  // pink
  '#EF4444',  // red
  '#F97316',  // orange
  '#EAB308',  // yellow
  '#22C55E',  // green
  '#06B6D4',  // cyan
] as const

export type CategoryColor = (typeof CATEGORY_COLORS)[number]
