import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { ConvexReactClient } from 'convex/react'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/globals.css'
import App from './App'

registerSW({ onNeedRefresh() {}, onOfflineReady() {} })

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
          fontFamily: 'Inter, system-ui, sans-serif',
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
  const convexClient = new ConvexReactClient(convexUrl)

  root.render(
    <StrictMode>
      <ClerkProvider
        publishableKey={publishableKey}
        appearance={{
          variables: {
            colorPrimary:   'hsl(239, 84%, 67%)',
            borderRadius:   '0.625rem',
            fontFamily:     'Inter, system-ui, sans-serif',
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
}
