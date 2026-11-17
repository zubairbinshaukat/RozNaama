import { describe, expect, it } from 'vitest'
import { api } from '../../convex/_generated/api'
import { IDENTITIES, makeT, signIn, signInAndUpsert } from './setup'

describe('users.validateViewAsTarget', () => {
  it('returns { _id, name } for an admin and an existing user', async () => {
    const t = makeT()
    const { userId } = await signInAndUpsert(t, IDENTITIES.A)
    for (const admin of [IDENTITIES.ADMIN, IDENTITIES.ADMIN_CAMEL, IDENTITIES.ADMIN_NAMESPACED]) {
      expect(await signIn(t, admin).query(api.users.validateViewAsTarget, { userId }))
        .toEqual({ _id: userId, name: 'Alice' })
    }
  })

  it('returns null for non-admins (including a self lookup)', async () => {
    const t = makeT()
    const { as, userId } = await signInAndUpsert(t, IDENTITIES.A)
    expect(await as.query(api.users.validateViewAsTarget, { userId })).toBeNull()
    expect(await signIn(t, IDENTITIES.NOT_ADMIN_ROLE).query(api.users.validateViewAsTarget, { userId })).toBeNull()
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
