import { handleNotificationClick, handlePush } from './push'

declare const self: ServiceWorkerGlobalScope & typeof globalThis
declare const __SW_BUILD_ID__: string

const SW_BUILD_ID = __SW_BUILD_ID__
const LEGACY_CACHE_PREFIX = 'workbox-'

self.addEventListener('push', handlePush)
self.addEventListener('notificationclick', handleNotificationClick)

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()

    return
  }

  if (event.data && event.data.type === 'GET_BUILD_ID') {
    event.source?.postMessage({ type: 'BUILD_ID', buildId: SW_BUILD_ID })
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteLegacyCaches())
})

async function deleteLegacyCaches(): Promise<void> {
  const names = await caches.keys()
  const legacyNames = names.filter((name) => {
    return name.startsWith(LEGACY_CACHE_PREFIX)
  })

  await Promise.all(legacyNames.map(name => caches.delete(name)))
}
