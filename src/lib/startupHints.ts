/**
 * Build-time helpers for the `<head>` resource hints injected by the
 * `rn-html-hints` plugin in vite.config.ts. Pure (no DOM, no Node APIs besides
 * `atob`/`URL`), so the same code is unit-tested and imported by the config.
 */

/**
 * Exact clerk-js version loaded from Clerk's CDN.
 *
 * Without a pin Clerk loads `clerk-js@5` (a moving tag), so the service-worker
 * cache key and the `<link rel="preload">` would drift. This is the version
 * `@clerk/shared` (pulled in by the installed `@clerk/clerk-react`) defaults to
 * — see `packageVersion` in node_modules/@clerk/shared/dist/runtime/versionSelector*.mjs.
 *
 * To bump: upgrade `@clerk/clerk-react`, then copy the new default from that
 * file here. `startupHints.test.ts` fails until the two match.
 */
export const CLERK_JS_VERSION = '5.125.3'

/**
 * Clerk Frontend API host encoded in a publishable key:
 * `pk_test_<base64("my-app.clerk.accounts.dev$")>` → `my-app.clerk.accounts.dev`.
 * Returns null for anything that does not decode to a plausible host.
 */
export function decodeClerkFrontendApi(publishableKey: string | undefined | null): string | null {
  if (!publishableKey) return null
  const match = /^pk_(?:test|live)_(.+)$/.exec(publishableKey.trim())
  if (!match) return null
  let decoded: string
  try {
    // base64url keys are possible; normalise to standard base64 + padding.
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
    decoded = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  } catch {
    return null
  }
  const host = decoded.replace(/\$+$/, '')
  // Hostname characters only (no scheme, path, spaces or control chars).
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host) || !host.includes('.')) return null
  return host.toLowerCase()
}

/** `https://<host>` origin of an http(s)/ws(s) URL, or null. */
export function httpsOrigin(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(parsed.protocol)) return null
    const scheme = parsed.protocol === 'http:' || parsed.protocol === 'ws:' ? 'http:' : 'https:'
    return `${scheme}//${parsed.host}`
  } catch {
    return null
  }
}

/** The exact URL Clerk loads clerk-js from (must match for the preload to be reused). */
export function clerkJsScriptUrl(frontendApiHost: string, version: string = CLERK_JS_VERSION): string {
  return `https://${frontendApiHost}/npm/@clerk/clerk-js@${version}/dist/clerk.browser.js`
}

/** Structurally compatible with Vite's `HtmlTagDescriptor`. */
export interface HeadTag {
  tag: 'link'
  attrs: Record<string, string | boolean>
  injectTo: 'head'
}

export interface StartupHintInput {
  clerkPublishableKey?: string
  convexUrl?: string
  /** Built URL of the Inter latin woff2 (absent in dev). */
  fontHref?: string | null
}

/**
 * Tags for the critical path, in priority order:
 * font preload, clerk-js preload, then preconnect / dns-prefetch to Clerk and Convex.
 *
 * Clerk gets two preconnects: clerk-js is fetched with `crossorigin="anonymous"`
 * (anonymous connection pool) while its API calls are credentialed.
 */
export function buildStartupHintTags({ clerkPublishableKey, convexUrl, fontHref }: StartupHintInput): HeadTag[] {
  const tags: HeadTag[] = []
  const link = (attrs: HeadTag['attrs']): HeadTag => ({ tag: 'link', attrs, injectTo: 'head' })

  if (fontHref) {
    tags.push(link({ rel: 'preload', href: fontHref, as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }))
  }

  const clerkHost = decodeClerkFrontendApi(clerkPublishableKey)
  if (clerkHost) {
    const origin = `https://${clerkHost}`
    tags.push(link({ rel: 'preconnect', href: origin, crossorigin: 'anonymous' }))
    tags.push(link({ rel: 'preconnect', href: origin }))
    tags.push(link({ rel: 'dns-prefetch', href: origin }))
    tags.push(link({ rel: 'preload', href: clerkJsScriptUrl(clerkHost), as: 'script', crossorigin: 'anonymous' }))
  }

  const convexOrigin = httpsOrigin(convexUrl)
  if (convexOrigin) {
    tags.push(link({ rel: 'preconnect', href: convexOrigin }))
    tags.push(link({ rel: 'dns-prefetch', href: convexOrigin }))
  }

  return tags
}
