import { registerSW } from 'virtual:pwa-register'

/** Never ask the server for a new version more often than this. */
const MIN_CHECK_GAP_MS = 60_000

/**
 * Keeps installed PWAs up to date without "clear data and sign in again".
 *
 * An installed PWA is rarely fully reloaded, so the browser seldom re-checks
 * `sw.js` on its own. We check when the app starts, whenever it comes back to
 * the foreground, and when the device comes back online. With
 * `registerType: 'autoUpdate'` a new service worker takes over immediately and
 * the page reloads once onto the new version.
 *
 * Checks happen only on start / return-to-app (not on a timer), so a reload
 * never interrupts someone in the middle of typing a sale.
 */
export function setupPwaAutoUpdate(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration) return
      let lastCheck = 0

      const check = async () => {
        const now = Date.now()
        if (now - lastCheck < MIN_CHECK_GAP_MS) return
        if (registration.installing || !navigator.onLine) return
        lastCheck = now
        try {
          // Bypass any HTTP cache so a new deploy is seen right away.
          const res = await fetch(swUrl, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
          if (res.status === 200) await registration.update()
        } catch {
          // Offline or server hiccup — try again next time the app is opened.
        }
      }

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check()
      })
      window.addEventListener('online', () => void check())
      window.addEventListener('pageshow', () => void check())
    },
  })
}
