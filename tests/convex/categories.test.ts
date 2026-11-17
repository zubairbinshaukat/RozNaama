import { describe, expect, it } from 'vitest'
import { ConvexError, v } from 'convex/values'
import { validate } from 'convex-helpers/validators'
import { api } from '../../convex/_generated/api'
import { categoryDoc } from '../../convex/lib/returnValidators'
import { IDENTITIES, makeT, signIn, signInAndUpsert, type TestT } from './setup'

const listReturns = v.array(categoryDoc)
const createReturns = v.id('categories')

async function convexErrorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

const validation = (message: string) => ({ code: 'VALIDATION', message })
const DUPLICATE = validation('A category with this name already exists')
const BAD_COLOR = validation('Please choose one of the available colors')
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Category not found' }

async function categoryCount(t: TestT): Promise<number> {
  return (await t.run((ctx) => ctx.db.query('categories').collect())).length
}

describe('categories auth', () => {
  it('rejects signed-out callers', async () => {
    const t = makeT()
    const unauth = { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    expect(await convexErrorData(t.query(api.categories.list, {}))).toEqual(unauth)
    expect(await convexErrorData(t.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })))
      .toEqual(unauth)
  })

  it('signed in without a user row: list is empty, create throws USER_NOT_FOUND', async () => {
    const t = makeT()
    const as = signIn(t, IDENTITIES.A)
    expect(await as.query(api.categories.list, {})).toEqual([])
    expect(await convexErrorData(as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })))
      .toEqual({ code: 'USER_NOT_FOUND', message: 'User not found — please sign in again' })
  })
})

describe('categories.create', () => {
  it('trims the name, canonicalises the color and returns the id', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const id = await as.mutation(api.categories.create, { name: '  Food  ', color: '#6366f1' })
    expect(validate(createReturns, id, { throw: true })).toBe(true)
    expect(await t.run((ctx) => ctx.db.get('categories', id)))
      .toMatchObject({ userId, name: 'Food', color: '#6366F1' })

    const rows = await as.query(api.categories.list, {})
    expect(validate(listReturns, rows, { throw: true })).toBe(true)
    expect(rows.map((c) => c._id)).toEqual([id])
  })

  it.each([
    ['blank name', '   ', '#6366F1', validation('Category name is required')],
    ['name too long', 'x'.repeat(41), '#6366F1', validation('Category name must be 40 characters or fewer')],
    ['color "red"', 'Food', 'red', BAD_COLOR],
    ['color "#12345"', 'Food', '#12345', BAD_COLOR],
    ['color not in palette', 'Food', '#000000', BAD_COLOR],
  ])('rejects %s', async (_label, name, color, error) => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await convexErrorData(as.mutation(api.categories.create, { name, color }))).toEqual(error)
    expect(await categoryCount(t)).toBe(0)
  })

  it('accepts a 40-character name', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.categories.create, { name: 'x'.repeat(40), color: '#22C55E' })
    expect(await categoryCount(t)).toBe(1)
  })

  it('rejects case-insensitive duplicates for the same user only', async () => {
    const t = makeT()
    const { as: asA } = await signInAndUpsert(t, IDENTITIES.A)
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)
    await asA.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    expect(await convexErrorData(asA.mutation(api.categories.create, { name: ' fOOD ', color: '#EC4899' })))
      .toEqual(DUPLICATE)
    await asB.mutation(api.categories.create, { name: 'food', color: '#EC4899' })
    expect(await categoryCount(t)).toBe(2)
  })
})

describe('categories.update', () => {
  async function seed(t: TestT) {
    const a = await signInAndUpsert(t, IDENTITIES.A)
    const b = await signInAndUpsert(t, IDENTITIES.B)
    const food = await a.as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    const drinks = await a.as.mutation(api.categories.create, { name: 'Drinks', color: '#8B5CF6' })
    return { a, b, food, drinks }
  }

  it('renames and recolors, returning null', async () => {
    const t = makeT()
    const { a, food } = await seed(t)
    expect(await a.as.mutation(api.categories.update, { categoryId: food, name: ' Snacks ', color: '#ef4444' }))
      .toBeNull()
    expect(await t.run((ctx) => ctx.db.get('categories', food))).toMatchObject({ name: 'Snacks', color: '#EF4444' })
  })

  it('allows changing the letter case of its own name', async () => {
    const t = makeT()
    const { a, food } = await seed(t)
    await a.as.mutation(api.categories.update, { categoryId: food, name: 'FOOD', color: '#6366F1' })
    expect((await t.run((ctx) => ctx.db.get('categories', food)))?.name).toBe('FOOD')
  })

  it("rejects renaming to another category's name (case-insensitive)", async () => {
    const t = makeT()
    const { a, food } = await seed(t)
    expect(await convexErrorData(a.as.mutation(api.categories.update, {
      categoryId: food, name: 'drinks', color: '#6366F1',
    }))).toEqual(DUPLICATE)
    expect((await t.run((ctx) => ctx.db.get('categories', food)))?.name).toBe('Food')
  })

  it('validates a changed name / color', async () => {
    const t = makeT()
    const { a, food } = await seed(t)
    expect(await convexErrorData(a.as.mutation(api.categories.update, { categoryId: food, name: ' ', color: '#6366F1' })))
      .toEqual(validation('Category name is required'))
    expect(await convexErrorData(a.as.mutation(api.categories.update, {
      categoryId: food, name: 'y'.repeat(41), color: '#6366F1',
    }))).toEqual(validation('Category name must be 40 characters or fewer'))
    expect(await convexErrorData(a.as.mutation(api.categories.update, { categoryId: food, name: 'Food', color: 'red' })))
      .toEqual(BAD_COLOR)
    expect(await convexErrorData(a.as.mutation(api.categories.update, { categoryId: food, name: 'Food', color: '#12345' })))
      .toEqual(BAD_COLOR)
  })

  it('a legacy duplicate pair / legacy invalid fields can still change the other field', async () => {
    const t = makeT()
    const { a } = await seed(t)
    const longName = 'Z'.repeat(50)
    const [dup1, dup2, legacy] = await t.run(async (ctx) => [
      await ctx.db.insert('categories', { userId: a.userId, name: 'Misc', color: '#6366F1', createdAt: 0 }),
      await ctx.db.insert('categories', { userId: a.userId, name: 'misc', color: '#6366F1', createdAt: 0 }),
      await ctx.db.insert('categories', { userId: a.userId, name: longName, color: 'red', createdAt: 0 }),
    ])

    await a.as.mutation(api.categories.update, { categoryId: dup2, name: 'misc', color: '#22C55E' })
    expect((await t.run((ctx) => ctx.db.get('categories', dup2)))?.color).toBe('#22C55E')
    expect((await t.run((ctx) => ctx.db.get('categories', dup1)))?.color).toBe('#6366F1')

    // Unchanged long name, new valid color → allowed.
    await a.as.mutation(api.categories.update, { categoryId: legacy, name: longName, color: '#06B6D4' })
    // Unchanged invalid color ('red' stays), new valid name → allowed.
    await t.run((ctx) => ctx.db.patch('categories', legacy, { color: 'red' }))
    await a.as.mutation(api.categories.update, { categoryId: legacy, name: 'Old stuff', color: 'red' })
    expect(await t.run((ctx) => ctx.db.get('categories', legacy))).toMatchObject({ name: 'Old stuff', color: 'red' })

    // Legacy rows remain readable through the returns validator.
    const rows = await a.as.query(api.categories.list, {})
    expect(validate(listReturns, rows, { throw: true })).toBe(true)
    expect(rows).toHaveLength(5)
  })

  it("cannot update or remove another user's category", async () => {
    const t = makeT()
    const { b, food } = await seed(t)
    expect(await convexErrorData(b.as.mutation(api.categories.update, { categoryId: food, name: 'Hacked', color: '#6366F1' })))
      .toEqual(NOT_FOUND)
    expect(await convexErrorData(b.as.mutation(api.categories.remove, { categoryId: food })))
      .toEqual(NOT_FOUND)
    expect((await t.run((ctx) => ctx.db.get('categories', food)))?.name).toBe('Food')
    expect(await b.as.query(api.categories.list, {})).toEqual([])
  })
})

describe('categories.remove', () => {
  it('deletes an owned category and returns null', async () => {
    const t = makeT()
    const { as } = await signInAndUpsert(t, IDENTITIES.A)
    const id = await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    expect(await as.mutation(api.categories.remove, { categoryId: id })).toBeNull()
    expect(await t.run((ctx) => ctx.db.get('categories', id))).toBeNull()
    expect(await convexErrorData(as.mutation(api.categories.remove, { categoryId: id }))).toEqual(NOT_FOUND)
    // Name is free again after delete.
    await as.mutation(api.categories.create, { name: 'food', color: '#6366F1' })
  })
})

describe('categories.list view-as', () => {
  it('admins can list another user; non-admins get FORBIDDEN', async () => {
    const t = makeT()
    const { as: asA, userId } = await signInAndUpsert(t, IDENTITIES.A)
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)
    await asA.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    await asB.mutation(api.categories.create, { name: 'Tools', color: '#F97316' })

    const rows = await signIn(t, IDENTITIES.ADMIN).query(api.categories.list, { viewAsUserId: userId })
    expect(validate(listReturns, rows, { throw: true })).toBe(true)
    expect(rows.map((c) => c.name)).toEqual(['Food'])
    expect((await asB.query(api.categories.list, {})).map((c) => c.name)).toEqual(['Tools'])

    expect(await convexErrorData(asB.query(api.categories.list, { viewAsUserId: userId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await convexErrorData(signIn(t, IDENTITIES.NOT_ADMIN_ROLE).query(api.categories.list, { viewAsUserId: userId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })
})
