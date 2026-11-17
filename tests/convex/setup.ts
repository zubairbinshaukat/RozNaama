/// <reference types="vite/client" />
/**
 * Shared convex-test harness. Tests live outside `convex/` so vitest is never
 * bundled on deploy.
 */
import { convexTest } from 'convex-test'
import { vi } from 'vitest'
import type { UserIdentity } from 'convex/server'
import migrationsComponent from '@convex-dev/migrations/test'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

// Vite 8's glob does not support the `!(*.*.*)` extglob from the convex-test
// docs; the negative pattern excludes `*.d.ts`, `auth.config.ts`, `convex.config.ts`.
export const modules = import.meta.glob(['../../convex/**/*.*s', '!../../convex/**/*.*.*s'])

/** Fresh in-memory backend with the migrations component registered. */
export function makeT() {
  const t = convexTest(schema, modules)
  migrationsComponent.register(t)
  return t
}

export type TestT = ReturnType<typeof makeT>

type TestIdentity = Partial<UserIdentity>

const ISSUER = 'https://test.clerk.accounts.dev'

/** Build a Clerk-like identity (`tokenIdentifier` = `${issuer}|${subject}`). */
export function makeIdentity(
  subject: string,
  email: string | undefined,
  name: string | undefined,
  extra: Record<string, unknown> = {},
): TestIdentity {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name,
    ...extra,
  } as TestIdentity
}

function identity(subject: string, email: string, name: string, extra: Record<string, unknown> = {}): TestIdentity {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name,
    ...extra,
  } as TestIdentity
}

/** Test identities. ADMIN uses `public_metadata.role`; variants cover other claim shapes. */
export const IDENTITIES = {
  A: identity('user_a', 'a@example.com', 'Alice'),
  B: identity('user_b', 'b@example.com', 'Bilal'),
  ADMIN: identity('user_admin', 'admin@example.com', 'Admin', {
    public_metadata: { role: 'Admin' },
  }),
  ADMIN_CAMEL: identity('user_admin2', 'admin2@example.com', 'Admin Two', {
    publicMetadata: { role: 'Admin' },
  }),
  ADMIN_TOP_LEVEL: identity('user_admin3', 'admin3@example.com', 'Admin Three', {
    role: 'Admin',
  }),
  ADMIN_NAMESPACED: identity('user_admin4', 'admin4@example.com', 'Admin Four', {
    'https://x/public_metadata': { role: 'Admin' },
  }),
  NOT_ADMIN_ROLE: identity('user_c', 'c@example.com', 'Chaudhry', {
    public_metadata: { role: 'Member' },
  }),
} satisfies Record<string, TestIdentity>

/** Act as `who` for subsequent calls. */
export function signIn(t: TestT, who: TestIdentity) {
  return t.withIdentity(who)
}

/** Sign in and upsert the user row; returns the accessor and the user id. */
export async function signInAndUpsert(
  t: TestT,
  who: TestIdentity,
): Promise<{ as: ReturnType<typeof signIn>; userId: Id<'users'> }> {
  const as = signIn(t, who)
  const userId = await as.mutation(api.users.upsertUser, {})
  return { as, userId }
}

/**
 * Freeze `Date.now()` (and only Date, so convex-test's internal timers keep
 * working). Call `vi.useRealTimers()` in afterEach.
 */
export function freezeNow(iso: string | number): number {
  vi.useFakeTimers({ toFake: ['Date'] })
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  vi.setSystemTime(ms)
  return ms
}
