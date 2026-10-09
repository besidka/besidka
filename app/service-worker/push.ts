import { resolveInternalNavigationTarget } from './internal-navigation'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

interface PushNotificationPayload {
  title: string
  body: string
  url: string
  tag?: string
}

interface PendingNavigation {
  url: string
  savedAt: number
}

const PENDING_NAVIGATION_DB = 'besidka-push'
const PENDING_NAVIGATION_STORE = 'pending-navigation'
const PENDING_NAVIGATION_KEY = 'latest'
const DEFAULT_NOTIFICATION_TAG = 'besidka-response-ready'
const FALLBACK_NOTIFICATION: PushNotificationPayload = {
  title: 'Besidka',
  body: 'You have a new update.',
  url: '/',
}

export function isInternalNavigationUrl(url: unknown): url is string {
  return resolveInternalNavigationTarget(url, self.location.origin) !== null
}

function savePendingNavigation(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isInternalNavigationUrl(url)) {
      resolve()

      return
    }

    let openRequest: IDBOpenDBRequest

    try {
      openRequest = indexedDB.open(PENDING_NAVIGATION_DB, 1)
    } catch (exception) {
      void exception
      resolve()

      return
    }

    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(PENDING_NAVIGATION_STORE)
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      const transaction = db.transaction(
        PENDING_NAVIGATION_STORE,
        'readwrite',
      )
      const pendingNavigation: PendingNavigation = { url, savedAt: Date.now() }

      transaction.objectStore(PENDING_NAVIGATION_STORE).put(
        pendingNavigation,
        PENDING_NAVIGATION_KEY,
      )

      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onabort = () => {
        db.close()
        resolve()
      }
    }

    openRequest.onerror = () => resolve()
  })
}

function parsePushPayload(event: PushEvent): PushNotificationPayload {
  if (!event.data) {
    return FALLBACK_NOTIFICATION
  }

  try {
    const parsedPayload = event.data.json()

    if (!parsedPayload || typeof parsedPayload !== 'object') {
      return FALLBACK_NOTIFICATION
    }

    return {
      title: typeof parsedPayload.title === 'string'
        ? parsedPayload.title
        : FALLBACK_NOTIFICATION.title,
      body: typeof parsedPayload.body === 'string'
        ? parsedPayload.body
        : FALLBACK_NOTIFICATION.body,
      url: resolveInternalNavigationTarget(
        parsedPayload.url,
        self.location.origin,
      ) ?? FALLBACK_NOTIFICATION.url,
      tag: typeof parsedPayload.tag === 'string'
        ? parsedPayload.tag
        : undefined,
    }
  } catch (exception) {
    void exception

    return FALLBACK_NOTIFICATION
  }
}

export function handlePush(event: PushEvent): void {
  const payload = parsePushPayload(event)

  event.waitUntil(
    self.registration
      .showNotification(payload.title, {
        body: payload.body,
        icon: '/web-app-manifest-192x192.png',
        badge: '/favicon-96x96.png',
        data: { url: payload.url },
        tag: payload.tag ?? DEFAULT_NOTIFICATION_TAG,
      })
      .catch(() => undefined),
  )
}

export function handleNotificationClick(event: NotificationEvent): void {
  event.notification.close()

  const notificationData = event.notification.data as
    { url?: string } | undefined
  const targetUrl = resolveInternalNavigationTarget(
    notificationData?.url,
    self.location.origin,
  ) ?? '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find((client) => {
          return client.focused
        }) ?? clients[0]

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
}
