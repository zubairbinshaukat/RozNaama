/**
 * READ-ONLY data audit (Tier 2 WP4). Nothing in this module writes.
 *
 * - `scanPage` (internalQuery): checks one page (≤ 200 docs) of one table plus
 *   bounded per-doc lookups, returning issue counters with ≤ 20 sample ids.
 * - `run` (internalAction): pages through users, categories, saleSessions,
 *   sales and expenses (or one `table`) and returns a merged report.
 *
 * Run (dev first; add --prod for production):
 *   npx convex run --% audit:run "{}"
 */
import { v, type Infer } from 'convex/values'
import { internalAction, internalQuery, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import { FUTURE_SLACK_MS } from './lib/limits'
import { dateKeyInTimeZone, DEFAULT_TIME_ZONE, normalizeTimeZone, zonedStartOfDayMs } from './lib/time'

/** Max docs per page and max sample ids kept per issue. */
export const AUDIT_PAGE_MAX = 200
export const AUDIT_SAMPLE_MAX = 20
/** Sale items read per session for the itemCount/totalAmount check. */
export const AUDIT_SESSION_ITEMS_MAX = 50
/** Totals differing by more than this are reported as mismatches. */
const AMOUNT_EPSILON = 1e-6

const AUDIT_TABLES = ['users', 'categories', 'saleSessions', 'sales', 'expenses'] as const
type AuditTable = (typeof AUDIT_TABLES)[number]

const auditTable = v.union(
  v.literal('users'),
  v.literal('categories'),
  v.literal('saleSessions'),
  v.literal('sales'),
  v.literal('expenses'),
)

/** Every check per table (always present in the report, 0 when clean). */
const CHECKS = {
  users: [
    'missingTokenIdentifier',
    'emptyEmail',
    'duplicateEmail',
    'duplicateEmailConflictingTokens',
    'invalidTimeZone',
  ],
  categories: ['missingOwner'],
  saleSessions: [
    'missingOwner',
    'invalidTotalAmount',
    'invalidItemCount',
    'itemCountMismatch',
    'totalAmountMismatch',
    'itemsNotChecked',
    'invalidSessionDate',
    'futureSessionDate',
    'sessionDateNotPktMidnight',
  ],
  sales: [
    'missingOwner',
    'invalidAmount',
    'missingSession',
    'sessionOtherUser',
    'saleDateMismatch',
    'orphanedCategoryId',
    'crossUserCategoryId',
    'invalidSaleDate',
    'futureSaleDate',
  ],
  expenses: ['missingOwner', 'invalidAmount', 'invalidExpenseDate', 'futureExpenseDate'],
} as const satisfies Record<AuditTable, readonly string[]>

const issueValidator = v.object({ count: v.number(), samples: v.array(v.string()) })
const issuesValidator = v.record(v.string(), issueValidator)

const pageResultValidator = v.object({
  table: auditTable,
  scanned: v.number(),
  issues: issuesValidator,
  /** Distinct `${userId}|${YYYY-MM-DD PKT}` keys on this page (sessions/expenses only). */
  userDayKeys: v.array(v.string()),
  continueCursor: v.string(),
  isDone: v.boolean(),
})
type PageResult = Infer<typeof pageResultValidator>
type Issues = Infer<typeof issuesValidator>

const tableReportValidator = v.object({
  scanned: v.number(),
  pages: v.number(),
  issues: issuesValidator,
})

const reportValidator = v.object({
  generatedAt: v.number(),
  tables: v.record(v.string(), tableReportValidator),
  /** Distinct (user, PKT day) pairs across saleSessions + expenses; null if neither was scanned. */
  distinctUserDays: v.union(v.number(), v.null()),
})
type Report = Infer<typeof reportValidator>

function emptyIssues(table: AuditTable): Issues {
  const issues: Issues = {}
  for (const name of CHECKS[table]) issues[name] = { count: 0, samples: [] }
  return issues
}

function flag(issues: Issues, name: string, id: string): void {
  const entry = issues[name] ?? { count: 0, samples: [] }
  entry.count += 1
  if (entry.samples.length < AUDIT_SAMPLE_MAX) entry.samples.push(id)
  issues[name] = entry
}

const isPositiveAmount = (n: number) => Number.isFinite(n) && n > 0
const isValidDate = (n: number) => Number.isFinite(n) && n > 0

function isPktMidnight(ms: number): boolean {
  const key = dateKeyInTimeZone(ms, DEFAULT_TIME_ZONE)
  return zonedStartOfDayMs(key, DEFAULT_TIME_ZONE) === ms
}

function userDayKey(userId: Id<'users'>, ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  return `${userId}|${dateKeyInTimeZone(ms, DEFAULT_TIME_ZONE)}`
}

/** Per-page memo of `db.get` lookups (bounded by the page size). */
function cachedGetter<T extends TableNames>(ctx: QueryCtx, table: T) {
  const cache = new Map<Id<T>, Doc<T> | null>()
  return async (id: Id<T>): Promise<Doc<T> | null> => {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    const doc = await ctx.db.get(table, id)
    cache.set(id, doc)
    return doc
  }
}

type PageOpts = { cursor: string | null; numItems: number }
type PageCore = Omit<PageResult, 'table'>

async function scanUsers(ctx: QueryCtx, opts: PageOpts): Promise<PageCore> {
  const issues = emptyIssues('users')
  const page = await ctx.db.query('users').paginate(opts)
  for (const user of page.page) {
    if (user.tokenIdentifier === undefined) flag(issues, 'missingTokenIdentifier', user._id)
    if (user.email.trim().length === 0) flag(issues, 'emptyEmail', user._id)
    if (user.timeZone !== undefined && normalizeTimeZone(user.timeZone, '') !== user.timeZone) {
      flag(issues, 'invalidTimeZone', user._id)
    }
    const sameEmail = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', user.email))
      .take(10)
    if (sameEmail.length > 1) {
      flag(issues, 'duplicateEmail', user._id)
      const tokens = new Set(
        sameEmail.map((u) => u.tokenIdentifier).filter((t): t is string => t !== undefined),
      )
      if (tokens.size > 1) flag(issues, 'duplicateEmailConflictingTokens', user._id)
    }
  }
  return { scanned: page.page.length, issues, userDayKeys: [], continueCursor: page.continueCursor, isDone: page.isDone }
}

async function scanCategories(ctx: QueryCtx, opts: PageOpts): Promise<PageCore> {
  const issues = emptyIssues('categories')
  const getUser = cachedGetter(ctx, 'users')
  const page = await ctx.db.query('categories').paginate(opts)
  for (const category of page.page) {
    if (!(await getUser(category.userId))) flag(issues, 'missingOwner', category._id)
  }
  return { scanned: page.page.length, issues, userDayKeys: [], continueCursor: page.continueCursor, isDone: page.isDone }
}

async function scanSaleSessions(ctx: QueryCtx, opts: PageOpts, now: number): Promise<PageCore> {
  const issues = emptyIssues('saleSessions')
  const getUser = cachedGetter(ctx, 'users')
  const dayKeys = new Set<string>()
  const page = await ctx.db.query('saleSessions').paginate(opts)
  for (const session of page.page) {
    const id = session._id
    if (!(await getUser(session.userId))) flag(issues, 'missingOwner', id)
    if (!isPositiveAmount(session.totalAmount)) flag(issues, 'invalidTotalAmount', id)
    if (!Number.isInteger(session.itemCount) || session.itemCount <= 0) flag(issues, 'invalidItemCount', id)

    if (!isValidDate(session.sessionDate)) flag(issues, 'invalidSessionDate', id)
    else {
      if (session.sessionDate > now + FUTURE_SLACK_MS) flag(issues, 'futureSessionDate', id)
      if (!isPktMidnight(session.sessionDate)) flag(issues, 'sessionDateNotPktMidnight', id)
    }

    const items = await ctx.db
      .query('sales')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', id))
      .take(AUDIT_SESSION_ITEMS_MAX + 1)
    if (items.length > AUDIT_SESSION_ITEMS_MAX) flag(issues, 'itemsNotChecked', id)
    else {
      if (items.length !== session.itemCount) flag(issues, 'itemCountMismatch', id)
      const sum = items.reduce((acc, item) => acc + item.amount, 0)
      if (!(Math.abs(sum - session.totalAmount) <= AMOUNT_EPSILON)) flag(issues, 'totalAmountMismatch', id)
    }

    const key = userDayKey(session.userId, session.sessionDate)
    if (key) dayKeys.add(key)
  }
  return {
    scanned: page.page.length,
    issues,
    userDayKeys: [...dayKeys],
    continueCursor: page.continueCursor,
    isDone: page.isDone,
  }
}

async function scanSales(ctx: QueryCtx, opts: PageOpts, now: number): Promise<PageCore> {
  const issues = emptyIssues('sales')
  const getUser = cachedGetter(ctx, 'users')
  const getSession = cachedGetter(ctx, 'saleSessions')
  const getCategory = cachedGetter(ctx, 'categories')
  const page = await ctx.db.query('sales').paginate(opts)
  for (const sale of page.page) {
    const id = sale._id
    if (!(await getUser(sale.userId))) flag(issues, 'missingOwner', id)
    if (!isPositiveAmount(sale.amount)) flag(issues, 'invalidAmount', id)

    if (!isValidDate(sale.saleDate)) flag(issues, 'invalidSaleDate', id)
    else if (sale.saleDate > now + FUTURE_SLACK_MS) flag(issues, 'futureSaleDate', id)

    const session = await getSession(sale.sessionId)
    if (!session) flag(issues, 'missingSession', id)
    else {
      if (session.userId !== sale.userId) flag(issues, 'sessionOtherUser', id)
      if (session.sessionDate !== sale.saleDate) flag(issues, 'saleDateMismatch', id)
    }

    if (sale.categoryId !== undefined) {
      const category = await getCategory(sale.categoryId)
      if (!category) flag(issues, 'orphanedCategoryId', id)
      else if (category.userId !== sale.userId) flag(issues, 'crossUserCategoryId', id)
    }
  }
  return { scanned: page.page.length, issues, userDayKeys: [], continueCursor: page.continueCursor, isDone: page.isDone }
}

async function scanExpenses(ctx: QueryCtx, opts: PageOpts, now: number): Promise<PageCore> {
  const issues = emptyIssues('expenses')
  const getUser = cachedGetter(ctx, 'users')
  const dayKeys = new Set<string>()
  const page = await ctx.db.query('expenses').paginate(opts)
  for (const expense of page.page) {
    const id = expense._id
    if (!(await getUser(expense.userId))) flag(issues, 'missingOwner', id)
    if (!isPositiveAmount(expense.amount)) flag(issues, 'invalidAmount', id)
    if (!isValidDate(expense.expenseDate)) flag(issues, 'invalidExpenseDate', id)
    else if (expense.expenseDate > now + FUTURE_SLACK_MS) flag(issues, 'futureExpenseDate', id)

    const key = userDayKey(expense.userId, expense.expenseDate)
    if (key) dayKeys.add(key)
  }
  return {
    scanned: page.page.length,
    issues,
    userDayKeys: [...dayKeys],
    continueCursor: page.continueCursor,
    isDone: page.isDone,
  }
}

function clampNumItems(numItems: number | undefined): number {
  if (numItems === undefined || !Number.isFinite(numItems)) return AUDIT_PAGE_MAX
  return Math.min(AUDIT_PAGE_MAX, Math.max(1, Math.floor(numItems)))
}

/** Audit one page of one table. Read-only. */
export const scanPage = internalQuery({
  args: {
    table: auditTable,
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  returns: pageResultValidator,
  handler: async (ctx, args): Promise<PageResult> => {
    const opts: PageOpts = { cursor: args.cursor, numItems: clampNumItems(args.numItems) }
    const now = Date.now()
    let core: PageCore
    switch (args.table) {
      case 'users':
        core = await scanUsers(ctx, opts)
        break
      case 'categories':
        core = await scanCategories(ctx, opts)
        break
      case 'saleSessions':
        core = await scanSaleSessions(ctx, opts, now)
        break
      case 'sales':
        core = await scanSales(ctx, opts, now)
        break
      case 'expenses':
        core = await scanExpenses(ctx, opts, now)
        break
    }
    return { table: args.table, ...core }
  },
})

function mergeIssues(into: Issues, from: Issues): void {
  for (const [name, entry] of Object.entries(from)) {
    const target = into[name] ?? { count: 0, samples: [] }
    target.count += entry.count
    for (const id of entry.samples) {
      if (target.samples.length >= AUDIT_SAMPLE_MAX) break
      target.samples.push(id)
    }
    into[name] = target
  }
}

/**
 * Audit every table (or just `table`) page by page and return one report.
 * Only calls the read-only `scanPage` query; never writes.
 */
export const run = internalAction({
  args: {
    table: v.optional(auditTable),
    numItems: v.optional(v.number()),
  },
  returns: reportValidator,
  handler: async (ctx, args): Promise<Report> => {
    const tables: readonly AuditTable[] = args.table ? [args.table] : AUDIT_TABLES
    const report: Report = { generatedAt: Date.now(), tables: {}, distinctUserDays: null }
    const userDays = new Set<string>()
    let scannedDays = false

    for (const table of tables) {
      const tableReport = { scanned: 0, pages: 0, issues: emptyIssues(table) }
      let cursor: string | null = null
      for (;;) {
        const page: PageResult = await ctx.runQuery(internal.audit.scanPage, {
          table,
          cursor,
          numItems: args.numItems,
        })
        tableReport.pages += 1
        tableReport.scanned += page.scanned
        mergeIssues(tableReport.issues, page.issues)
        for (const key of page.userDayKeys) userDays.add(key)
        if (page.isDone) break
        cursor = page.continueCursor
      }
      if (table === 'saleSessions' || table === 'expenses') scannedDays = true
      report.tables[table] = tableReport
    }

    report.distinctUserDays = scannedDays ? userDays.size : null
    return report
  },
})
