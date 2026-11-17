import { describe, expect, it } from 'vitest'
import {
  CLERK_JS_VERSION,
  buildStartupHintTags,
  clerkJsScriptUrl,
  decodeClerkFrontendApi,
  httpsOrigin,
} from './startupHints'

const HOST = 'top-airedale-17.clerk.accounts.dev'
const pk = (prefix: string, payload: string) => `${prefix}${btoa(payload)}`

describe('decodeClerkFrontendApi', () => {
  it('decodes test and live keys and strips the trailing $', () => {
    expect(decodeClerkFrontendApi(pk('pk_test_', `${HOST}$`))).toBe(HOST)
    expect(decodeClerkFrontendApi(pk('pk_live_', 'clerk.example.com$'))).toBe('clerk.example.com')
  })

  it('accepts a key without the $ suffix and missing base64 padding', () => {
    const unpadded = pk('pk_test_', 'clerk.shop.pk').replace(/=+$/, '')
    expect(decodeClerkFrontendApi(unpadded)).toBe('clerk.shop.pk')
  })

  it('rejects missing, malformed or non-host payloads', () => {
    expect(decodeClerkFrontendApi(undefined)).toBeNull()
    expect(decodeClerkFrontendApi('')).toBeNull()
    expect(decodeClerkFrontendApi('sk_test_abc')).toBeNull()
    expect(decodeClerkFrontendApi('pk_test_%%%')).toBeNull()
    expect(decodeClerkFrontendApi(pk('pk_test_', 'not a host$'))).toBeNull()
    expect(decodeClerkFrontendApi(pk('pk_test_', 'https://evil.com/x$'))).toBeNull()
    expect(decodeClerkFrontendApi(pk('pk_test_', 'localhost$'))).toBeNull()
  })
})

describe('httpsOrigin', () => {
  it('returns the https origin of Convex URLs', () => {
    expect(httpsOrigin('https://ideal-kookabura-797.convex.cloud')).toBe('https://ideal-kookabura-797.convex.cloud')
    expect(httpsOrigin('wss://ideal-kookabura-797.convex.cloud/api/sync')).toBe('https://ideal-kookabura-797.convex.cloud')
    expect(httpsOrigin('http://127.0.0.1:3210')).toBe('http://127.0.0.1:3210')
  })

  it('rejects garbage', () => {
    expect(httpsOrigin(undefined)).toBeNull()
    expect(httpsOrigin('not a url')).toBeNull()
    expect(httpsOrigin('javascript:alert(1)')).toBeNull()
  })
})

describe('buildStartupHintTags', () => {
  it('emits font preload, Clerk preconnects + clerk-js preload, Convex preconnect', () => {
    const tags = buildStartupHintTags({
      clerkPublishableKey: pk('pk_test_', `${HOST}$`),
      convexUrl: 'https://ideal-kookabura-797.convex.cloud',
      fontHref: '/assets/inter-latin-wght-normal-abc.woff2',
    })
    const summary = tags.map((t) => `${String(t.attrs.rel)} ${String(t.attrs.href)}${t.attrs.crossorigin ? ' cors' : ''}`)
    expect(summary).toEqual([
      'preload /assets/inter-latin-wght-normal-abc.woff2 cors',
      `preconnect https://${HOST} cors`,
      `preconnect https://${HOST}`,
      `dns-prefetch https://${HOST}`,
      `preload ${clerkJsScriptUrl(HOST)} cors`,
      'preconnect https://ideal-kookabura-797.convex.cloud',
      'dns-prefetch https://ideal-kookabura-797.convex.cloud',
    ])
    expect(tags.every((t) => t.tag === 'link' && t.injectTo === 'head')).toBe(true)
  })

  it('emits nothing without env / font', () => {
    expect(buildStartupHintTags({})).toEqual([])
  })

  it('clerk-js URL uses the pinned exact version', () => {
    expect(clerkJsScriptUrl(HOST)).toBe(
      `https://${HOST}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`,
    )
  })
})

describe('CLERK_JS_VERSION pin', () => {
  it('matches the clerk-js version the installed @clerk/shared defaults to', () => {
    const sources = import.meta.glob<string>(
      '../../node_modules/@clerk/shared/dist/runtime/versionSelector-*.mjs',
      { query: '?raw', import: 'default', eager: true },
    )
    const text = Object.values(sources).join('\n')
    const match = /packageVersion\s*=\s*"([^"]+)"/.exec(text)
    expect(match, 'versionSelector source not found — did @clerk/shared change layout?').not.toBeNull()
    // If this fails after upgrading @clerk/clerk-react: copy the new version into
    // CLERK_JS_VERSION (src/lib/startupHints.ts).
    expect(CLERK_JS_VERSION).toBe(match?.[1])
  })
})
