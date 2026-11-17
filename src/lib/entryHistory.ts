/**
 * Smart-entry history: what this shopkeeper usually sells and spends on, kept
 * on the device (localStorage) and scoped to the signed-in Clerk user so two
 * accounts on one phone never see each other's items.
 *
 * Recorded only after a successful save. Every storage call is wrapped: if
 * localStorage is blocked or full, history lives in memory for the session.
 */

export const HISTORY_KEY_PREFIX = 'roznaama-entry-history-v1:'
/** Max entries kept per list; least recently used are evicted first. */
export const HISTORY_CAP = 200
/** Chips shown when the field is empty. */
export const RECENT_LIMIT = 4
/** Chips shown while typing. */
export const SEARCH_LIMIT = 6

export interface SaleProductEntry {
  name:        string
  categoryId?: string
  lastAmount:  number
  uses:        number
  lastUsedAt:  number
}

export interface ExpenseTitleEntry {
  title:      string
  lastAmount: number
  uses:       number
  lastUsedAt: number
}

export interface EntryHistory {
  products: SaleProductEntry[]
  expenses: ExpenseTitleEntry[]
}

export interface SaleProductInput {
  name:        string
  categoryId?: string
  amount:      number
}

const EMPTY: EntryHistory = Object.freeze({ products: [], expenses: [] }) as EntryHistory

// ── Storage (localStorage with in-memory fallback) ────────────────────────

/** Values that could not be written to localStorage (blocked / quota). */
const memory = new Map<string, string>()
const listeners = new Set<() => void>()
const snapshotCache = new Map<string, { raw: string | null; value: EntryHistory }>()

export function historyKey(userId: string): string {
  return `${HISTORY_KEY_PREFIX}${userId}`
}

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, raw: string): void {
  try {
    window.localStorage.setItem(key, raw)
    memory.delete(key)
  } catch {
    memory.set(key, raw)
  }
}

/** Test helper: drop the in-memory fallback and cached snapshots. */
export function resetEntryHistoryMemory(): void {
  memory.clear()
  snapshotCache.clear()
}

export function subscribeEntryHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(): void {
  for (const l of listeners) l()
}

// ── Validation ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function toProduct(v: unknown): SaleProductEntry | null {
  if (!isRecord(v)) return null
  const { name, categoryId, lastAmount, uses, lastUsedAt } = v
  if (typeof name !== 'string' || !name.trim()) return null
  if (!isFiniteNumber(lastAmount) || lastAmount < 0) return null
  if (!isFiniteNumber(uses) || uses < 1) return null
  if (!isFiniteNumber(lastUsedAt)) return null
  if (categoryId !== undefined && (typeof categoryId !== 'string' || !categoryId)) return null
  return { name: cleanLabel(name), ...(categoryId ? { categoryId } : {}), lastAmount, uses, lastUsedAt }
}

function toExpense(v: unknown): ExpenseTitleEntry | null {
  if (!isRecord(v)) return null
  const { title, lastAmount, uses, lastUsedAt } = v
  if (typeof title !== 'string' || !title.trim()) return null
  if (!isFiniteNumber(lastAmount) || lastAmount < 0) return null
  if (!isFiniteNumber(uses) || uses < 1) return null
  if (!isFiniteNumber(lastUsedAt)) return null
  return { title: cleanLabel(title), lastAmount, uses, lastUsedAt }
}

function parseList<T>(v: unknown, toEntry: (x: unknown) => T | null, labelOf: (e: T) => string): T[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of v) {
    const entry = toEntry(item)
    if (!entry) continue
    const k = normalizeKey(labelOf(entry))
    if (seen.has(k)) continue
    seen.add(k)
    out.push(entry)
  }
  return out
}

function parse(raw: string | null): EntryHistory {
  if (!raw) return EMPTY
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!isRecord(data)) return EMPTY
  return {
    products: parseList(data.products, toProduct, (e) => e.name),
    expenses: parseList(data.expenses, toExpense, (e) => e.title),
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Collapse spaces; the label shown on chips. */
function cleanLabel(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

/** Dedupe key: case-insensitive, trimmed, single-spaced. */
export function normalizeKey(s: string): string {
  return cleanLabel(s).toLowerCase()
}

/**
 * Stable snapshot for `useSyncExternalStore`: the same object is returned
 * until the stored string changes. No user → empty history.
 */
export function getEntryHistory(userId: string | null | undefined): EntryHistory {
  if (!userId) return EMPTY
  const key = historyKey(userId)
  const raw = readRaw(key)
  const cached = snapshotCache.get(key)
  if (cached && cached.raw === raw) return cached.value
  const value = parse(raw)
  snapshotCache.set(key, { raw, value })
  return value
}

function save(userId: string, next: EntryHistory): void {
  writeRaw(historyKey(userId), JSON.stringify(next))
  emit()
}

function byRecent<T extends { lastUsedAt: number }>(a: T, b: T): number {
  return b.lastUsedAt - a.lastUsedAt
}

/** Most recent first, capped (LRU eviction). */
function capList<T extends { lastUsedAt: number }>(list: T[]): T[] {
  return [...list].sort(byRecent).slice(0, HISTORY_CAP)
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Remember each item of a successfully saved sale. A missing category keeps
 * the one remembered before; a given category replaces it.
 */
export function recordSaleProducts(
  userId: string | null | undefined,
  items: readonly SaleProductInput[],
  now: number = Date.now(),
): void {
  if (!userId) return
  const current = getEntryHistory(userId)
  const map = new Map(current.products.map((p) => [normalizeKey(p.name), p]))
  for (const item of items) {
    const name = cleanLabel(item.name)
    if (!name || !isFiniteNumber(item.amount) || item.amount < 0) continue
    const k = normalizeKey(name)
    const prev = map.get(k)
    const categoryId = item.categoryId || prev?.categoryId
    map.set(k, {
      name,
      ...(categoryId ? { categoryId } : {}),
      lastAmount: item.amount,
      uses:       (prev?.uses ?? 0) + 1,
      lastUsedAt: now,
    })
  }
  save(userId, { ...current, products: capList([...map.values()]) })
}

/** Remember a successfully saved expense's title (skipped when blank). */
export function recordExpenseTitle(
  userId: string | null | undefined,
  title: string,
  amount: number,
  now: number = Date.now(),
): void {
  if (!userId) return
  const clean = cleanLabel(title)
  if (!clean || !isFiniteNumber(amount) || amount < 0) return
  const current = getEntryHistory(userId)
  const k = normalizeKey(clean)
  const prev = current.expenses.find((e) => normalizeKey(e.title) === k)
  const rest = current.expenses.filter((e) => normalizeKey(e.title) !== k)
  const entry: ExpenseTitleEntry = { title: clean, lastAmount: amount, uses: (prev?.uses ?? 0) + 1, lastUsedAt: now }
  save(userId, { ...current, expenses: capList([entry, ...rest]) })
}

/** Remove one product suggestion; returns it (for undo) or null. */
export function forgetSaleProduct(userId: string | null | undefined, name: string): SaleProductEntry | null {
  if (!userId) return null
  const current = getEntryHistory(userId)
  const k = normalizeKey(name)
  const removed = current.products.find((p) => normalizeKey(p.name) === k) ?? null
  if (!removed) return null
  save(userId, { ...current, products: current.products.filter((p) => p !== removed) })
  return removed
}

/** Remove one expense title suggestion; returns it (for undo) or null. */
export function forgetExpenseTitle(userId: string | null | undefined, title: string): ExpenseTitleEntry | null {
  if (!userId) return null
  const current = getEntryHistory(userId)
  const k = normalizeKey(title)
  const removed = current.expenses.find((e) => normalizeKey(e.title) === k) ?? null
  if (!removed) return null
  save(userId, { ...current, expenses: current.expenses.filter((e) => e !== removed) })
  return removed
}

/** Undo a forget: put the entry back unless it was re-recorded meanwhile. */
export function restoreSaleProduct(userId: string | null | undefined, entry: SaleProductEntry): void {
  if (!userId) return
  const current = getEntryHistory(userId)
  const k = normalizeKey(entry.name)
  if (current.products.some((p) => normalizeKey(p.name) === k)) return
  save(userId, { ...current, products: capList([...current.products, entry]) })
}

export function restoreExpenseTitle(userId: string | null | undefined, entry: ExpenseTitleEntry): void {
  if (!userId) return
  const current = getEntryHistory(userId)
  const k = normalizeKey(entry.title)
  if (current.expenses.some((e) => normalizeKey(e.title) === k)) return
  save(userId, { ...current, expenses: capList([...current.expenses, entry]) })
}

// ── Ranking ────────────────────────────────────────────────────────────────

/**
 * Empty query → the most recent few. Typing → "starts with" matches first,
 * then "contains", each ranked by uses, then recency.
 */
export function rankEntries<T extends { uses: number; lastUsedAt: number }>(
  list: readonly T[],
  labelOf: (e: T) => string,
  query: string,
): T[] {
  const q = normalizeKey(query)
  if (!q) return [...list].sort(byRecent).slice(0, RECENT_LIMIT)
  const starts: T[] = []
  const contains: T[] = []
  for (const e of list) {
    const label = normalizeKey(labelOf(e))
    if (label.startsWith(q)) starts.push(e)
    else if (label.includes(q)) contains.push(e)
  }
  const byScore = (a: T, b: T) => b.uses - a.uses || b.lastUsedAt - a.lastUsedAt
  return [...starts.sort(byScore), ...contains.sort(byScore)].slice(0, SEARCH_LIMIT)
}

export function suggestSaleProducts(list: readonly SaleProductEntry[], query: string): SaleProductEntry[] {
  return rankEntries(list, (e) => e.name, query)
}

export function suggestExpenseTitles(list: readonly ExpenseTitleEntry[], query: string): ExpenseTitleEntry[] {
  return rankEntries(list, (e) => e.title, query)
}
