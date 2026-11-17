import { describe, expect, it } from 'vitest'
import { internal } from '../../convex/_generated/api'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { makeT, type TestT } from './setup'

const PKT = 'Asia/Karachi'
const D1 = zonedStartOfDayMs('2025-03-10', PKT)
const D2 = zonedStartOfDayMs('2025-03-11', PKT)
const FUTURE = Date.UTC(2099, 0, 1) // 05:00 PKT, not midnight
const HOUR = 60 * 60 * 1000

async function snapshot(t: TestT) {
  return t.run(async (ctx) => ({
    users: await ctx.db.query('users').collect(),
    categories: await ctx.db.query('categories').collect(),
    saleSessions: await ctx.db.query('saleSessions').collect(),
    sales: await ctx.db.query('sales').collect(),
    expenses: await ctx.db.query('expenses').collect(),
    dailyTotals: await ctx.db.query('dailyTotals').collect(),
    userTotals: await ctx.db.query('userTotals').collect(),
    categoryStats: await ctx.db.query('categoryStats').collect(),
  }))
}

/** Seed one clean + many bad rows; returns the ids the assertions refer to. */
async function seed(t: TestT) {
  return t.run(async (ctx) => {
    const user = (name: string, email: string, extra: { tokenIdentifier?: string; timeZone?: string } = {}) =>
      ctx.db.insert('users', { name, email, createdAt: 1, ...extra })

    const alice = await user('Alice', 'a@example.com', { tokenIdentifier: 'tok|alice', timeZone: PKT })
    const legacy = await user('Legacy', 'legacy@example.com')
    const dup1 = await user('Dup One', 'dup@example.com', { tokenIdentifier: 'tok|d1' })
    const dup2 = await user('Dup Two', 'dup@example.com', { tokenIdentifier: 'tok|d2' })
    const badTz = await user('Zone', 'tz@example.com', { tokenIdentifier: 'tok|tz', timeZone: 'Not/AZone' })
    const bob = await user('Bob', 'b@example.com', { tokenIdentifier: 'tok|bob' })
    const gone = await user('Gone', 'gone@example.com', { tokenIdentifier: 'tok|gone' })

    const category = (userId: typeof alice, name: string) =>
      ctx.db.insert('categories', { userId, name, color: '#6366F1', createdAt: 1 })
    const catA = await category(alice, 'A')
    await category(bob, 'B')
    const catGone = await category(alice, 'Deleted')
    const catOrphanOwner = await category(gone, 'Orphan owner')

    const session = (userId: typeof alice, sessionDate: number, totalAmount: number, itemCount: number) =>
      ctx.db.insert('saleSessions', { userId, sessionDate, totalAmount, itemCount, createdAt: 1 })
    const s1 = await session(alice, D1, 300, 2)
    const s2 = await session(alice, D1 + 3 * HOUR, NaN, 3)
    const s3 = await session(bob, FUTURE, -5, 0)
    const s4 = await session(gone, D2, 10, 1)
    const s5 = await session(alice, 0, 10, 1)
    const s6 = await session(bob, D2, 60, 3)
    const sDeleted = await session(alice, D1, 0, 1)

    const sale = (
      userId: typeof alice,
      sessionId: typeof s1,
      amount: number,
      saleDate: number,
      categoryId?: typeof catA,
    ) =>
      ctx.db.insert('sales', {
        userId,
        sessionId,
        amount,
        saleDate,
        productName: 'Item',
        createdAt: 1,
        ...(categoryId ? { categoryId } : {}),
      })
    await sale(alice, s1, 100, D1, catA)
    await sale(alice, s1, 200, D1)
    const x3 = await sale(alice, s2, 50, D1)
    const x4 = await sale(gone, s4, 10, D2)
    const x5 = await sale(alice, s5, 10, 0)
    const x6 = await sale(alice, sDeleted, 0, D1)
    const x7 = await sale(bob, s6, 20, D2, catGone)
    const x8 = await sale(bob, s6, 20, D2, catA)
    const x9 = await sale(alice, s6, 20, D2)
    const x10 = await sale(bob, s3, -5, FUTURE)

    const expense = (userId: typeof alice, amount: number, expenseDate: number) =>
      ctx.db.insert('expenses', { userId, amount, expenseDate, createdAt: 1 })
    await expense(alice, 500, D1 + 5 * HOUR)
    const e2 = await expense(alice, Infinity, D2)
    const e3 = await expense(bob, 10, 0)
    const e4 = await expense(bob, 10, FUTURE)
    const e5 = await expense(gone, 10, D1)

    await ctx.db.delete('users', gone)
    await ctx.db.delete('categories', catGone)
    await ctx.db.delete('saleSessions', sDeleted)

    return {
      legacy, dup1, dup2, badTz, catOrphanOwner,
      s2, s3, s4, s5,
      x3, x4, x5, x6, x7, x8, x9, x10,
      e2, e3, e4, e5,
    }
  })
}

type Issue = { count: number; samples: string[] }

function issue(...ids: string[]): Issue {
  return { count: ids.length, samples: ids }
}

describe('audit (read-only)', () => {
  it('reports every check with counts and sample ids, and never writes', async () => {
    const t = makeT()
    const ids = await seed(t)
    const before = await snapshot(t)

    const report = await t.action(internal.audit.run, {})

    expect(await snapshot(t)).toEqual(before)

    const sorted = (i: Issue | undefined) => i && { count: i.count, samples: [...i.samples].sort() }
    const expectIssues = (table: string, expected: Record<string, Issue>) => {
      const actual = report.tables[table]?.issues ?? {}
      expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
      for (const [name, value] of Object.entries(expected)) {
        expect(sorted(actual[name]), `${table}.${name}`).toEqual(sorted(value))
      }
    }

    expect(report.tables.users?.scanned).toBe(6)
    expectIssues('users', {
      missingTokenIdentifier: issue(ids.legacy),
      emptyEmail: issue(),
      duplicateEmail: issue(ids.dup1, ids.dup2),
      duplicateEmailConflictingTokens: issue(ids.dup1, ids.dup2),
      invalidTimeZone: issue(ids.badTz),
    })

    expect(report.tables.categories?.scanned).toBe(3)
    expectIssues('categories', { missingOwner: issue(ids.catOrphanOwner) })

    expect(report.tables.saleSessions?.scanned).toBe(6)
    expectIssues('saleSessions', {
      missingOwner: issue(ids.s4),
      invalidTotalAmount: issue(ids.s2, ids.s3),
      invalidItemCount: issue(ids.s3),
      itemCountMismatch: issue(ids.s2, ids.s3),
      totalAmountMismatch: issue(ids.s2),
      itemsNotChecked: issue(),
      invalidSessionDate: issue(ids.s5),
      futureSessionDate: issue(ids.s3),
      sessionDateNotPktMidnight: issue(ids.s2, ids.s3),
    })

    expect(report.tables.sales?.scanned).toBe(10)
    expectIssues('sales', {
      missingOwner: issue(ids.x4),
      invalidAmount: issue(ids.x6, ids.x10),
      missingSession: issue(ids.x6),
      sessionOtherUser: issue(ids.x9),
      saleDateMismatch: issue(ids.x3),
      orphanedCategoryId: issue(ids.x7),
      crossUserCategoryId: issue(ids.x8),
      invalidSaleDate: issue(ids.x5),
      futureSaleDate: issue(ids.x10),
    })

    expect(report.tables.expenses?.scanned).toBe(5)
    expectIssues('expenses', {
      missingOwner: issue(ids.e5),
      invalidAmount: issue(ids.e2),
      invalidExpenseDate: issue(ids.e3),
      futureExpenseDate: issue(ids.e4),
    })

    // sessions: alice 03-10, alice 1970-01-01, bob 2099-01-01, bob 03-11, gone 03-11
    // expenses add: alice 03-11, bob 1970-01-01, gone 03-10
    expect(report.distinctUserDays).toBe(8)
  })

  it('gives the same totals with tiny pages and merges distinct days across pages', async () => {
    const t = makeT()
    await seed(t)
    const big = await t.action(internal.audit.run, {})
    const small = await t.action(internal.audit.run, { numItems: 2 })
    for (const [table, value] of Object.entries(big.tables)) {
      const other = small.tables[table]
      expect(other?.scanned).toBe(value.scanned)
      expect(other?.pages).toBeGreaterThan(value.pages)
      for (const [name, entry] of Object.entries(value.issues)) {
        expect(other?.issues[name]?.count, `${table}.${name}`).toBe(entry.count)
      }
    }
    expect(small.distinctUserDays).toBe(big.distinctUserDays)
  })

  it('caps samples at 20 while counting every issue', async () => {
    const t = makeT()
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert('users', { name: `U${i}`, email: `u${i}@example.com`, createdAt: 1 })
      }
    })
    const report = await t.action(internal.audit.run, { table: 'users', numItems: 7 })
    expect(Object.keys(report.tables)).toEqual(['users'])
    expect(report.tables.users?.issues.missingTokenIdentifier?.count).toBe(25)
    expect(report.tables.users?.issues.missingTokenIdentifier?.samples).toHaveLength(20)
    expect(report.distinctUserDays).toBeNull()
  })

  it('scanPage clamps numItems to 1..200', async () => {
    const t = makeT()
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert('users', { name: `U${i}`, email: `u${i}@example.com`, createdAt: 1 })
      }
    })
    const page = await t.query(internal.audit.scanPage, { table: 'users', cursor: null, numItems: 5000 })
    expect(page.scanned).toBe(200)
    expect(page.isDone).toBe(false)
    const tiny = await t.query(internal.audit.scanPage, { table: 'users', cursor: null, numItems: 0 })
    expect(tiny.scanned).toBe(1)
  })

  it('handles an empty database', async () => {
    const t = makeT()
    const report = await t.action(internal.audit.run, {})
    for (const table of ['users', 'categories', 'saleSessions', 'sales', 'expenses']) {
      expect(report.tables[table]?.scanned).toBe(0)
      expect(report.tables[table]?.pages).toBe(1)
    }
    expect(report.distinctUserDays).toBe(0)
  })
})
