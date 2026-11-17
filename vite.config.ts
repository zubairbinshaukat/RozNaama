import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { buildStartupHintTags } from './src/lib/startupHints'

/**
 * Injects resource hints into index.html (see src/lib/startupHints.ts):
 * preload of the self-hosted Inter latin font (build only — needs the hashed
 * file name) and of clerk-js, plus preconnect / dns-prefetch to the Clerk
 * Frontend API host (decoded from the publishable key) and the Convex host.
 */
function htmlHints(env: Record<string, string>): Plugin {
  return {
    name: 'rn-html-hints',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = ctx.bundle
          ? Object.values(ctx.bundle).find((f) => /inter-latin-wght-normal[^/]*\.woff2$/.test(f.fileName))
          : undefined
        return buildStartupHintTags({
          clerkPublishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
          convexUrl: env.VITE_CONVEX_URL,
          fontHref: font ? `/${font.fileName}` : null,
        })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [
      react(),
      tailwindcss(),
      htmlHints(env),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon512_maskable.png', 'icon512_rounded.png'],
        manifest: {
          name: 'RozNaama - Sales Tracker',
          short_name: 'RozNaama',
          description: 'Daily sales tracking and reporting for field teams',
          theme_color: '#0f172a',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/dashboard',
          icons: [
            {
              src: 'icon512_maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icon512_rounded.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
          categories: ['business', 'productivity'],
        },
        workbox: {
          // Includes every lazy route chunk and the self-hosted Inter woff2 files.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // The admin page chunk is never precached, so shopkeepers' phones never
          // download it; admins fetch it on first open (cached at runtime below).
          globIgnores: ['**/assets/Admin-*.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // New deploys take over at once and old precaches are removed, so an
          // installed PWA never keeps serving a stale bundle.
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Admin page chunk (see globIgnores): cached after an admin opens it.
              urlPattern: /\/assets\/Admin-[^/]+\.js$/,
              handler: 'StaleWhileRevalidate',
              method: 'GET',
              options: {
                cacheName: 'admin-chunk',
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // clerk-js bundle + its lazy chunks from Clerk's CDN
              // (https://<frontendApi>/npm/@clerk/clerk-js@<CLERK_JS_VERSION>/dist/…).
              // Anchored at the start on purpose: Workbox only applies a RegExp to a
              // cross-origin URL when the match starts at index 0.
              // Only the static script path matches — Clerk's API (/v1/client,
              // /v1/environment, …) is never cached.
              urlPattern: /^https:\/\/[^/]+\/npm\/@clerk\/clerk-js@/,
              handler: 'StaleWhileRevalidate',
              method: 'GET',
              options: {
                cacheName: 'clerk-js',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
          // Convex traffic (WebSocket + HTTP) is intentionally NOT cached by the
          // service worker: stale cached responses could show wrong totals.
        },
        devOptions: {
          enabled: true, // Enable PWA in dev mode for testing
        },
      }),
    ],
    build: {
      rolldownOptions: {
        output: {
          // Stable vendor chunks: an app-only deploy leaves these hashes unchanged,
          // so the service worker re-downloads just the app chunks on update.
          // recharts (+ its deps) is only imported from lazy routes, so it never
          // joins the first load.
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/ },
              { name: 'vendor-clerk', test: /node_modules[\\/]@clerk[\\/]/ },
              { name: 'vendor-convex', test: /node_modules[\\/](convex|convex-helpers)[\\/]/ },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
