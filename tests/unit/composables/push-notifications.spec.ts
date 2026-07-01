import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { usePushNotifications } from '../../../app/composables/push-notifications'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async () => undefined),
  vapidPublicKey: 'QUJDRA',
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { vapidPublicKey: mocks.vapidPublicKey },
  })
})

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('usePushNotifications', () => {
  let subscribeMock: ReturnType<typeof vi.fn>
  let getSubscriptionMock: ReturnType<typeof vi.fn>
  let requestPermissionMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    mocks.fetch.mockClear()
    mocks.vapidPublicKey = 'QUJDRA'
    vi.stubGlobal('$fetch', mocks.fetch)

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
})
