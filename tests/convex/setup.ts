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

/**
 * Value of the ADMIN_EMAILS env var used by `stubAdminEmails()`: messy on
 * purpose (spaces, mixed case, empty entries) to exercise the parser.
 */
export const TEST_ADMIN_EMAILS = ' Admin@Example.com ,, ADMIN2@example.com '

/**
 * Admin = verified JWT email listed in ADMIN_EMAILS. Call in `beforeEach`
 * (undo with `vi.unstubAllEnvs()` in afterEach) wherever ADMIN must be admin.
 */
export function stubAdminEmails(value: string = TEST_ADMIN_EMAILS): void {
  vi.stubEnv('ADMIN_EMAILS', value)
}

/**
 * Test identities. ADMIN / ADMIN_TWO are admins once `stubAdminEmails()` ran;
 * the others never are (Clerk roles are ignored).
 */
export const IDENTITIES = {
  A: identity('user_a', 'a@example.com', 'Alice'),
  B: identity('user_b', 'b@example.com', 'Bilal'),
  ADMIN: identity('user_admin', 'admin@example.com', 'Admin', { emailVerified: true }),
  /** Listed admin email, but in different case; no emailVerified claim at all. */
  ADMIN_TWO: identity('user_admin2', 'Admin2@Example.COM', 'Admin Two'),
  /** Listed admin email whose verification claim is false → never admin. */
  ADMIN_UNVERIFIED: identity('user_admin3', 'admin@example.com', 'Admin Unverified', { emailVerified: false }),
  /** Old Clerk-role admin: no longer grants anything. */
  CLERK_ROLE_ADMIN: identity('user_admin4', 'role-admin@example.com', 'Role Admin', {
    public_metadata: { role: 'Admin' },
    publicMetadata: { role: 'Admin' },
    role: 'Admin',
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
