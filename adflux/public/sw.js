// public/sw.js
//
// Phase 33R — service worker for push notifications.
// Phase 34G — extended with Workbox precache + runtime caching so the
// app shell loads on flaky / dead-zone connections (Gujarat field
// reality). Push handlers from 33R kept intact.
// Phase 35.0 pass 5 — version bump to force installed PWAs to drop the
// old bundle. Owner reported the Log meeting/lead position fix wasn't
// visible after `7ac8783` deployed — root cause: SW served the cached
// bundle. Touching this header changes the SW hash, which triggers
// `update found` on every client and a fresh precache rebuild on next
// navigation. SW_BUILD_TAG = '2026-05-16T18:00'
//
// Lives at /sw.js (root scope) so it can intercept push events
// for the whole app. Registered from src/utils/pushNotifications.js
// on rep login. With vite-plugin-pwa using strategies: 'injectManifest'
// + srcDir: 'public' + filename: 'sw.js', Workbox precache manifest
// is injected at build time via the precacheAndRoute call below.

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { createHandlerBoundToURL } from 'workbox-precaching'

// ─── PRECACHE ───────────────────────────────────────────────────────
// vite-plugin-pwa injects the build manifest here. Without it the
// app shell would not be cached offline.
precacheAndRoute(self.__WB_MANIFEST || [])

// SPA navigation fallback — any unknown route falls back to
// /index.html (the React Router root). Lets reps land on /work,
// /leads/<uuid>, /quotes etc. even when offline. The actual page
// data still needs Supabase, but the chrome at least renders.
//
// Phase 34Z.27 — denylist /assets/ + /fonts/ so dynamic JS chunks,
// font files, and other build artefacts aren't replaced with the
// index.html shell when the SW can't find them in precache. Without
// this, `import('html2canvas')` for the PDF renderer was loading
// HTML — Safari rejected it as "Expected a JavaScript-or-Wasm module
// script but the server responded with a MIME type of text/html."
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [
    /^\/assets\//,
    /^\/fonts\//,
    /^\/letterheads\//,
    /\.(?:js|mjs|css|map|json|png|jpg|jpeg|svg|webp|gif|ico|ttf|woff2?|wasm)$/,
  ],
}))

// ─── RUNTIME CACHE — Google Fonts ────────────────────────────────────
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com'
            || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
)

// ─── RUNTIME CACHE — Leaflet map tiles ──────────────────────────────
// Phase 34Z.2 — `tile.openstreetmap.org` (canonical, no subdomain
// rotation) added alongside the legacy `a/b/c.tile.openstreetmap.org`
// hosts so the new MeetingsMapPanel URL pattern also hits the cache.
registerRoute(
  ({ url }) => url.host === 'tile.openstreetmap.org'
            || url.host.endsWith('.tile.openstreetmap.org')
            || url.host === 'api.maptiler.com'
            || url.host === 'a.basemaps.cartocdn.com'
            || url.host === 'b.basemaps.cartocdn.com'
            || url.host === 'c.basemaps.cartocdn.com',
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// ─── RUNTIME CACHE — Supabase GET reads (stale-while-revalidate) ────
// We only cache safe-to-stale GETs. Mutations (POST/PATCH/DELETE) are
// never cached. The rep sees the last-known list when offline, then
// the cache silently refreshes once network returns.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.host.endsWith('.supabase.co') &&
    url.pathname.startsWith('/rest/v1/'),
  new StaleWhileRevalidate({
    cacheName: 'supabase-reads',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
)

// ─── INSTALL / ACTIVATE ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Activate the new SW immediately on update — don't wait for tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take over open pages on first install.
  event.waitUntil(self.clients.claim())
})


// ─── PUSH (Phase 33R/W) ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    payload = { title: 'Untitled OS', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Untitled OS'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag:   payload.tag || 'untitled',
    data:  { url: payload.url || '/' },
    requireInteraction: !!payload.requireInteraction,
    // Phase 34Z.56 — Android-friendly defaults. Majority of the team
    // runs on Android tablets. iOS Safari silently ignores fields it
    // doesn't support, so these are safe for both platforms.
    //   vibrate    — short double-buzz; Android only.
    //   silent     — explicit false because some Samsung Internet
    //                versions default-mute push without it.
    //   renotify   — re-notify when the same tag fires twice; rep
    //                needs to see the second alert (e.g. two follow-
    //                ups due in a row).
    //   lang       — better TTS / accessibility on Android.
    vibrate: [120, 60, 120],
    silent: false,
    renotify: true,
    lang: 'en-IN',
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus an existing tab if open; otherwise open a new one.
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
