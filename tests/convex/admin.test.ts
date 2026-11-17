import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import type { FunctionReturnType, UserIdentity } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { dateKeyInTimeZone } from '../../convex/lib/time'
import { IDENTITIES, makeT, signIn, signInAndUpsert, stubAdminEmails, type TestT } from './setup'
import { KHI, fakeAllTimers, rebuildNow, seedExpense, seedSession } from './totalsFixtures'

/** 2026-11-17 17:00 PKT. */
const NOW = '2026-11-17T12:00:00Z'
/** Instant at `hh:00` PKT on 2026-`mmdd`. */
const pkt = (monthDay: string, hour = 10) => Date.parse(`2026-${monthDay}T${String(hour).padStart(2, '0')}:00:00+05:00`)

const OVERVIEW_ARGS = { timeZone: KHI, paginationOpts: { numItems: 40, cursor: null } }
const LIST_ARGS = { paginationOpts: { numItems: 10, cursor: null }, timeZone: KHI }

async function errorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

beforeEach(() => {
  fakeAllTimers(NOW)
  stubAdminEmails()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type Seeded = { t: TestT; a: Id<'users'>; b: Id<'users'>; c: Id<'users'>; d: Id<'users'> }

/**
 * A (totals ready): today 100 sale + 30 expense, 11-12 50, 10-25 70, 10-10 999, future 11-20 500.
 * B (not ready):    11-03 40 sale + 10 expense.
 * C (not ready):    nothing.
 * D (ready, joined in October): today 25 expense only.
 */
async function seed(): Promise<Seeded> {
  const t = makeT()
  const { userId: a } = await signInAndUpsert(t, IDENTITIES.A)
  const { userId: b } = await signInAndUpsert(t, IDENTITIES.B)
  const { userId: c } = await signInAndUpsert(t, IDENTITIES.NOT_ADMIN_ROLE)
  const d = await t.run((ctx) =>
    ctx.db.insert('users', { name: 'Dawood', email: 'd@example.com', createdAt: pkt('10-01') }),
  )
  await seedSession(t, a, pkt('11-17'), [{ amount: 60 }, { amount: 40 }])
  await seedExpense(t, a, pkt('11-17', 11), 30)
  await seedSession(t, a, pkt('11-12'), [{ amount: 50 }])
  await seedSession(t, a, pkt('10-25'), [{ amount: 70 }])
  await seedSession(t, a, pkt('10-10'), [{ amount: 999 }])
  await seedSession(t, a, pkt('11-20'), [{ amount: 500 }])
  await seedSession(t, b, pkt('11-03'), [{ amount: 40 }])
  await seedExpense(t, b, pkt('11-03'), 10)
  await seedExpense(t, d, pkt('11-17', 9), 25)
  await rebuildNow(t, a)
  await rebuildNow(t, d)
  return { t, a, b, c, d }
}

type OverviewTotals = {
  users: number
  activeToday: number
  active7d: number
  active30d: number
  todaySales: number
  todayExpenses: number
  monthSales: number
  monthExpenses: number
  newThisMonth: number
}

/** Load every overview page (numItems per page) and sum, like the client does. */
async function loadOverview(t: TestT, numItems: number, who: Partial<UserIdentity> = IDENTITIES.ADMIN) {
  const sums: OverviewTotals = {
    users: 0, activeToday: 0, active7d: 0, active30d: 0,
    todaySales: 0, todayExpenses: 0, monthSales: 0, monthExpenses: 0, newThisMonth: 0,
  }
  const fromTotals: Record<string, boolean> = {}
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const res: FunctionReturnType<typeof api.admin.overview> = await signIn(t, who).query(api.admin.overview, { timeZone: KHI, paginationOpts: { numItems, cursor } })
    pages++
    for (const r of res.page) {
      sums.users++
      if (r.activeToday) sums.activeToday++
      if (r.active7d) sums.active7d++
      if (r.active30d) sums.active30d++
      if (r.newThisMonth) sums.newThisMonth++
      sums.todaySales += r.todaySales
      sums.todayExpenses += r.todayExpenses
      sums.monthSales += r.monthSales
      sums.monthExpenses += r.monthExpenses
      fromTotals[r.userId] = r.fromTotals
      expect(r.partial).toBe(false)
    }
    if (res.isDone) return { sums, fromTotals, pages, todayKey: res.todayKey, monthKey: res.monthKey }
    cursor = res.continueCursor
    if (pages > 20) throw new Error('overview did not finish')
  }
}

const addKey = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** Independent from-source recompute over every user's raw sessions / expenses. */
async function recomputeOverview(t: TestT, nowMs: number, tz: string): Promise<OverviewTotals> {
  return t.run(async (ctx) => {
    const today = dateKeyInTimeZone(nowMs, tz)
    const month = today.slice(0, 7)
    const k7 = addKey(today, -6)
    const k30 = addKey(today, -29)
    const out: OverviewTotals = {
      users: 0, activeToday: 0, active7d: 0, active30d: 0,
      todaySales: 0, todayExpenses: 0, monthSales: 0, monthExpenses: 0, newThisMonth: 0,
    }
    for (const u of await ctx.db.query('users').collect()) {
      out.users++
      if (dateKeyInTimeZone(u.createdAt, tz).slice(0, 7) === month && u.createdAt <= nowMs) out.newThisMonth++
      const keys: string[] = []
      for (const s of await ctx.db.query('saleSessions').withIndex('by_userId_sessionDate', (q) => q.eq('userId', u._id)).collect()) {
        const k = dateKeyInTimeZone(s.sessionDate, tz)
        if (k > today) continue
        keys.push(k)
        if (k === today) out.todaySales += s.totalAmount
        if (k.slice(0, 7) === month) out.monthSales += s.totalAmount
      }
      for (const e of await ctx.db.query('expenses').withIndex('by_userId_expenseDate', (q) => q.eq('userId', u._id)).collect()) {
        const k = dateKeyInTimeZone(e.expenseDate, tz)
        if (k > today) continue
        keys.push(k)
        if (k === today) out.todayExpenses += e.amount
        if (k.slice(0, 7) === month) out.monthExpenses += e.amount
      }
      if (keys.includes(today)) out.activeToday++
      if (keys.some((k) => k >= k7)) out.active7d++
      if (keys.some((k) => k >= k30)) out.active30d++
    }
    return out
  })
}

describe('admin functions are admin-only', () => {
  const calls = (t: TestT, who: Partial<UserIdentity> | null) => {
    const as = who ? signIn(t, who) : t
    return [
      as.query(api.admin.overview, OVERVIEW_ARGS),
      as.query(api.admin.listUsers, LIST_ARGS),
      as.query(api.admin.listUsers, { ...LIST_ARGS, search: 'a', sort: 'name' }),
      as.query(api.admin.getUser, { userId: 'anything', timeZone: KHI }),
    ]
  }

  it('signed out → UNAUTHORIZED', async () => {
    const t = makeT()
    for (const p of calls(t, null)) expect(await errorData(p)).toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  })

  it('non-admin, Clerk-role "Admin" and unverified listed email → FORBIDDEN', async () => {
    const { t } = await seed()
    for (const who of [IDENTITIES.A, IDENTITIES.CLERK_ROLE_ADMIN, IDENTITIES.ADMIN_UNVERIFIED, IDENTITIES.NOT_ADMIN_ROLE]) {
      for (const p of calls(t, who)) expect(await errorData(p)).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    }
  })

  it('ADMIN_EMAILS unset → nobody is admin', async () => {
    const { t } = await seed()
    vi.unstubAllEnvs()
    for (const p of calls(t, IDENTITIES.ADMIN)) expect(await errorData(p)).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })
})

describe('admin.overview', () => {
  it('matches a from-source recompute (ready + not-ready users), on one page or many', async () => {
    const { t, a, b, c, d } = await seed()
    const expected = await recomputeOverview(t, Date.now(), KHI)
    expect(expected).toEqual({
      users: 4, activeToday: 2, active7d: 2, active30d: 3,
      todaySales: 100, todayExpenses: 55, monthSales: 190, monthExpenses: 65, newThisMonth: 3,
    })

    const one = await loadOverview(t, 40)
    expect(one.sums).toEqual(expected)
    expect(one.pages).toBe(1)
    expect(one.todayKey).toBe('2026-11-17')
    expect(one.monthKey).toBe('2026-11')
    expect(one.fromTotals).toEqual({ [a]: true, [b]: false, [c]: false, [d]: true })

    const paged = await loadOverview(t, 1)
    expect(paged.sums).toEqual(expected)
    expect(paged.pages).toBeGreaterThanOrEqual(4)
  })

  it('gives the same numbers on the scan path (TOTALS_READS=off) and for a zone the totals were not built in', async () => {
    const { t } = await seed()
    const ready = (await loadOverview(t, 40)).sums
    vi.stubEnv('TOTALS_READS', 'off')
    const scan = await loadOverview(t, 40)
    expect(scan.sums).toEqual(ready)
    expect(Object.values(scan.fromTotals).every((v) => !v)).toBe(true)
    vi.stubEnv('TOTALS_READS', '')

    const utc = await signIn(t, IDENTITIES.ADMIN).query(api.admin.overview, { ...OVERVIEW_ARGS, timeZone: 'UTC' })
    expect(utc.page.every((r) => !r.fromTotals)).toBe(true)
    const utcSum = utc.page.reduce((s, r) => s + r.monthSales, 0)
    expect(utcSum).toBe((await recomputeOverview(t, Date.now(), 'UTC')).monthSales)
  })

  it('flags a not-ready user whose window exceeds the scan cap as partial', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await t.run(async (ctx) => {
      for (let i = 0; i < 260; i++) {
        await ctx.db.insert('saleSessions', { userId, totalAmount: 1, itemCount: 1, sessionDate: pkt('11-17') + i, createdAt: 0 })
      }
    })
    const res = await signIn(t, IDENTITIES.ADMIN).query(api.admin.overview, OVERVIEW_ARGS)
    expect(res.page[0]).toMatchObject({ partial: true, activeToday: true, todaySales: 250 })
  })
})

describe('admin.listUsers', () => {
  it('returns sales figures, last activity and readiness per user', async () => {
    const { t, a, b, c, d } = await seed()
    const res = await signIn(t, IDENTITIES.ADMIN).query(api.admin.listUsers, { ...LIST_ARGS, sort: 'name' })
    expect(res.isDone).toBe(true)
    expect(res.page).toEqual([
      expect.objectContaining({
        _id: a, name: 'Alice', email: 'a@example.com', todaySales: 100, monthSales: 150,
        allTimeSales: 1719, lastActivityAt: pkt('11-17', 11), totalsReady: true, partial: false,
      }),
      expect.objectContaining({
        _id: b, name: 'Bilal', todaySales: 0, monthSales: 40, allTimeSales: 40,
        lastActivityAt: pkt('11-03'), totalsReady: false, partial: false,
      }),
      expect.objectContaining({
        _id: c, name: 'Chaudhry', todaySales: 0, monthSales: 0, allTimeSales: 0, lastActivityAt: null, totalsReady: false,
      }),
      expect.objectContaining({
        _id: d, name: 'Dawood', createdAt: pkt('10-01'), todaySales: 0, allTimeSales: 0,
        lastActivityAt: pkt('11-17', 9), totalsReady: true,
      }),
    ])
  })

  it('sorts newest / oldest / name on the server', async () => {
    const { t } = await seed()
    const names = async (sort: 'newest' | 'oldest' | 'name' | undefined) =>
      (await signIn(t, IDENTITIES.ADMIN).query(api.admin.listUsers, { ...LIST_ARGS, ...(sort ? { sort } : {}) }))
        .page.map((r) => r.name)
    expect(await names(undefined)).toEqual(['Dawood', 'Chaudhry', 'Bilal', 'Alice'])
    expect(await names('newest')).toEqual(['Dawood', 'Chaudhry', 'Bilal', 'Alice'])
    expect(await names('oldest')).toEqual(['Alice', 'Bilal', 'Chaudhry', 'Dawood'])
    expect(await names('name')).toEqual(['Alice', 'Bilal', 'Chaudhry', 'Dawood'])
  })

  async function allPages(t: TestT, args: { search?: string; sort?: 'newest' | 'oldest' | 'name' }, numItems: number) {
    const out: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const res: FunctionReturnType<typeof api.admin.listUsers> = await signIn(t, IDENTITIES.ADMIN).query(api.admin.listUsers, {
        ...args, timeZone: KHI, paginationOpts: { numItems, cursor },
      })
      expect(res.page.length).toBeLessThanOrEqual(numItems)
      out.push(...res.page.map((r) => r.name))
      if (res.isDone) return out
      cursor = res.continueCursor
    }
    throw new Error('listUsers did not finish')
  }

  it('paginates without gaps or duplicates', async () => {
    const { t } = await seed()
    expect(await allPages(t, { sort: 'name' }, 1)).toEqual(['Alice', 'Bilal', 'Chaudhry', 'Dawood'])
    expect(await allPages(t, { sort: 'newest' }, 3)).toEqual(['Dawood', 'Chaudhry', 'Bilal', 'Alice'])
    const first = await signIn(t, IDENTITIES.ADMIN).query(api.admin.listUsers, {
      ...LIST_ARGS, sort: 'name', paginationOpts: { numItems: 2, cursor: null },
    })
    expect(first.page.map((r) => r.name)).toEqual(['Alice', 'Bilal'])
    expect(first.isDone).toBe(false)
  })

  it('searches name and email case-insensitively, across pages', async () => {
    const { t } = await seed()
    expect(await allPages(t, { search: '  BIL ' }, 10)).toEqual(['Bilal'])
    expect(await allPages(t, { search: 'D@EXAMPLE' }, 10)).toEqual(['Dawood'])
    expect(await allPages(t, { search: 'a', sort: 'name' }, 1)).toEqual(['Alice', 'Bilal', 'Chaudhry', 'Dawood'])
    expect(await allPages(t, { search: 'ali', sort: 'name' }, 1)).toEqual(['Alice'])
    expect(await allPages(t, { search: 'nobody-here' }, 10)).toEqual([])
    expect(await allPages(t, { search: '   ' }, 10)).toHaveLength(4)
  })

  it('getUser returns the same row as listUsers, null for bad / deleted ids', async () => {
    const { t, a, b } = await seed()
    const admin = signIn(t, IDENTITIES.ADMIN)
    const listed = (await admin.query(api.admin.listUsers, { ...LIST_ARGS, sort: 'name' })).page[0]
    expect(await admin.query(api.admin.getUser, { userId: a, timeZone: KHI })).toEqual(listed)
    const categoryId = await t.run((ctx) => ctx.db.insert('categories', { userId: a, name: 'F', color: '#6366F1', createdAt: 0 }))
    for (const bad of ['', 'nope', categoryId]) {
      expect(await admin.query(api.admin.getUser, { userId: bad })).toBeNull()
    }
    await t.run((ctx) => ctx.db.delete('users', b))
    expect(await admin.query(api.admin.getUser, { userId: b })).toBeNull()
  })

  it('reuses the per-user queries for the selected user (viewAsUserId)', async () => {
    const { t, a } = await seed()
    const stats = await signIn(t, IDENTITIES.ADMIN).query(api.saleSessions.getStats, {
      todayStart: pkt('11-17', 0), todayEnd: pkt('11-18', 0) - 1,
      weekStart: pkt('11-16', 0), weekEnd: pkt('11-23', 0) - 1,
      monthStart: pkt('11-01', 0), monthEnd: pkt('12-01', 0) - 1,
      timeZone: KHI, viewAsUserId: a,
    })
    expect(stats).toMatchObject({ todaySalesTotal: 100, todayExpenseTotal: 30, allTimeSalesTotal: 1719 })
  })
})
