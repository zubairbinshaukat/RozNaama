import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import type { UserIdentity } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { adminEmailSet, findUserForIdentity, isAdminFromIdentity } from '../../convex/model/users'
import { IDENTITIES, makeIdentity, makeT, signIn, stubAdminEmails, type TestT } from './setup'

const A = IDENTITIES.A
const A_TOKEN = A.tokenIdentifier as string

const ACCOUNT_CONFLICT = {
  code: 'FORBIDDEN',
  message: 'This email is linked to a different account. Please contact support.',
}

/** Same Clerk user (subject `user_a`) issued by a different Clerk instance. */
const NEW_ISSUER = 'https://new-instance.clerk.accounts.dev'
const A_NEW_ISSUER: Partial<UserIdentity> = {
  ...A,
  issuer: NEW_ISSUER,
  tokenIdentifier: `${NEW_ISSUER}|user_a`,
}

/** Re-created Clerk account: same email as A, different subject. */
const A_RECREATED = makeIdentity('user_a2', 'a@example.com', 'Alice Again')

async function convexErrorData(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    return (err as ConvexError<Record<string, string>>).data
  }
  throw new Error('expected promise to reject')
}

function allUsers(t: TestT) {
  return t.run((ctx) => ctx.db.query('users').collect())
}

function seedUser(
  t: TestT,
  row: { name: string; email: string; tokenIdentifier?: string; timeZone?: string },
) {
  return t.run((ctx) => ctx.db.insert('users', { ...row, createdAt: 1 }))
}

function find(t: TestT, who: Partial<UserIdentity>) {
  return t.run((ctx) => findUserForIdentity(ctx, who as UserIdentity))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('findUserForIdentity (read path)', () => {
  it('prefers the tokenIdentifier match over the email match', async () => {
    const t = makeT()
    const byToken = await seedUser(t, { name: 'Linked', email: 'old@example.com', tokenIdentifier: A_TOKEN })
    await seedUser(t, { name: 'Legacy', email: 'a@example.com' })
    expect((await find(t, A))?._id).toBe(byToken)
  })

  it('falls back to the email without writing (no token linked)', async () => {
    const t = makeT()
    const legacy = await seedUser(t, { name: 'Legacy', email: 'a@example.com' })
    const before = await allUsers(t)
    expect((await find(t, A))?._id).toBe(legacy)
    expect(await allUsers(t)).toEqual(before)
    expect(before[0]?.tokenIdentifier).toBeUndefined()
  })

  it('returns null for an identity with no email and no token match', async () => {
    const t = makeT()
    await seedUser(t, { name: 'Legacy', email: 'a@example.com' })
    expect(await find(t, { ...A, email: undefined })).toBeNull()
  })
})

describe('upsertUser identity linking', () => {
  it('inserts new rows with the tokenIdentifier', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, {})
    expect(await t.run((ctx) => ctx.db.get('users', id))).toMatchObject({
      name: 'Alice',
      email: 'a@example.com',
      tokenIdentifier: A_TOKEN,
    })
  })

  it('links the token to an existing email-only row', async () => {
    const t = makeT()
    const legacy = await seedUser(t, { name: 'Alice', email: 'a@example.com' })
    const id = await signIn(t, A).mutation(api.users.upsertUser, { name: 'Alice', email: 'a@example.com' })
    expect(id).toBe(legacy)
    const rows = await allUsers(t)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenIdentifier).toBe(A_TOKEN)
  })

  it('denies a row linked to a different subject without overwriting it (and warns)', async () => {
    const t = makeT()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await seedUser(t, {
      name: 'Original',
      email: 'a@example.com',
      tokenIdentifier: 'https://test.clerk.accounts.dev|user_old',
    })
    const before = await allUsers(t)
    expect(await convexErrorData(
      signIn(t, A).mutation(api.users.upsertUser, { name: 'Alice', timeZone: 'Asia/Dubai' }),
    )).toEqual(ACCOUNT_CONFLICT)
    expect(await allUsers(t)).toEqual(before)
    expect(warn).toHaveBeenCalled()
  })

  it('throws UNAUTHORIZED when there is no email and no token match', async () => {
    const t = makeT()
    const noEmail = makeIdentity('user_new', undefined, 'Nobody')
    expect(await convexErrorData(signIn(t, noEmail).mutation(api.users.upsertUser, { email: 'x@example.com' })))
      .toEqual({ code: 'UNAUTHORIZED', message: 'No email on identity' })
    expect(await allUsers(t)).toHaveLength(0)
  })

  it('accepts a token match even when the identity has no email', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, {})
    const again = await signIn(t, { ...A, email: undefined }).mutation(api.users.upsertUser, {})
    expect(again).toBe(id)
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.email).toBe('a@example.com')
  })

  it('ignores a forged args.email (new user gets the JWT email)', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, { name: 'A', email: 'victim@example.com' })
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.email).toBe('a@example.com')
    expect(await allUsers(t)).toHaveLength(1)
  })

  it('updates the email when the Clerk email changes (token match)', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, {})
    const again = await signIn(t, { ...A, email: 'alice.new@example.com' }).mutation(api.users.upsertUser, {})
    expect(again).toBe(id)
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.email).toBe('alice.new@example.com')
    expect(await allUsers(t)).toHaveLength(1)
  })

  it('keeps the old email when the new one already belongs to another row (and warns)', async () => {
    const t = makeT()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const id = await signIn(t, A).mutation(api.users.upsertUser, {})
    const bId = await signIn(t, IDENTITIES.B).mutation(api.users.upsertUser, {})
    const again = await signIn(t, { ...A, email: 'b@example.com' }).mutation(api.users.upsertUser, {})
    expect(again).toBe(id)
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.email).toBe('a@example.com')
    expect((await t.run((ctx) => ctx.db.get('users', bId)))?.email).toBe('b@example.com')
    expect(warn).toHaveBeenCalled()
  })

  it('does not write when nothing changed', async () => {
    const t = makeT()
    await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })
    const before = await allUsers(t)
    await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })
    expect(await allUsers(t)).toEqual(before)
  })
})

describe('email row linked to another tokenIdentifier (H2)', () => {
  const COLOR = '#6366F1'

  async function seedLinkedA(t: TestT) {
    const id = await seedUser(t, { name: 'Alice', email: 'a@example.com', tokenIdentifier: A_TOKEN })
    await t.run((ctx) => ctx.db.insert('categories', { userId: id, name: 'Food', color: COLOR, createdAt: 1 }))
    return id
  }

  it('same subject + different issuer: query path returns the user without writing', async () => {
    const t = makeT()
    const id = await seedLinkedA(t)
    const before = await allUsers(t)
    expect((await find(t, A_NEW_ISSUER))?._id).toBe(id)
    const cats = await signIn(t, A_NEW_ISSUER).query(api.categories.list, {})
    expect(cats.map((c) => c.name)).toEqual(['Food'])
    expect(await allUsers(t)).toEqual(before)
  })

  it('same subject + different issuer: mutations are allowed, upsertUser relinks the token', async () => {
    const t = makeT()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const id = await seedLinkedA(t)
    const as = signIn(t, A_NEW_ISSUER)
    await as.mutation(api.categories.create, { name: 'Drinks', color: COLOR })
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.tokenIdentifier).toBe(A_TOKEN)

    expect(await as.mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })).toBe(id)
    const rows = await allUsers(t)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ _id: id, tokenIdentifier: `${NEW_ISSUER}|user_a`, timeZone: 'Asia/Karachi' })
    // Now found by token.
    expect((await find(t, A_NEW_ISSUER))?._id).toBe(id)
  })

  it('different subject: queries see no user (empty data) and never write', async () => {
    const t = makeT()
    await seedLinkedA(t)
    const before = await allUsers(t)
    expect(await find(t, A_RECREATED)).toBeNull()
    expect(await signIn(t, A_RECREATED).query(api.categories.list, {})).toEqual([])
    expect(await allUsers(t)).toEqual(before)
  })

  it('different subject: mutations and upsertUser throw FORBIDDEN with the support message', async () => {
    const t = makeT()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await seedLinkedA(t)
    const before = await allUsers(t)
    const as = signIn(t, A_RECREATED)
    expect(await convexErrorData(as.mutation(api.categories.create, { name: 'X', color: COLOR })))
      .toEqual(ACCOUNT_CONFLICT)
    expect(await convexErrorData(as.mutation(api.users.upsertUser, {}))).toEqual(ACCOUNT_CONFLICT)
    expect(await allUsers(t)).toEqual(before)
    expect(await t.run((ctx) => ctx.db.query('categories').collect())).toHaveLength(1)
  })

  it('a subject that is only a suffix of the stored subject does not match', async () => {
    const t = makeT()
    await seedUser(t, { name: 'Alice', email: 'a@example.com', tokenIdentifier: `${NEW_ISSUER}|xuser_a` })
    expect(await find(t, A)).toBeNull()
  })

  it('legacy row without a token: query reads by email, upsertUser links it', async () => {
    const t = makeT()
    const legacy = await seedUser(t, { name: 'Alice', email: 'a@example.com' })
    expect((await find(t, A_RECREATED))?._id).toBe(legacy)
    expect(await signIn(t, A_RECREATED).mutation(api.users.upsertUser, {})).toBe(legacy)
    expect((await t.run((ctx) => ctx.db.get('users', legacy)))?.tokenIdentifier)
      .toBe(A_RECREATED.tokenIdentifier)
  })
})

describe('upsertUser timeZone', () => {
  it('stores a valid zone on insert and updates it later', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.timeZone).toBe('Asia/Karachi')
    await signIn(t, A).mutation(api.users.upsertUser, { timeZone: ' America/New_York ' })
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.timeZone).toBe('America/New_York')
  })

  it('ignores invalid, blank or omitted zones', async () => {
    const t = makeT()
    const id = await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Mars/Olympus' })
    expect((await t.run((ctx) => ctx.db.get('users', id)))?.timeZone).toBeUndefined()

    await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })
    for (const timeZone of ['Not/AZone', '   ', undefined]) {
      await signIn(t, A).mutation(api.users.upsertUser, timeZone === undefined ? {} : { timeZone })
      expect((await t.run((ctx) => ctx.db.get('users', id)))?.timeZone).toBe('Asia/Karachi')
    }
  })

  it('stores the zone while linking a legacy row', async () => {
    const t = makeT()
    const legacy = await seedUser(t, { name: 'Alice', email: 'a@example.com' })
    await signIn(t, A).mutation(api.users.upsertUser, { timeZone: 'Asia/Karachi' })
    expect(await t.run((ctx) => ctx.db.get('users', legacy))).toMatchObject({
      tokenIdentifier: A_TOKEN,
      timeZone: 'Asia/Karachi',
    })
  })
})

describe('isAdminFromIdentity (ADMIN_EMAILS)', () => {
  const asIdentity = (who: Partial<UserIdentity>) => who as UserIdentity

  it('parses a comma-separated, trimmed, case-insensitive list', () => {
    stubAdminEmails(' One@Example.com,,two@example.com , ')
    expect([...adminEmailSet()].sort()).toEqual(['one@example.com', 'two@example.com'])
  })

  it('nobody is admin when ADMIN_EMAILS is unset or blank', () => {
    expect(adminEmailSet().size).toBe(0)
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.ADMIN))).toBe(false)
    stubAdminEmails('   ')
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.ADMIN))).toBe(false)
  })

  it('needs a listed email that is not marked unverified', () => {
    stubAdminEmails()
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.ADMIN))).toBe(true)
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.ADMIN_TWO))).toBe(true)
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.ADMIN_UNVERIFIED))).toBe(false)
    expect(isAdminFromIdentity(asIdentity({ ...IDENTITIES.ADMIN, email: undefined }))).toBe(false)
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.A))).toBe(false)
  })

  it('ignores Clerk role / public_metadata claims', () => {
    stubAdminEmails()
    expect(isAdminFromIdentity(asIdentity(IDENTITIES.CLERK_ROLE_ADMIN))).toBe(false)
  })

  it('does not match a substring or a look-alike email', () => {
    stubAdminEmails('admin@example.com')
    for (const email of ['xadmin@example.com', 'admin@example.co', 'admin@example.com.evil', 'admin@example.com,']) {
      expect(isAdminFromIdentity(asIdentity({ ...IDENTITIES.ADMIN, email }))).toBe(false)
    }
  })
})