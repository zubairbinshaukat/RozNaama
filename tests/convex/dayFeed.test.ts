import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { zonedStartOfDayMs } from '../../convex/lib/time'
import { IDENTITIES, makeT, signIn, signInAndUpsert, stubAdminEmails, type TestT } from './setup'
import { KHI, fakeAllTimers, readDays, rebuildNow, seedExpense, seedSession } from './totalsFixtures'
import { DAY_FEED_DAY_HARD_CAP, DAY_FEED_MAX_BOUND_DAYS, DAY_FEED_ROW_CAP } from '../../convex/saleSessions'

const NOW = '2026-11-17T12:00:00Z'

beforeEach(() => stubAdminEmails())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type Feed = Awaited<ReturnType<typeof feedPage>>
type As = ReturnType<typeof signIn>
type Opts = { numItems: number; cursor: string | null; endCursor?: string | null }

function feedPage(as: As, paginationOpts: Opts, range: { startDate?: number; endDate?: number } = {}, timeZone = KHI) {
  return as.query(api.saleSessions.getDayFeed, { paginationOpts, timeZone, ...range })
}

const at = (key: string, hours = 0) => zonedStartOfDayMs(key, KHI) + hours * 3600_000

/** Seed: 5 sale days, 2 expense-only days, one day with both. */
async function seedFeed(t: TestT, userId: Id<'users'>) {
  await seedSession(t, userId, at('2026-11-17'), [{ amount: 100 }, { amount: 20 }])
  await seedSession(t, userId, at('2026-11-17', 3), [{ amount: 5 }])
  await seedExpense(t, userId, at('2026-11-17', 9), 30)
  await seedExpense(t, userId, at('2026-11-15', 10), 12) // expense-only day
  await seedSession(t, userId, at('2026-11-12'), [{ amount: 7 }])
  await seedSession(t, userId, at('2026-10-31'), [{ amount: 8 }, { amount: 2 }])
  await seedExpense(t, userId, at('2026-10-20', 12), 4)   // expense-only day
  await seedSession(t, userId, at('2026-09-01'), [{ amount: 1 }])
  await seedSession(t, userId, at('2025-12-31', 23), [{ amount: 9 }])
}

const ALL_DAYS = ['2026-11-17', '2026-11-15', '2026-11-12', '2026-10-31', '2026-10-20', '2026-09-01', '2025-12-31']

/** Walk the feed like convex/react's usePaginatedQuery (no endCursor). */
async function walkPlain(as: As, n: number, range = {}) {
  const pages: Feed[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const page = await feedPage(as, { numItems: n, cursor }, range)
    pages.push(page)
    if (page.isDone) break
    cursor = page.continueCursor
  }
  return pages
}

describe('saleSessions.getDayFeed', () => {
  for (const mode of ['not ready (scan)', 'ready (dailyTotals)'] as const) {
    it(`${mode}: pages newest day first with correct day totals`, async () => {
      fakeAllTimers(NOW)
      const t = makeT()
      const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
      await seedFeed(t, userId)
      if (mode === 'ready (dailyTotals)') await rebuildNow(t, userId)

      const pages = await walkPlain(as, 3)
      expect(pages.map((p) => p.page.map((e) => e.date))).toEqual([
        ALL_DAYS.slice(0, 3), ALL_DAYS.slice(3, 6), ALL_DAYS.slice(6),
      ])
      expect(pages.map((p) => p.isDone)).toEqual([false, false, true])
      expect(pages[0]!.continueCursor).toBe('2026-11-12')

      const today = pages[0]!.page[0]!
      expect(today).toMatchObject({ date: '2026-11-17', salesTotal: 125, expenseTotal: 30, saleCount: 3, expenseCount: 1 })
      expect(today.sessions.map((s) => s.items.length).sort()).toEqual([1, 2])
      expect(today.expenses.map((e) => e.amount)).toEqual([30])

      const expenseOnly = pages[0]!.page[1]!
      expect(expenseOnly).toMatchObject({ date: '2026-11-15', salesTotal: 0, saleCount: 0, expenseTotal: 12, expenseCount: 1 })
      expect(expenseOnly.sessions).toEqual([])
    })
  }

  it('ready and not-ready paths return identical pages', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedFeed(t, userId)
    await rebuildNow(t, userId)
    const ready = await walkPlain(as, 2)
    vi.stubEnv('TOTALS_READS', 'off')
    expect(await walkPlain(as, 2)).toEqual(ready)
  })

  it('startDate / endDate restrict to whole days in range', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedFeed(t, userId)
    const range = { startDate: at('2026-10-20', 15), endDate: at('2026-11-15', 1) }
    const pages = await walkPlain(as, 10, range)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.page.map((e) => e.date)).toEqual(['2026-11-15', '2026-11-12', '2026-10-31', '2026-10-20'])
    expect(pages[0]!.isDone).toBe(true)
  })

  it('convex-helpers usePaginatedQuery sequence: bound pages stay stable when a new day appears', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedFeed(t, userId)
    await rebuildNow(t, userId)

    // First page, then loadMore: page 0 is re-bound with endCursor, page 1 starts at its cursor.
    const p0 = await feedPage(as, { numItems: 2, cursor: null })
    const p0Bound = await feedPage(as, { numItems: 2, cursor: null, endCursor: p0.continueCursor })
    const p1 = await feedPage(as, { numItems: 2, cursor: p0.continueCursor })
    expect(p0Bound).toEqual(p0)
    expect(p1.page.map((e) => e.date)).toEqual(['2026-11-12', '2026-10-31'])

    // A sale on a NEW newest day: the bound page grows instead of dropping a day.
    await as.mutation(api.saleSessions.record, { sessionDate: at('2026-11-18'), items: [{ productName: 'n', amount: 1 }] })
    const p0Rerun = await feedPage(as, { numItems: 2, cursor: null, endCursor: p0.continueCursor })
    const p1Rerun = await feedPage(as, { numItems: 2, cursor: p0.continueCursor })
    expect(p0Rerun.page.map((e) => e.date)).toEqual(['2026-11-18', '2026-11-17', '2026-11-15'])
    expect(p0Rerun.continueCursor).toBe(p0.continueCursor)
    expect(p0Rerun.isDone).toBe(false)
    expect(p1Rerun.page.map((e) => e.date)).toEqual(['2026-11-12', '2026-10-31'])

    // Last page bound with endCursor reports isDone once nothing is below it.
    const last = await walkPlain(as, 10)
    const finalCursor = last[0]!.page.at(-1)!.date
    const bound = await feedPage(as, { numItems: 10, cursor: null, endCursor: finalCursor })
    expect(bound.isDone).toBe(true)
  })

  it('rejects malformed cursors with an InvalidCursor error; empty cursor is an empty page', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await expect(feedPage(as, { numItems: 2, cursor: 'garbage' })).rejects.toThrow(/InvalidCursor/)
    expect(await feedPage(as, { numItems: 2, cursor: '' })).toEqual({ page: [], isDone: true, continueCursor: '' })
  })

  it('caps reads per page and ends the page early instead of dropping rows', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await t.run(async (ctx) => {
      for (let i = 0; i < 600; i++) {
        await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: at('2026-11-17', 1) + i, createdAt: 0 })
        await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: at('2026-11-16', 1) + i, createdAt: 0 })
      }
      await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: at('2026-11-10', 1), createdAt: 0 })
    })
    const p0 = await feedPage(as, { numItems: 5, cursor: null })
    expect(p0.page.map((e) => [e.date, e.expenseCount])).toEqual([['2026-11-17', 600]])
    expect(p0.isDone).toBe(false)
    const p1 = await feedPage(as, { numItems: 5, cursor: p0.continueCursor })
    expect(p1.page.map((e) => [e.date, e.expenseCount])).toEqual([['2026-11-16', 600], ['2026-11-10', 1]])
    expect(p1.isDone).toBe(true)
  })

  it('returns an empty page without a user row; isolates users; admin view-as works', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    expect(await feedPage(signIn(t, IDENTITIES.A), { numItems: 3, cursor: null }))
      .toEqual({ page: [], isDone: true, continueCursor: '' })
    const { userId: aId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, aId, at('2026-11-17'), [{ amount: 1 }])
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)
    expect((await feedPage(asB, { numItems: 3, cursor: null })).page).toEqual([])
    const admin = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getDayFeed, {
      paginationOpts: { numItems: 3, cursor: null }, timeZone: KHI, viewAsUserId: aId,
    })
    expect(admin.page.map((e) => e.date)).toEqual(['2026-11-17'])
  })

  it('buckets days in the requested zone on the scan path', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedSession(t, userId, Date.parse('2026-03-10T19:30:00Z'), [{ amount: 1 }])
    const khi = await feedPage(as, { numItems: 3, cursor: null })
    const utc = await feedPage(as, { numItems: 3, cursor: null }, {}, 'UTC')
    expect(khi.page.map((e) => e.date)).toEqual(['2026-03-11'])
    expect(utc.page.map((e) => e.date)).toEqual(['2026-03-10'])
  })
})

// ─── Review follow-ups: L1 (never split a day silently), L2 (no premature isDone), DST gaps ───

async function insertExpenses(t: TestT, userId: Id<'users'>, dayKey: string, n: number, tz = KHI) {
  const start = zonedStartOfDayMs(dayKey, tz) + 3600_000
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: start + i, createdAt: 0 })
    }
  })
}

/**
 * Resolve one bound page like convex-helpers' usePaginatedQuery does on
 * `SplitRequired`: re-query [splitCursor, cursor) and [endCursor, splitCursor).
 */
async function resolveBound(as: As, cursor: string | null, endCursor: string, depth = 0): Promise<Feed['page']> {
  expect(depth).toBeLessThan(20)
  const page = await feedPage(as, { numItems: 3, cursor, endCursor })
  if (page.pageStatus !== 'SplitRequired') return page.page
  const split = page.splitCursor
  expect(typeof split).toBe('string')
  expect(page.continueCursor).toBe(endCursor)
  return [
    ...(await resolveBound(as, cursor, split as string, depth + 1)),
    ...(await resolveBound(as, split as string, endCursor, depth + 1)),
  ]
}

describe('getDayFeed: a day is never split silently (L1)', () => {
  for (const mode of ['not ready (scan)', 'ready (dailyTotals)'] as const) {
    it(`${mode}: a day with > ${DAY_FEED_ROW_CAP} rows comes back whole on its own page`, async () => {
      fakeAllTimers(NOW)
      const t = makeT()
      const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
      await insertExpenses(t, userId, '2026-11-17', 1200)
      await seedSession(t, userId, at('2026-11-17', 5), [{ amount: 3 }])
      await seedExpense(t, userId, at('2026-11-16', 2), 5)
      if (mode === 'ready (dailyTotals)') await rebuildNow(t, userId)

      const p0 = await feedPage(as, { numItems: 5, cursor: null })
      expect(p0.page.map((e) => [e.date, e.expenseCount, e.saleCount, e.truncated])).toEqual([['2026-11-17', 1200, 1, undefined]])
      expect(p0.page[0]!.expenseTotal).toBe(1200)
      expect(p0).toMatchObject({ isDone: false, continueCursor: '2026-11-17' })
      const p1 = await feedPage(as, { numItems: 5, cursor: p0.continueCursor })
      expect(p1.page.map((e) => [e.date, e.expenseCount])).toEqual([['2026-11-16', 1]])
      expect(p1.isDone).toBe(true)

      // The same page re-bound with endCursor (convex-helpers) is also whole.
      const bound = await feedPage(as, { numItems: 5, cursor: null, endCursor: '2026-11-17' })
      expect(bound.page.map((e) => [e.date, e.expenseCount])).toEqual([['2026-11-17', 1200]])
      expect(bound.pageStatus).toBeUndefined()
      expect(bound.isDone).toBe(false)
    })
  }

  it(`a day beyond the hard cap (${DAY_FEED_DAY_HARD_CAP}) is returned capped and flagged truncated`, async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await insertExpenses(t, userId, '2026-11-17', DAY_FEED_DAY_HARD_CAP + 5)
    await seedExpense(t, userId, at('2026-11-15', 2), 5)
    const p0 = await feedPage(as, { numItems: 5, cursor: null })
    expect(p0.page).toHaveLength(1)
    expect(p0.page[0]).toMatchObject({ date: '2026-11-17', expenseCount: DAY_FEED_DAY_HARD_CAP, truncated: true })
    expect(p0).toMatchObject({ isDone: false, continueCursor: '2026-11-17' })
    const p1 = await feedPage(as, { numItems: 5, cursor: p0.continueCursor })
    expect(p1.page.map((e) => e.date)).toEqual(['2026-11-15'])
    expect(p1.page[0]!.truncated).toBeUndefined()
  }, 30_000)

  for (const mode of ['not ready (scan)', 'ready (dailyTotals)'] as const) {
    it(`${mode}: an endCursor-bound page that outgrows the row cap asks for a split instead of going partial`, async () => {
      fakeAllTimers(NOW)
      const t = makeT()
      const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
      for (const k of ['2026-11-17', '2026-11-16', '2026-11-15', '2026-11-14']) await seedExpense(t, userId, at(k, 1), 1)
      if (mode === 'ready (dailyTotals)') await rebuildNow(t, userId)
      const p0 = await feedPage(as, { numItems: 3, cursor: null })
      expect(p0.continueCursor).toBe('2026-11-15')

      // Rows pile into the bound range (e.g. a bulk import): 700 + 700 > 1000.
      for (const k of ['2026-11-17', '2026-11-16']) {
        for (let i = 0; i < 7; i++) {
          await as.mutation(api.saleSessions.record, {
            sessionDate: at(k), items: [{ productName: 'x', amount: 1 }],
          })
        }
        await insertExpenses(t, userId, k, 700)
        if (mode === 'ready (dailyTotals)') await rebuildNow(t, userId)
      }
      const rerun = await feedPage(as, { numItems: 3, cursor: null, endCursor: p0.continueCursor })
      expect(rerun).toMatchObject({ page: [], pageStatus: 'SplitRequired', continueCursor: '2026-11-15', isDone: false })

      const days = await resolveBound(as, null, p0.continueCursor)
      expect(days.map((e) => [e.date, e.expenseCount, e.saleCount])).toEqual([
        ['2026-11-17', 701, 7], ['2026-11-16', 701, 7], ['2026-11-15', 1, 0],
      ])
      expect(days.every((e) => e.truncated === undefined)).toBe(true)
    })
  }

  it(`an endCursor-bound page that grows past ${DAY_FEED_MAX_BOUND_DAYS} days splits instead of dropping days`, async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedExpense(t, userId, at('2025-01-01', 1), 1)
    const p0 = await feedPage(as, { numItems: 3, cursor: null })
    expect(p0.continueCursor).toBe('2025-01-01')
    // 210 newer days appear above the bound page's end.
    await t.run(async (ctx) => {
      for (let i = 0; i < 210; i++) {
        await ctx.db.insert('expenses', { userId, amount: 1, expenseDate: at('2025-06-01', 1) + i * 86_400_000, createdAt: 0 })
      }
    })
    const rerun = await feedPage(as, { numItems: 3, cursor: null, endCursor: p0.continueCursor })
    expect(rerun.pageStatus).toBe('SplitRequired')
    const days = await resolveBound(as, null, p0.continueCursor)
    expect(days).toHaveLength(211)
    expect(days.at(-1)!.date).toBe('2025-01-01')
    expect(new Set(days.map((e) => e.date)).size).toBe(211)
  }, 30_000)
})

describe('getDayFeed: isDone only when the index is exhausted (L2)', () => {
  it('stray empty dailyTotals rows do not end the feed early', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedExpense(t, userId, at('2026-11-17', 1), 1)
    await seedExpense(t, userId, at('2026-01-05', 1), 2)
    await rebuildNow(t, userId)
    // Corrupt: 80 empty rows between the two real days.
    await t.run(async (ctx) => {
      for (let i = 0; i < 80; i++) {
        const dayKey = new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10)
        await ctx.db.insert('dailyTotals', {
          userId, dayKey, salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 0, expenseCount: 0,
        })
      }
    })
    const pages = await walkPlain(as, 1)
    expect(pages.flatMap((p) => p.page.map((e) => e.date))).toEqual(['2026-11-17', '2026-01-05'])
    expect(pages.at(-1)!.isDone).toBe(true)
    expect(pages.slice(0, -1).every((p) => !p.isDone)).toBe(true)
  })

  it('N1: a bound page whose scan stops at its own lower key never asks to split there (no infinite split loop)', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedExpense(t, userId, at('2026-11-17', 1), 1)
    await rebuildNow(t, userId)
    // Corrupt: many empty duplicate rows sitting exactly on the bound's lower key.
    await t.run(async (ctx) => {
      for (let i = 0; i < DAY_FEED_MAX_BOUND_DAYS + 100; i++) {
        await ctx.db.insert('dailyTotals', {
          userId, dayKey: '2026-03-01', salesTotal: 0, itemCount: 0, sessionCount: 0, expenseTotal: 0, expenseCount: 0,
        })
      }
    })
    const bound = await feedPage(as, { numItems: 3, cursor: null, endCursor: '2026-03-01' })
    const splitCursor = (bound as { splitCursor?: string }).splitCursor
    // Either no split, or a split strictly above the lower key (so both halves shrink).
    if (splitCursor !== undefined) expect(splitCursor > '2026-03-01').toBe(true)
    const resolved = await resolveBound(as, null, '2026-03-01')
    expect(resolved.map((e) => e.date)).toEqual(['2026-11-17'])
  })

  it('exactly numItems days: last page reports isDone without an extra empty page', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await seedExpense(t, userId, at('2026-11-17', 1), 1)
    await seedExpense(t, userId, at('2026-11-16', 1), 1)
    const p0 = await feedPage(as, { numItems: 2, cursor: null })
    expect(p0.page).toHaveLength(2)
    expect(p0.isDone).toBe(true)
  })
})

describe('getDayFeed in a zone where midnight does not exist (L3)', () => {
  it('America/Santiago: the hour before the 01:00 day start stays on the previous day (scan and ready)', async () => {
    fakeAllTimers(NOW)
    const t = makeT()
    const SCL = 'America/Santiago'
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await t.run((ctx) => ctx.db.patch('users', userId, { timeZone: SCL }))
    await seedSession(t, userId, Date.parse('2026-09-06T03:30:00Z'), [{ amount: 1 }]) // 09-05 23:30 local
    await seedSession(t, userId, Date.parse('2026-09-06T04:30:00Z'), [{ amount: 2 }]) // 09-06 01:30 local
    const scan = await feedPage(as, { numItems: 5, cursor: null }, {}, SCL)
    expect(scan.page.map((e) => [e.date, e.salesTotal])).toEqual([['2026-09-06', 2], ['2026-09-05', 1]])
    await rebuildNow(t, userId)
    expect(await readDaysKeys(t, userId)).toEqual(['2026-09-05', '2026-09-06'])
    expect(await feedPage(as, { numItems: 5, cursor: null }, {}, SCL)).toEqual(scan)
  })
})

async function readDaysKeys(t: TestT, userId: Id<'users'>) {
  return Object.keys(await readDays(t, userId)).sort()
}
