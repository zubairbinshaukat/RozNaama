import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import { IDENTITIES, makeT, signIn, signInAndUpsert, stubAdminEmails } from './setup'

beforeEach(() => stubAdminEmails())
afterEach(() => vi.unstubAllEnvs())

describe('users.validateViewAsTarget', () => {
  it('returns { _id, name } for an admin and an existing user', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    for (const admin of [IDENTITIES.ADMIN, IDENTITIES.ADMIN_TWO]) {
      expect(await signIn(t, admin).query(api.users.validateViewAsTarget, { userId }))
        .toEqual({ _id: userId, name: 'Alice' })
    }
  })

  it('returns null for non-admins (including a self lookup)', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await as.query(api.users.validateViewAsTarget, { userId })).toBeNull()
    expect(await signIn(t, IDENTITIES.NOT_ADMIN_ROLE).query(api.users.validateViewAsTarget, { userId })).toBeNull()
    expect(await signIn(t, IDENTITIES.CLERK_ROLE_ADMIN).query(api.users.validateViewAsTarget, { userId })).toBeNull()
    expect(await signIn(t, IDENTITIES.ADMIN_UNVERIFIED).query(api.users.validateViewAsTarget, { userId })).toBeNull()
  })

  it('returns null for malformed ids and ids from another table', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    const categoryId = await t.run((ctx) =>
      ctx.db.insert('categories', { userId, name: 'Food', color: '#6366F1', createdAt: 0 }),
    )
    const admin = signIn(t, IDENTITIES.ADMIN)
    for (const bad of ['', 'not-an-id', `${userId}x`, categoryId]) {
      expect(await admin.query(api.users.validateViewAsTarget, { userId: bad })).toBeNull()
    }
  })

  it('returns null for a deleted user', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    await t.run((ctx) => ctx.db.delete('users', userId))
    expect(await signIn(t, IDENTITIES.ADMIN).query(api.users.validateViewAsTarget, { userId })).toBeNull()
  })

  it('returns null (never throws) when signed out', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await t.query(api.users.validateViewAsTarget, { userId })).toBeNull()
    expect(await t.query(api.users.validateViewAsTarget, { userId: 'garbage' })).toBeNull()
  })
})

describe('view-as data reads use ADMIN_EMAILS', () => {
  async function errorData(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError)
      return (err as ConvexError<Record<string, string>>).data
    }
    throw new Error('expected promise to reject')
  }

  it('listed admins read another user; Clerk-role, unverified and unlisted callers get FORBIDDEN', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    await as.mutation(api.categories.create, { name: 'Food', color: '#6366F1' })

    const viaAdmin = await signIn(t, IDENTITIES.ADMIN_TWO).query(api.categories.list, { viewAsUserId: userId })
    expect(viaAdmin.map((c) => c.name)).toEqual(['Food'])

    for (const who of [IDENTITIES.CLERK_ROLE_ADMIN, IDENTITIES.ADMIN_UNVERIFIED, IDENTITIES.B]) {
      expect(await errorData(signIn(t, who).query(api.categories.list, { viewAsUserId: userId })))
        .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    }

    vi.unstubAllEnvs()
    expect(await errorData(signIn(t, IDENTITIES.ADMIN).query(api.categories.list, { viewAsUserId: userId })))
      .toEqual({ code: 'FORBIDDEN', message: 'Forbidden' })
    expect(await signIn(t, IDENTITIES.ADMIN).query(api.users.validateViewAsTarget, { userId })).toBeNull()
  })
})