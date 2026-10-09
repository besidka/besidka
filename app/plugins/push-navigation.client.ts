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
 * would create one is aborted. A failing or slow databases() call falls
 * through to that guarded open, so the handoff is never dropped. While
 * permission is not granted, a database left empty by an earlier version of
 * this plugin is deleted, once per page load. Targets are resolved against the
 * page origin before navigating, see service-worker/internal-navigation.ts.
 */
import { resolveInternalNavigationTarget } from '~/service-worker/internal-navigation'

const PENDING_NAVIGATION_DB = 'besidka-push'
const PENDING_NAVIGATION_STORE = 'pending-navigation'
const PENDING_NAVIGATION_KEY = 'latest'
const PENDING_NAVIGATION_TTL_MS = 5 * 60 * 1000
const DATABASE_LISTING_TIMEOUT_MS = 500

let hasDiscardedLegacyDatabase = false

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

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const databases = await Promise.race([
      window.indexedDB.databases(),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), DATABASE_LISTING_TIMEOUT_MS)
      }),
    ])

    if (databases === null) {
      return true
    }

    return databases.some((database) => {
      return database.name === PENDING_NAVIGATION_DB
    })
  } catch (exception) {
    void exception

    return true
  } finally {
    clearTimeout(timeoutId)
  }
}

function discardPendingNavigationDatabase(): void {
  if (hasDiscardedLegacyDatabase) {
    return
  }

  hasDiscardedLegacyDatabase = true

  try {
    window.indexedDB.deleteDatabase(PENDING_NAVIGATION_DB)
  } catch (exception) {
    void exception
  }
}

async function readAndClearPendingNavigation(): Promise<
  PendingNavigation | null
> {
  if (!('indexedDB' in window)) {
    return null
  }

  if (!isPushNotificationGranted()) {
    discardPendingNavigationDatabase()

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

function resolvePushTarget(url: unknown): string | null {
  return resolveInternalNavigationTarget(url, window.location.origin)
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

  const target = pending ? resolvePushTarget(pending.url) : null

  if (!pending || !target) {
    return
  }

  if (Date.now() - pending.savedAt > PENDING_NAVIGATION_TTL_MS) {
    return
  }

  await navigateToPushTarget(target)
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

      const target = resolvePushTarget(data.url)

      if (!target) {
        return
      }

      nuxtApp.runWithContext(() => navigateToPushTarget(target))
    })
  }
})
