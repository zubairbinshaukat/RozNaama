import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ConvexReactClient } from 'convex/react'
import { setupPwaAutoUpdate } from '@/lib/pwaUpdate'
import { CLERK_JS_VERSION } from '@/lib/startupHints'
import { PERF_MARKS, perfMark } from '@/lib/perf'
import { preloadSnapshot } from '@/lib/offline/snapshot'
import { readLastUserHint } from '@/lib/userHints'
import '@/styles/globals.css'
import App from './App'

perfMark(PERF_MARKS.boot)
setupPwaAutoUpdate()

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
const convexUrl      = import.meta.env.VITE_CONVEX_URL as string | undefined

const container = document.getElementById('root')!
const root      = createRoot(container)

if (!publishableKey || !convexUrl) {
  // Keys are missing — render a static warning page (no crash)
  root.render(
    <StrictMode>
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
          background: '#ffffff',
          color: '#111827',
          padding: '2rem',
          gap: '1rem',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
          Environment keys missing
        </h1>
        <p style={{ color: '#6b7280', maxWidth: '480px', lineHeight: 1.6 }}>
          Copy <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>.env.local.example</code> to{' '}
          <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>.env.local</code>{' '}
          and fill in your <strong>VITE_CLERK_PUBLISHABLE_KEY</strong> and{' '}
          <strong>VITE_CONVEX_URL</strong>, then restart the dev server.
        </p>
      </div>
    </StrictMode>,
  )
} else {
  // No beforeunload prompt: WP-B's outbox (IndexedDB) owns unsynced entries, and a
  // browser "Leave site?" dialog only confuses shopkeepers on PWA reloads / updates.
  const convexClient = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })

  const render = () => root.render(
    <StrictMode>
      <ClerkProvider
        publishableKey={publishableKey}
        // Exact version → stable URL for the index.html preload + SW cache (see startupHints.ts).
        clerkJSVersion={CLERK_JS_VERSION}
        appearance={{
          variables: {
            colorPrimary:   'hsl(243, 75%, 59%)',
            borderRadius:   '0.875rem',
            fontFamily:     "'Inter Variable', Inter, system-ui, sans-serif",
          },
        }}
      >
        <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </StrictMode>,
  )

  // Instant open: read the last user's dashboard snapshot from IndexedDB before
  // the first render, so the dashboard can paint saved numbers instead of a
  // spinner. Capped at 300 ms (a slow read finishes in the background and the
  // SnapshotProvider picks it up). Convex connects meanwhile, and clerk-js is
  // already downloading (preloaded from index.html).
  void preloadSnapshot(readLastUserHint()?.id, 300)
    .catch(() => null)
    .then(render)
}
