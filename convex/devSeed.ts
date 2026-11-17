/**
 * DEV-ONLY sample data generator (internal; never callable from the app).
 *
 * Refuses to run unless the deployment has env `ALLOW_DEV_SEED=true`, which is
 * only ever set on the dev deployment. Writes go through the normal model
 * helpers, so validation and the summary-table hooks run exactly as for real
 * sales/expenses.
 *
 *   npx convex env set ALLOW_DEV_SEED true          (dev only)
 *   npx convex run devSeed:seedMonth '{"email":"x@y.com","month":"2026-10"}'
 *   npx convex env remove ALLOW_DEV_SEED
 */
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { readEnv } from './lib/env'
import { validationError } from './lib/errors'
import { CATEGORY_COLORS } from './lib/limits'
import { DEFAULT_TIME_ZONE, dateKeyInTimeZone, zonedStartOfDayMs } from './lib/time'
import { createCategory } from './model/categories'
import { recordExpense } from './model/expenses'
import { recordSaleSession, type SaleItemInput } from './model/sales'

const CATALOG: { category: string; items: [string, number, number][] }[] = [
  { category: 'Drinks',    items: [['Pepsi 1.5L', 220, 260], ['Sprite 500ml', 90, 110], ['Nestle Water 1.5L', 90, 120], ['Tapal Tea 190g', 380, 450], ['Milk Pack 1L', 270, 300]] },
  { category: 'Snacks',    items: [['Lays Masala', 50, 100], ['Super Biscuit', 30, 60], ['Kurkure', 50, 70], ['Peanut Pack', 40, 80], ['Rusk Pack', 150, 220]] },
  { category: 'Grocery',   items: [['Sugar 1kg', 150, 175], ['Atta 5kg', 700, 850], ['Daal Masoor 1kg', 320, 380], ['Cooking Oil 1L', 520, 600], ['Rice 1kg', 280, 360]] },
  { category: 'Household', items: [['Surf Excel 500g', 300, 360], ['Lifebuoy Soap', 110, 140], ['Tissue Box', 150, 220], ['Matchbox', 10, 20], ['Dish Wash Bar', 60, 90]] },
  { category: 'Mobile',    items: [['Jazz Load', 100, 1000], ['Zong Load', 100, 500], ['Charging Cable', 250, 450], ['Earphones', 300, 800]] },
]
const EXPENSES: [string, number, number][] = [
  ['Electricity bill', 2500, 6000], ['Shop rent', 15000, 15000], ['Tea for staff', 100, 300],
  ['Stock transport', 300, 1200], ['Plastic bags', 150, 400], ['Helper salary', 8000, 8000],
]

/** Small deterministic PRNG so re-running a month is reproducible. */
function rng(seedText: string): () => number {
  let a = 0
  for (const ch of seedText) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const seedMonth = internalMutation({
  args: { email: v.string(), month: v.string() },
  returns: v.object({ sessions: v.number(), items: v.number(), expenses: v.number() }),
  handler: async (ctx, args) => {
    if (readEnv('ALLOW_DEV_SEED') !== 'true') throw validationError('Dev seed is disabled on this deployment')
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw validationError('month must be YYYY-MM')

    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first()
    if (!user) throw validationError(`No user with email ${args.email}`)

    // Ensure the sample categories exist (reuse by case-insensitive name).
    const existing = await ctx.db
      .query('categories')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .collect()
    const catIds = new Map<string, Id<'categories'>>()
    for (const [i, group] of CATALOG.entries()) {
      const found = existing.find((c) => c.name.trim().toLowerCase() === group.category.toLowerCase())
      catIds.set(
        group.category,
        found?._id ?? (await createCategory(ctx, user._id, {
          name: group.category,
          color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] as string,
        })),
      )
    }

    const tz = DEFAULT_TIME_ZONE
    const rand = rng(`${args.email}:${args.month}`)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
    const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) / 10) * 10
    const [y, m] = args.month.split('-').map(Number) as [number, number]
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const todayKey = dateKeyInTimeZone(Date.now(), tz)

    let sessions = 0
    let items = 0
    let expenses = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${args.month}-${String(d).padStart(2, '0')}`
      if (dayKey > todayKey) break
      const dayStart = zonedStartOfDayMs(dayKey, tz)
      if (rand() < 0.2) continue // shop closed

      const sessionCount = 1 + Math.floor(rand() * 3)
      for (let s = 0; s < sessionCount; s++) {
        const lines: SaleItemInput[] = []
        const lineCount = 1 + Math.floor(rand() * 3)
        for (let l = 0; l < lineCount; l++) {
          const group = pick(CATALOG)
          const [name, lo, hi] = pick(group.items)
          lines.push({ productName: name, amount: between(lo, hi), categoryId: rand() < 0.85 ? catIds.get(group.category) : undefined })
        }
        await recordSaleSession(ctx, user._id, { items: lines, sessionDate: dayStart })
        sessions++
        items += lines.length
      }

      const isRentDay = d === 1
      if (isRentDay || rand() < 0.3) {
        const [title, lo, hi] = isRentDay ? (EXPENSES[1] as [string, number, number]) : pick(EXPENSES)
        const at = Math.min(dayStart + (9 + Math.floor(rand() * 10)) * 3_600_000, Date.now())
        await recordExpense(ctx, user._id, { amount: between(lo, hi), expenseDate: at, note: title })
        expenses++
      }
    }
    return { sessions, items, expenses }
  },
})
