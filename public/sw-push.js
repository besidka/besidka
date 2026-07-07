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
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .catch(() => [])
      .then((clients) => {
        const hasFocusedClient = clients.some((client) => client.focused)

        // The user is already looking at the app — a banner would be pure
        // noise, and browsers waive the user-visible-only requirement while
        // a window of the origin is focused. Matters mostly on desktop,
        // where windows stay open (and pushes fire on every completion).
        if (hasFocusedClient) {
          return undefined
        }

        return self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: '/web-app-manifest-192x192.png',
          badge: '/favicon-96x96.png',
          data: { url: payload.url },
          tag: 'besidka-response-ready',
        })
      }),
  )
})

// iOS can drop the openWindow URL when the PWA cold-starts from a killed
// state (firebase-js-sdk#7698) and launch at start_url instead. Persist the
// target path so app/plugins/push-navigation.client.ts can finish the
// navigation on boot. DB/store/key names must stay in sync with that plugin.
const PENDING_NAVIGATION_DB = 'besidka-push'
const PENDING_NAVIGATION_STORE = 'pending-navigation'
const PENDING_NAVIGATION_KEY = 'latest'

function isInternalPath(url) {
  return typeof url === 'string'
    && url.startsWith('/')
    && !url.startsWith('//')
}

function savePendingNavigation(url) {
  return new Promise((resolve) => {
    if (!isInternalPath(url)) {
      resolve(undefined)

      return
    }

    let openRequest

    try {
      openRequest = indexedDB.open(PENDING_NAVIGATION_DB, 1)
    } catch (exception) {
      void exception
      resolve(undefined)

      return
    }

    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(PENDING_NAVIGATION_STORE)
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      const transaction = db.transaction(PENDING_NAVIGATION_STORE, 'readwrite')

      transaction.objectStore(PENDING_NAVIGATION_STORE).put(
        { url, savedAt: Date.now() },
        PENDING_NAVIGATION_KEY,
      )

      transaction.oncomplete = () => {
        db.close()
        resolve(undefined)
      }
      transaction.onabort = () => {
        db.close()
        resolve(undefined)
      }
    }

    openRequest.onerror = () => resolve(undefined)
  })
}

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
          return client.focused
        }) || clients[0]

        // A running window navigates itself via this message
        // (app/plugins/push-navigation.client.ts): openWindow on iOS merely
        // refocuses the running PWA without honoring the URL, and the
        // IndexedDB fallback depends on storage access inside a
        // briefly-woken service worker — a direct postMessage does not.
        if (existingClient) {
          existingClient.postMessage({
            type: 'besidka:push-navigate',
            url: targetUrl,
          })

          return existingClient.focus().catch((exception) => {
            void exception
          })
        }

        if (self.clients.openWindow) {
          return savePendingNavigation(targetUrl).then(() => {
            return self.clients.openWindow(targetUrl)
          })
        }

        return undefined
      }),
  )
})
