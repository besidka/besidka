// Injected into the Workbox-generated service worker via
// pwa.workbox.importScripts (nuxt.config.ts) — generateSW builds the whole
// worker from its own config with no hook for custom listeners, so this is
// the only way to add push handling without switching to injectManifest and
// owning the entire worker source, caching strategy included.
self.addEventListener('push', (event) => {
  if (!event.data) {
    return
  }

  let payload

  try {
    payload = event.data.json()
  } catch (exception) {
    // A service worker can stay stale for a while post-deploy — a payload
    // shape mismatch against an unrefreshed old worker should drop the
    // notification quietly, not throw inside the push handler.
    void exception

    return
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/web-app-manifest-192x192.png',
      badge: '/favicon-96x96.png',
      data: { url: payload.url },
      tag: 'besidka-response-ready',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find((client) => {
          return new URL(client.url).pathname === targetUrl
            && 'focus' in client
        })

        if (existingClient) {
          return existingClient.focus()
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }

        return undefined
      }),
  )
})
