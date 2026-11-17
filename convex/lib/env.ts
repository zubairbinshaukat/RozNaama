/**
 * Read a Convex deployment environment variable without depending on Node
 * typings (this module is also type-checked by the frontend tsconfig via
 * `_generated/api.d.ts`). Works in the Convex runtime and in convex-test.
 */
export function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]
}
