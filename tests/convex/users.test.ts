import { describe, expect, it } from 'vitest'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import { IDENTITIES, makeT, signIn, signInAndUpsert } from './setup'

async function convexErrorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

describe('users.upsertUser', () => {
  it('rejects unauthenticated calls', async () => {
    const t = makeT()
    expect(await convexErrorData(t.mutation(api.users.upsertUser, { name: 'X', email: 'x@example.com' })))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
    expect(await t.run((ctx) => ctx.db.query('users').collect())).toHaveLength(0)
  })

  it('ignores a spoofed args.email and uses the JWT email', async () => {
    const t = makeT()
    const { userId: victimId } = await signInAndUpsert(t, IDENTITIES.B)

    const attacker = signIn(t, IDENTITIES.A)
    const attackerId = await attacker.mutation(api.users.upsertUser, {
      name: 'Hacker',
      email: IDENTITIES.B.email,
    })

    expect(attackerId).not.toBe(victimId)
    const victim = await t.run((ctx) => ctx.db.get('users', victimId))
    expect(victim?.name).toBe('Bilal')
    const attackerRow = await t.run((ctx) => ctx.db.get('users', attackerId))
    expect(attackerRow?.email).toBe(IDENTITIES.A.email)
  })

  it('is idempotent and returns the same id', async () => {
    const t = makeT()
    const as = signIn(t, IDENTITIES.A)
    const first = await as.mutation(api.users.upsertUser, { name: 'Alice', email: 'a@example.com' })
    const second = await as.mutation(api.users.upsertUser, { name: 'Alice', email: 'a@example.com' })
    expect(second).toBe(first)
    expect(await t.run((ctx) => ctx.db.query('users').collect())).toHaveLength(1)
  })

  it('prefers identity.name over args.name, falls back to args.name, then "User"', async () => {
    const t = makeT()
    const id1 = await signIn(t, IDENTITIES.A).mutation(api.users.upsertUser, { name: 'Client Name' })
    expect((await t.run((ctx) => ctx.db.get('users', id1)))?.name).toBe('Alice')

    const noName = { ...IDENTITIES.B, name: undefined }
    const id2 = await signIn(t, noName).mutation(api.users.upsertUser, { name: '  Bilal K  ' })
    expect((await t.run((ctx) => ctx.db.get('users', id2)))?.name).toBe('Bilal K')

    const noNameAtAll = { ...IDENTITIES.NOT_ADMIN_ROLE, name: undefined }
    const id3 = await signIn(t, noNameAtAll).mutation(api.users.upsertUser, {})
    expect((await t.run((ctx) => ctx.db.get('users', id3)))?.name).toBe('User')
  })

  it('caps the stored name at 100 characters', async () => {
    const t = makeT()
    const id = await signIn(t, { ...IDENTITIES.A, name: 'n'.repeat(150) }).mutation(api.users.upsertUser, {})
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.name).toHaveLength(100)
  })

  it('updates the name when the identity name changes', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await signIn(t, { ...IDENTITIES.A, name: 'Alice Khan' }).mutation(api.users.upsertUser, {})
    expect((await t.run((ctx) => ctx.db.get('users', userId)))?.name).toBe('Alice Khan')
  })

  it('throws when the identity has no email', async () => {
    const t = makeT()
    const noEmail = { ...IDENTITIES.A, email: undefined }
    expect(await convexErrorData(signIn(t, noEmail).mutation(api.users.upsertUser, { email: 'a@example.com' })))
      .toEqual({ code: 'UNAUTHORIZED', message: 'No email on identity' })
  })

  it('stores the row shape { name, email, createdAt }', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const row = await t.run((ctx) => ctx.db.get('users', userId))
    expect(row).toMatchObject({ name: 'Alice', email: 'a@example.com' })
    expect(typeof row?.createdAt).toBe('number')
  })
})

describe('users.listForAdmin', () => {
  it('rejects unauthenticated and non-admin callers', async () => {
    const t = makeT()
    expect(await convexErrorData(t.query(api.users.listForAdmin, {})))
      .toEqual({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
    expect(await convexErrorData(signIn(t, IDENTITIES.A).query(api.users.listForAdmin, {})))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await convexErrorData(signIn(t, IDENTITIES.NOT_ADMIN_ROLE).query(api.users.listForAdmin, {})))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
  })

  it.each([
    ['public_metadata.role', IDENTITIES.ADMIN],
    ['publicMetadata.role', IDENTITIES.ADMIN_CAMEL],
    ['top-level role', IDENTITIES.ADMIN_TOP_LEVEL],
    ['namespaced /public_metadata', IDENTITIES.ADMIN_NAMESPACED],
  ])('allows admins via %s and returns sorted {_id, name, email} rows', async (_label, admin) => {
    const t = makeT()
    const { userId: bId } = await signInAndUpsert(t, IDENTITIES.B)
    const { userId: aId } = await signInAndUpsert(t, IDENTITIES.A)

    const rows = await signIn(t, admin).query(api.users.listForAdmin, {})
    expect(rows).toEqual([
      { _id: aId, name: 'Alice', email: 'a@example.com' },
      { _id: bId, name: 'Bilal', email: 'b@example.com' },
    ])
  })
})

describe('view-as resolution (model/users resolveDataUser)', () => {
  it('admins can read another user; non-admins get FORBIDDEN; unknown target USER_NOT_FOUND', async () => {
    const t = makeT()
    const { as: asA, userId: aId } = await signInAndUpsert(t, IDENTITIES.A)
    await asA.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })
    const { as: asB } = await signInAndUpsert(t, IDENTITIES.B)

    const adminView = await signIn(t, IDENTITIES.ADMIN).query(api.categories.list, { viewAsUserId: aId })
    expect(adminView.map((c) => c.name)).toEqual(['Food'])

    expect(await convexErrorData(asB.query(api.categories.list, { viewAsUserId: aId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })

    await t.run((ctx) => ctx.db.delete('users', aId))
    expect(await convexErrorData(signIn(t, IDENTITIES.ADMIN).query(api.categories.list, { viewAsUserId: aId })))
      .toEqual({ code: 'USER_NOT_FOUND', message: 'User not found' })
  })

  it('a signed-in user without a row sees empty data, not an error', async () => {
    const t = makeT()
    expect(await signIn(t, IDENTITIES.A).query(api.categories.list, {})).toEqual([])
  })
})
