/**
 * Completes push-notification deep links that iOS drops on PWA cold start
 * (firebase-js-sdk#7698): the service worker persists the target path in
 * IndexedDB before calling openWindow (app/service-worker/push.ts), and this
 * plugin reads-and-clears it on boot — and when the app returns to
 * visibility, for the case where iOS refocuses the running standalone window
 * without a reload — to perform the navigation client-side.
 * DB/store/key names must stay in sync with app/service-worker/push.ts.
 * The page only ever reads: the service worker is the sole creator of the
 * database, so visitors who never enabled push never get one. The read is
 * skipped unless notification permission is granted, then skipped again when
 * indexedDB.databases() (where supported) shows no database, and an open that
 * would create one is aborted.
 */
const PENDING_NAVIGATION_DB = 'besidka-push'
const PENDING_NAVIGATION_STORE = 'pending-navigation'
const PENDING_NAVIGATION_KEY = 'latest'
const PENDING_NAVIGATION_TTL_MS = 5 * 60 * 1000

interface PendingNavigation {
  url: string
  savedAt: number
}

function isPushNotificationGranted(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

async function pendingNavigationDatabaseExists(): Promise<boolean> {
  if (typeof window.indexedDB.databases !== 'function') {
    return true
  }

  try {
    const databases = await window.indexedDB.databases()

    return databases.some((database) => {
      return database.name === PENDING_NAVIGATION_DB
    })
  } catch (exception) {
    void exception

    return false
  }
}

async function readAndClearPendingNavigation(): Promise<
  PendingNavigation | null
> {
  if (!('indexedDB' in window) || !isPushNotificationGranted()) {
    return null
  }

  if (!await pendingNavigationDatabaseExists()) {
    return null
  }

  return new Promise((resolve) => {
    let openRequest: IDBOpenDBRequest

    try {
      openRequest = window.indexedDB.open(PENDING_NAVIGATION_DB, 1)
    } catch (exception) {
      void exception
      resolve(null)

      return
    }

    openRequest.onupgradeneeded = () => {
      openRequest.transaction?.abort()
    }

    openRequest.onsuccess = () => {
      const db = openRequest.result
      let entry: PendingNavigation | null = null

      const transaction = db.transaction(
        PENDING_NAVIGATION_STORE,
        'readwrite',
      )
      const store = transaction.objectStore(PENDING_NAVIGATION_STORE)
      const getRequest = store.get(PENDING_NAVIGATION_KEY)

      getRequest.onsuccess = () => {
        entry = (getRequest.result as PendingNavigation | undefined) ?? null

        store.delete(PENDING_NAVIGATION_KEY)
      }

      transaction.oncomplete = () => {
        db.close()
        resolve(entry)
      }
      transaction.onabort = () => {
        db.close()
        resolve(null)
      }
    }

    openRequest.onerror = () => resolve(null)
  })
}

function isInternalPath(url: unknown): url is string {
  return typeof url === 'string'
    && url.startsWith('/')
    && !url.startsWith('//')
}

async function navigateToPushTarget(url: string): Promise<void> {
  const router = useRouter()

  if (router.currentRoute.value.fullPath === url) {
    return
  }

  try {
    await navigateTo(url)
  } catch (exception) {
    void exception
  }
}

async function consumePendingNavigation(): Promise<void> {
  const pending = await readAndClearPendingNavigation()

  if (!pending || !isInternalPath(pending.url)) {
    return
  }

  if (Date.now() - pending.savedAt > PENDING_NAVIGATION_TTL_MS) {
    return
  }

  await navigateToPushTarget(pending.url)
}

export default defineNuxtPlugin((nuxtApp) => {
  let recheckTimeoutId: ReturnType<typeof setTimeout> | undefined

  function triggerConsumePendingNavigation() {
    nuxtApp.runWithContext(consumePendingNavigation)

    if (recheckTimeoutId) {
      clearTimeout(recheckTimeoutId)
    }

    // iOS can refocus the running window before the SW's notificationclick
    // handler finishes its IndexedDB write, so the first read finds nothing.
    recheckTimeoutId = setTimeout(() => {
      nuxtApp.runWithContext(consumePendingNavigation)
    }, 1500)
  }

  nuxtApp.hook('app:mounted', async () => {
    await nuxtApp.runWithContext(consumePendingNavigation)
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      triggerConsumePendingNavigation()
    }
  })

  window.addEventListener('focus', () => {
    triggerConsumePendingNavigation()
  })

  // The deterministic path for a tap while the app is already running: the
  // service worker posts the target directly to this window instead of
  // relying on IndexedDB plus a refocus event (app/service-worker/push.ts).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string, url?: unknown } | null

      if (data?.type !== 'besidka:push-navigate') {
        return
      }

      if (!isInternalPath(data.url)) {
        return
      }

      const url = data.url

      nuxtApp.runWithContext(() => navigateToPushTarget(url))
    })
  }
})
