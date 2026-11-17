import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineTestApp } from 'convex-test'
import { ConvexError, v } from 'convex/values'
import schema from '../../convex/schema'
import { adminQuery, authedMutation, authedQuery } from '../../convex/lib/functions'
import { assertOwnedCategory, getOwned } from '../../convex/lib/ownership'
import { IDENTITIES, stubAdminEmails } from './setup'

beforeEach(() => stubAdminEmails())
afterEach(() => vi.unstubAllEnvs())

const app = defineTestApp({ schema })
const { api, createTest } = app.defineModules({
  probe: {
    whoAmI: authedQuery({
      args: {},
      handler: async (ctx) => ctx.user?.email ?? null,
    }),
    touch: authedMutation({
      args: {},
      handler: async (ctx) => ctx.user._id,
    }),
    adminPing: adminQuery({
      args: {},
      handler: async (ctx) => ctx.identity.email ?? null,
    }),
    upsert: app.mutation({
      args: { email: v.string() },
      handler: async (ctx, args) =>
        ctx.db.insert('users', { name: args.email, email: args.email, createdAt: 0 }),
    }),
  },
})

async function errorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

describe('lib/functions wrappers', () => {
  it('authedQuery: unauth throws, missing row → null user, view-as needs admin', async () => {
    const t = createTest()
    expect(await errorData(t.query(api.probe.whoAmI, {}))).toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })

    const asA = t.withIdentity(IDENTITIES.A)
    expect(await asA.query(api.probe.whoAmI, {})).toBeNull()

    const aId = await t.mutation(api.probe.upsert, { email: 'a@example.com' })
    expect(await asA.query(api.probe.whoAmI, {})).toBe('a@example.com')

    expect(await errorData(t.withIdentity(IDENTITIES.B).query(api.probe.whoAmI, { viewAsUserId: aId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await t.withIdentity(IDENTITIES.ADMIN).query(api.probe.whoAmI, { viewAsUserId: aId }))
      .toBe('a@example.com')
  })

  it('authedQuery: token match wins; email fallback never links the token', async () => {
    const t = createTest()
    const legacyId = await t.mutation(api.probe.upsert, { email: 'a@example.com' })
    const asA = t.withIdentity(IDENTITIES.A)
    expect(await asA.query(api.probe.whoAmI, {})).toBe('a@example.com')
    expect((await t.run((ctx) => ctx.db.get('users', legacyId)))?.tokenIdentifier).toBeUndefined()

    await t.run((ctx) =>
      ctx.db.insert('users', {
        name: 'Linked',
        email: 'linked@example.com',
        tokenIdentifier: IDENTITIES.A.tokenIdentifier,
        createdAt: 0,
      }),
    )
    expect(await asA.query(api.probe.whoAmI, {})).toBe('linked@example.com')
  })

  it('authedQuery: identity without email and no token match → null user', async () => {
    const t = createTest()
    await t.mutation(api.probe.upsert, { email: 'a@example.com' })
    expect(await t.withIdentity({ ...IDENTITIES.A, email: undefined }).query(api.probe.whoAmI, {})).toBeNull()
  })

  it('authedMutation: resolves by token when the email changed', async () => {
    const t = createTest()
    const linked = await t.run((ctx) =>
      ctx.db.insert('users', {
        name: 'Linked',
        email: 'old@example.com',
        tokenIdentifier: IDENTITIES.A.tokenIdentifier,
        createdAt: 0,
      }),
    )
    expect(await t.withIdentity(IDENTITIES.A).mutation(api.probe.touch, {})).toBe(linked)
  })

  it('authedMutation: requires an existing user row', async () => {
    const t = createTest()
    const asA = t.withIdentity(IDENTITIES.A)
    expect(await errorData(asA.mutation(api.probe.touch, {}))).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User not found — please sign in again',
    })
    const aId = await t.mutation(api.probe.upsert, { email: 'a@example.com' })
    expect(await asA.mutation(api.probe.touch, {})).toBe(aId)
  })

  it('adminQuery: only verified emails listed in ADMIN_EMAILS', async () => {
    const t = createTest()
    expect(await errorData(t.query(api.probe.adminPing, {})))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
    for (const who of [IDENTITIES.A, IDENTITIES.CLERK_ROLE_ADMIN, IDENTITIES.ADMIN_UNVERIFIED]) {
      expect(await errorData(t.withIdentity(who).query(api.probe.adminPing, {})))
        .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    }
    expect(await t.withIdentity(IDENTITIES.ADMIN).query(api.probe.adminPing, {})).toBe('admin@example.com')
    expect(await t.withIdentity(IDENTITIES.ADMIN_TWO).query(api.probe.adminPing, {})).toBe('Admin2@Example.COM')

    vi.unstubAllEnvs()
    expect(await errorData(t.withIdentity(IDENTITIES.ADMIN).query(api.probe.adminPing, {})))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })
})

describe('lib/ownership', () => {
  it('getOwned / assertOwnedCategory enforce the owner', async () => {
    const t = createTest()
    const aId = await t.mutation(api.probe.upsert, { email: 'a@example.com' })
    const bId = await t.mutation(api.probe.upsert, { email: 'b@example.com' })
    const catId = await t.run((ctx) =>
      ctx.db.insert('categories', { userId: aId, name: 'Food', color: '#6366F1', createdAt: 0 }),
    )

    await t.run(async (ctx) => {
      expect((await getOwned(ctx, 'categories', catId, aId))?.name).toBe('Food')
      expect(await getOwned(ctx, 'categories', catId, bId)).toBeNull()
      expect((await assertOwnedCategory(ctx, catId, aId))._id).toBe(catId)
      await expect(assertOwnedCategory(ctx, catId, bId)).rejects.toMatchObject({
        data: { code: 'NOT_FOUND', message: 'Category not found' },
      })
    })
  })
})
