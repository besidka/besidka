import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { usePushNotifications } from '../../../app/composables/push-notifications'
import * as messagesComposable from '../../../app/composables/messages'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async () => undefined),
  vapidPublicKey: 'QUJDRA',
  loggedIn: true,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { vapidPublicKey: mocks.vapidPublicKey },
  })
})

mockNuxtImport('$fetch', () => mocks.fetch)

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: computed(() => mocks.loggedIn),
  })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('usePushNotifications', () => {
  let subscribeMock: ReturnType<typeof vi.fn>
  let getSubscriptionMock: ReturnType<typeof vi.fn>
  let requestPermissionMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mocks.fetch.mockClear()
    mocks.vapidPublicKey = 'QUJDRA'
    mocks.loggedIn = true
    window.localStorage.clear()

    useState<NotificationPermission>(
      'push-notifications:permission',
      () => 'default',
    ).value = 'default'
    useState<boolean>(
      'push-notifications:is-subscribed',
      () => false,
    ).value = false
    useState<boolean>(
      'push-notifications:has-auto-refreshed',
      () => false,
    ).value = false

    requestPermissionMock = vi.fn(async () => 'granted')
    getSubscriptionMock = vi.fn(async () => null)
    subscribeMock = vi.fn(async () => ({
      endpoint: 'https://push.example.com/sub-1',
      getKey: (name: string) => {
        return name === 'p256dh'
          ? new TextEncoder().encode('p256dh-bytes').buffer
          : new TextEncoder().encode('auth-bytes').buffer
      },
      unsubscribe: vi.fn(async () => true),
    }))

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: requestPermissionMock,
      },
    })

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: getSubscriptionMock,
            subscribe: subscribeMock,
          },
        }),
      },
    })

    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })

    await flushPromises()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports unsupported without a VAPID public key configured', async () => {
    mocks.vapidPublicKey = ''

    const composable = usePushNotifications()

    expect(composable.isSupported.value).toBe(false)
  })

  it('reports supported with a VAPID public key and the required APIs', () => {
    const composable = usePushNotifications()

    expect(composable.isSupported.value).toBe(true)
  })

  it('subscribes and posts the subscription to the server on success', async () => {
    const composable = usePushNotifications()
    const result = await composable.subscribe()

    expect(result).toBe(true)
    expect(requestPermissionMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
    }))
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://push.example.com/sub-1',
        keys: {
          p256dh: expect.any(String),
          auth: expect.any(String),
        },
      },
    })
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('does not subscribe when permission is denied', async () => {
    requestPermissionMock.mockResolvedValue('denied')

    const composable = usePushNotifications()
    const result = await composable.subscribe()

    expect(result).toBe(false)
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('surfaces an error and returns false when the subscribe POST fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('401 Unauthorized'))

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const composable = usePushNotifications()
    const result = await composable.subscribe()

    expect(result).toBe(false)
    expect(useErrorMessage).toHaveBeenCalledWith(
      '401 Unauthorized',
      undefined,
    )
  })

  it('reuses an existing subscription instead of subscribing again', async () => {
    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/existing',
      getKey: () => new TextEncoder().encode('key-bytes').buffer,
    })

    const composable = usePushNotifications()

    await composable.subscribe()

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/push/subscribe',
      expect.objectContaining({
        body: expect.objectContaining({
          endpoint: 'https://push.example.com/existing',
        }),
      }),
    )
  })

  it('re-posts an existing subscription found on load to the server', async () => {
    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/existing',
      getKey: (name: string) => {
        return name === 'p256dh'
          ? new TextEncoder().encode('p256dh-bytes').buffer
          : new TextEncoder().encode('auth-bytes').buffer
      },
    })

    const composable = usePushNotifications()

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://push.example.com/existing',
        keys: {
          p256dh: expect.any(String),
          auth: expect.any(String),
        },
      },
    })
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('ignores a failed re-post of an existing subscription on load', async () => {
    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/existing',
      getKey: (name: string) => {
        return name === 'p256dh'
          ? new TextEncoder().encode('p256dh-bytes').buffer
          : new TextEncoder().encode('auth-bytes').buffer
      },
    })
    mocks.fetch.mockRejectedValueOnce(new Error('401 Unauthorized'))

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const composable = usePushNotifications()

    await flushPromises()

    expect(composable.isSubscribed.value).toBe(true)
    expect(useErrorMessage).toHaveBeenCalledWith(
      '401 Unauthorized',
      undefined,
    )
  })

  it('does not re-post an existing subscription on load when logged out', async () => {
    mocks.loggedIn = false

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/existing',
      getKey: (name: string) => {
        return name === 'p256dh'
          ? new TextEncoder().encode('p256dh-bytes').buffer
          : new TextEncoder().encode('auth-bytes').buffer
      },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const composable = usePushNotifications()

    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(useErrorMessage).not.toHaveBeenCalled()
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('replaces a stale-key subscription on refresh when granted', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: requestPermissionMock,
      },
    })

    const unsubscribeMock = vi.fn(async () => true)

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/stale',
      options: {
        applicationServerKey: new TextEncoder().encode('stale-key').buffer,
      },
      getKey: () => new TextEncoder().encode('key-bytes').buffer,
      unsubscribe: unsubscribeMock,
    })

    const composable = usePushNotifications()

    await flushPromises()

    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
    }))
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://push.example.com/sub-1',
        keys: {
          p256dh: expect.any(String),
          auth: expect.any(String),
        },
      },
    })
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('leaves a matching-key subscription untouched on refresh', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: requestPermissionMock,
      },
    })

    const unsubscribeMock = vi.fn(async () => true)

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/existing',
      options: {
        applicationServerKey: new TextEncoder().encode('ABCD').buffer,
      },
      getKey: (name: string) => {
        return name === 'p256dh'
          ? new TextEncoder().encode('p256dh-bytes').buffer
          : new TextEncoder().encode('auth-bytes').buffer
      },
      unsubscribe: unsubscribeMock,
    })

    const composable = usePushNotifications()

    await flushPromises()

    expect(unsubscribeMock).not.toHaveBeenCalled()
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://push.example.com/existing',
        keys: {
          p256dh: expect.any(String),
          auth: expect.any(String),
        },
      },
    })
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('does not replace a stale-key subscription when logged out', async () => {
    mocks.loggedIn = false

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: requestPermissionMock,
      },
    })

    const unsubscribeMock = vi.fn(async () => true)

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/stale',
      options: {
        applicationServerKey: new TextEncoder().encode('stale-key').buffer,
      },
      getKey: () => new TextEncoder().encode('key-bytes').buffer,
      unsubscribe: unsubscribeMock,
    })

    const composable = usePushNotifications()

    await flushPromises()

    expect(unsubscribeMock).not.toHaveBeenCalled()
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('replaces a stale-key subscription before subscribing', async () => {
    const unsubscribeMock = vi.fn(async () => true)

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/stale',
      options: {
        applicationServerKey: new TextEncoder().encode('stale-key').buffer,
      },
      getKey: () => new TextEncoder().encode('key-bytes').buffer,
      unsubscribe: unsubscribeMock,
    })

    const composable = usePushNotifications()
    const result = await composable.subscribe()

    expect(result).toBe(true)
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
    }))
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://push.example.com/sub-1',
        keys: {
          p256dh: expect.any(String),
          auth: expect.any(String),
        },
        previousEndpoint: 'https://push.example.com/stale',
      },
    })
    expect(composable.isSubscribed.value).toBe(true)
  })

  it('unsubscribes and notifies the server', async () => {
    const unsubscribeMock = vi.fn(async () => true)

    getSubscriptionMock.mockResolvedValue({
      endpoint: 'https://push.example.com/sub-1',
      unsubscribe: unsubscribeMock,
    })

    const composable = usePushNotifications()

    await composable.unsubscribe()

    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: 'https://push.example.com/sub-1' },
    })
    expect(composable.isSubscribed.value).toBe(false)
  })

  describe('previous endpoint tracking', () => {
    const STORAGE_KEY = 'besidka:push-endpoint'

    it('stores the uploaded endpoint after a successful subscribe', async () => {
      const composable = usePushNotifications()

      await composable.subscribe()

      expect(window.localStorage.getItem(STORAGE_KEY))
        .toBe('https://push.example.com/sub-1')
    })

    it('does not store the endpoint when the subscribe POST fails', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('401 Unauthorized'))

      const composable = usePushNotifications()

      await composable.subscribe()

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('sends previousEndpoint when the stored endpoint differs', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        'https://push.example.com/old',
      )

      const composable = usePushNotifications()

      await composable.subscribe()

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: 'https://push.example.com/sub-1',
          keys: {
            p256dh: expect.any(String),
            auth: expect.any(String),
          },
          previousEndpoint: 'https://push.example.com/old',
        },
      })
      expect(window.localStorage.getItem(STORAGE_KEY))
        .toBe('https://push.example.com/sub-1')
    })

    it('omits previousEndpoint when the stored endpoint is unchanged', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        'https://push.example.com/sub-1',
      )

      const composable = usePushNotifications()

      await composable.subscribe()

      const body = (mocks.fetch.mock.calls[0] as unknown[])[1] as {
        body: Record<string, unknown>
      }

      expect(body.body).not.toHaveProperty('previousEndpoint')
    })

    it('omits previousEndpoint when nothing is stored', async () => {
      const composable = usePushNotifications()

      await composable.subscribe()

      const body = (mocks.fetch.mock.calls[0] as unknown[])[1] as {
        body: Record<string, unknown>
      }

      expect(body.body).not.toHaveProperty('previousEndpoint')
    })

    it('sends previousEndpoint on the load-time re-post', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        'https://push.example.com/old',
      )
      getSubscriptionMock.mockResolvedValue({
        endpoint: 'https://push.example.com/existing',
        getKey: () => new TextEncoder().encode('key-bytes').buffer,
      })

      usePushNotifications()

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/push/subscribe',
        expect.objectContaining({
          body: expect.objectContaining({
            endpoint: 'https://push.example.com/existing',
            previousEndpoint: 'https://push.example.com/old',
          }),
        }),
      )
      expect(window.localStorage.getItem(STORAGE_KEY))
        .toBe('https://push.example.com/existing')
    })

    it('sends previousEndpoint when healing a stale-key subscription', async () => {
      Object.defineProperty(globalThis, 'Notification', {
        configurable: true,
        value: {
          permission: 'granted',
          requestPermission: requestPermissionMock,
        },
      })
      window.localStorage.setItem(
        STORAGE_KEY,
        'https://push.example.com/stale',
      )
      getSubscriptionMock.mockResolvedValue({
        endpoint: 'https://push.example.com/stale',
        options: {
          applicationServerKey: new TextEncoder().encode('stale-key').buffer,
        },
        getKey: () => new TextEncoder().encode('key-bytes').buffer,
        unsubscribe: vi.fn(async () => true),
      })

      usePushNotifications()

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/push/subscribe',
        expect.objectContaining({
          body: expect.objectContaining({
            endpoint: 'https://push.example.com/sub-1',
            previousEndpoint: 'https://push.example.com/stale',
          }),
        }),
      )
      expect(window.localStorage.getItem(STORAGE_KEY))
        .toBe('https://push.example.com/sub-1')
    })

    it('clears the stored endpoint on unsubscribe', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        'https://push.example.com/sub-1',
      )
      getSubscriptionMock.mockResolvedValue({
        endpoint: 'https://push.example.com/sub-1',
        unsubscribe: vi.fn(async () => true),
      })

      const composable = usePushNotifications()

      await composable.unsubscribe()

      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('still subscribes when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage unavailable')
      })

      const composable = usePushNotifications()
      const result = await composable.subscribe()

      expect(result).toBe(true)
      expect(composable.isSubscribed.value).toBe(true)

      const body = (mocks.fetch.mock.calls[0] as unknown[])[1] as {
        body: Record<string, unknown>
      }

      expect(body.body).not.toHaveProperty('previousEndpoint')
    })

    it('still unsubscribes when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage unavailable')
      })
      getSubscriptionMock.mockResolvedValue({
        endpoint: 'https://push.example.com/sub-1',
        unsubscribe: vi.fn(async () => true),
      })

      const composable = usePushNotifications()

      await composable.unsubscribe()

      expect(composable.isSubscribed.value).toBe(false)
    })
  })
})
