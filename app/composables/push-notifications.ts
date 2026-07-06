// Long-standing, universally-compatible conversion — every browser that
// implements the Push API accepts a BufferSource applicationServerKey; only
// newer ones also accept a raw base64url string, so converting here rather
// than passing the string directly maximizes compatibility on older iOS
// Safari, the priority target for this feature.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = globalThis.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return ''
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// After a VAPID key rotation, a browser's existing PushManager subscription
// stays bound to the applicationServerKey it was created with, so it must be
// unsubscribed and recreated with the current key before it can be used again.
function isApplicationServerKeyStale(
  applicationServerKey: ArrayBuffer | null | undefined,
  vapidPublicKey: string,
): boolean {
  if (!applicationServerKey) {
    return false
  }

  const configuredKey = urlBase64ToUint8Array(vapidPublicKey)
  const currentKey = new Uint8Array(applicationServerKey)

  if (configuredKey.length !== currentKey.length) {
    return true
  }

  return configuredKey.some((byte, index) => byte !== currentKey[index])
}

export function usePushNotifications() {
  const { public: { vapidPublicKey } } = useRuntimeConfig()
  const permission = shallowRef<NotificationPermission>('default')
  const isSubscribed = shallowRef<boolean>(false)

  const isSupported = computed<boolean>(() => {
    if (!import.meta.client) {
      return false
    }

    return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
      && Boolean(vapidPublicKey)
  })

  async function refreshState(): Promise<void> {
    if (!isSupported.value) {
      return
    }

    permission.value = Notification.permission

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      const isStale = subscription !== null
        && isApplicationServerKeyStale(
          subscription.options?.applicationServerKey,
          vapidPublicKey,
        )

      if (isStale && Notification.permission === 'granted') {
        try {
          await subscription.unsubscribe()

          const freshSubscription
            = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(
                vapidPublicKey,
              ) as BufferSource,
            })

          await $fetch('/api/v1/push/subscribe', {
            method: 'POST',
            body: {
              endpoint: freshSubscription.endpoint,
              keys: {
                p256dh: arrayBufferToBase64Url(
                  freshSubscription.getKey('p256dh'),
                ),
                auth: arrayBufferToBase64Url(
                  freshSubscription.getKey('auth'),
                ),
              },
            },
          })

          isSubscribed.value = true

          return
        } catch (exception) {
          void exception
        }
      }

      isSubscribed.value = subscription !== null

      if (subscription !== null) {
        try {
          await $fetch('/api/v1/push/subscribe', {
            method: 'POST',
            body: {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: arrayBufferToBase64Url(
                  subscription.getKey('p256dh'),
                ),
                auth: arrayBufferToBase64Url(subscription.getKey('auth')),
              },
            },
          })
        } catch (exception) {
          void exception
        }
      }
    } catch (exception) {
      void exception
    }
  }

  // Must be called directly from a user-gesture handler (a click) — Safari
  // and Firefox refuse to show the native permission dialog otherwise, and
  // this is also the project's compliance-required moment to have already
  // shown contextual disclosure before this runs (see the calling banner
  // component, not this composable).
  async function subscribe(): Promise<boolean> {
    if (!isSupported.value) {
      return false
    }

    const result = await Notification.requestPermission()

    permission.value = result

    if (result !== 'granted') {
      return false
    }

    try {
      const registration = await navigator.serviceWorker.ready
      const existingSubscription
        = await registration.pushManager.getSubscription()
      const isStale = existingSubscription !== null
        && isApplicationServerKeyStale(
          existingSubscription.options?.applicationServerKey,
          vapidPublicKey,
        )

      if (isStale) {
        await existingSubscription.unsubscribe()
      }

      const subscription = (existingSubscription && !isStale)
        ? existingSubscription
        : await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            vapidPublicKey,
          ) as BufferSource,
        })

      await $fetch('/api/v1/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
            auth: arrayBufferToBase64Url(subscription.getKey('auth')),
          },
        },
      })

      isSubscribed.value = true

      return true
    } catch (exception) {
      void exception

      return false
    }
  }

  async function unsubscribe(): Promise<void> {
    if (!isSupported.value) {
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        isSubscribed.value = false

        return
      }

      const endpoint = subscription.endpoint

      await subscription.unsubscribe()

      await $fetch('/api/v1/push/unsubscribe', {
        method: 'POST',
        body: { endpoint },
      })
    } catch (exception) {
      void exception
    } finally {
      isSubscribed.value = false
    }
  }

  async function watchPermissionChanges(): Promise<void> {
    if (!('permissions' in navigator)) {
      return
    }

    try {
      const permissionStatus = await navigator.permissions.query({
        name: 'notifications' as PermissionName,
      })

      permissionStatus.onchange = () => {
        permission.value = Notification.permission
      }
    } catch (exception) {
      void exception
    }
  }

  if (import.meta.client) {
    refreshState().then(watchPermissionChanges).catch((exception) => {
      void exception
    })
  }

  return {
    isSupported,
    permission,
    isSubscribed,
    subscribe,
    unsubscribe,
  }
}
