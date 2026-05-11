// public/sw.js
//
// Phase 33R — service worker for push notifications.
// Owner directives #2 / #3 / #15.
//
// Lives at /sw.js (root scope) so it can intercept push events
// for the whole app. Registered from src/utils/pushNotifications.js
// on rep login.

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on update — don't wait for tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take over open pages on first install.
  event.waitUntil(self.clients.claim())
})

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
