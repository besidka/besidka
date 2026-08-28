import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleNotificationClick, handlePush } from '../../../app/service-worker/push'

type ServiceWorkerEventHandler = (event: never) => void
type ListenerMap = Record<string, ServiceWorkerEventHandler[]>

const listeners: ListenerMap = {}

function captureAddEventListener(
  type: string,
  handler: ServiceWorkerEventHandler,
) {
  listeners[type] = listeners[type] ?? []
  listeners[type].push(handler)
}

const TEST_BUILD_ID = 'test-build-id'

beforeAll(async () => {
  vi.stubGlobal('__SW_BUILD_ID__', TEST_BUILD_ID)
  vi.stubGlobal('self', {
    addEventListener: captureAddEventListener,
    skipWaiting: vi.fn(),
  })

  await import('../../../app/service-worker/sw')

  vi.unstubAllGlobals()
})

describe('service worker entry registration', () => {
  it('registers the push handler', () => {
    expect(listeners.push).toContain(handlePush)
  })

  it('registers the notificationclick handler', () => {
    expect(listeners.notificationclick).toContain(handleNotificationClick)
  })

  it('registers a message handler', () => {
    expect(listeners.message).toHaveLength(1)
  })

  it('registers an activate handler', () => {
    expect(listeners.activate).toHaveLength(1)
  })

  it('never registers a fetch handler', () => {
    expect(listeners.fetch).toBeUndefined()
  })
})

describe('service worker message handling', () => {
  let skipWaiting: ReturnType<typeof vi.fn>

  beforeEach(() => {
    skipWaiting = vi.fn()

    vi.stubGlobal('self', { skipWaiting })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls skipWaiting on a SKIP_WAITING message', () => {
    const messageHandler = listeners.message?.[0]
    const event = { data: { type: 'SKIP_WAITING' } } as never

    messageHandler?.(event)

    expect(skipWaiting).toHaveBeenCalled()
  })

  it('replies with the build id on a GET_BUILD_ID message', () => {
    const messageHandler = listeners.message?.[0]
    const postMessage = vi.fn()
    const event = {
      data: { type: 'GET_BUILD_ID' },
      source: { postMessage },
    } as never

    messageHandler?.(event)

    expect(postMessage).toHaveBeenCalledWith({
      type: 'BUILD_ID',
      buildId: TEST_BUILD_ID,
    })
  })

  it('ignores an unrecognized message type', () => {
    const messageHandler = listeners.message?.[0]
    const event = { data: { type: 'SOMETHING_ELSE' } } as never

    expect(() => messageHandler?.(event)).not.toThrow()
    expect(skipWaiting).not.toHaveBeenCalled()
  })
})

describe('service worker activation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes only legacy workbox caches, leaving others intact', async () => {
    const cacheDelete = vi.fn(async () => true)

    vi.stubGlobal('caches', {
      keys: vi.fn(async () => {
        return ['workbox-precache-v1', 'other-cache', 'workbox-runtime']
      }),
      delete: cacheDelete,
    })

    const activateHandler = listeners.activate?.[0]
    let waitUntilPromise: Promise<unknown> | undefined
    const event = {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromise = promise
      },
    } as never

    activateHandler?.(event)
    await waitUntilPromise

    expect(cacheDelete).toHaveBeenCalledTimes(2)
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache-v1')
    expect(cacheDelete).toHaveBeenCalledWith('workbox-runtime')
    expect(cacheDelete).not.toHaveBeenCalledWith('other-cache')
  })
})
