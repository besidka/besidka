import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleNotificationClick,
  handlePush,
  isInternalNavigationUrl,
} from '../../../app/service-worker/push'

interface FakePendingNavigationEntry {
  url: string
  savedAt: number
}

function createFakeIndexedDb() {
  const putCalls: FakePendingNavigationEntry[] = []

  const open = vi.fn((_name: string, _version: number) => {
    const request: {
      result?: unknown
      onupgradeneeded?: () => void
      onsuccess?: () => void
      onerror?: () => void
    } = {}

    queueMicrotask(() => {
      const store = {
        put: (value: FakePendingNavigationEntry) => {
          putCalls.push(value)
        },
      }
      const transaction: { oncomplete?: () => void, onabort?: () => void } = {}
      const db = {
        createObjectStore: vi.fn(),
        transaction: () => {
          queueMicrotask(() => transaction.oncomplete?.())

          return {
            objectStore: () => store,
            set oncomplete(handler: () => void) {
              transaction.oncomplete = handler
            },
            set onabort(handler: () => void) {
              transaction.onabort = handler
            },
          }
        },
        close: vi.fn(),
      }

      request.result = db
      request.onupgradeneeded?.()
      request.onsuccess?.()
    })

    return request
  })

  return { open, putCalls }
}

async function flushPromises() {
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve()
  }
}

function createFakeWindowClient(overrides: {
  focused?: boolean
  postMessage?: (message: unknown) => void
  focus?: () => Promise<unknown>
} = {}) {
  return {
    focused: overrides.focused ?? false,
    postMessage: overrides.postMessage ?? vi.fn(),
    focus: overrides.focus ?? vi.fn(() => Promise.resolve()),
  }
}

describe('isInternalNavigationUrl', () => {
  it('accepts a same-origin absolute path', () => {
    expect(isInternalNavigationUrl('/chats/abc')).toBe(true)
  })

  it('rejects a protocol-relative url', () => {
    expect(isInternalNavigationUrl('//evil.example.com')).toBe(false)
  })

  it('rejects a non-string value', () => {
    expect(isInternalNavigationUrl(undefined)).toBe(false)
  })

  it('rejects a relative path without a leading slash', () => {
    expect(isInternalNavigationUrl('chats/abc')).toBe(false)
  })
})

describe('handlePush', () => {
  let showNotification: ReturnType<typeof vi.fn>
  let matchAll: ReturnType<typeof vi.fn>
  let waitUntilPromise: Promise<unknown> | undefined

  beforeEach(() => {
    showNotification = vi.fn(() => Promise.resolve())
    matchAll = vi.fn(() => Promise.resolve([]))
    waitUntilPromise = undefined

    vi.stubGlobal('self', {
      clients: { matchAll },
      registration: { showNotification },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createFakePushEvent(payload: unknown) {
    return {
      data: {
        json: () => {
          if (payload instanceof Error) {
            throw payload
          }

          return payload
        },
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromise = promise
      }),
    }
  }

  it('does nothing when the push event carries no data', async () => {
    const event = { data: null, waitUntil: vi.fn() }

    handlePush(event as unknown as Parameters<typeof handlePush>[0])

    expect(event.waitUntil).not.toHaveBeenCalled()
  })

  it('drops the notification when the payload is not valid JSON', async () => {
    const event = createFakePushEvent(new Error('bad json'))

    handlePush(event as unknown as Parameters<typeof handlePush>[0])

    expect(event.waitUntil).not.toHaveBeenCalled()
  })

  it('shows a notification matching the server payload shape', async () => {
    const payload = {
      title: 'Response ready',
      body: 'Your generation finished',
      url: '/chats/abc',
      tag: 'besidka-response-ready',
    }
    const event = createFakePushEvent(payload)

    handlePush(event as unknown as Parameters<typeof handlePush>[0])
    await waitUntilPromise

    expect(showNotification).toHaveBeenCalledWith(payload.title, {
      body: payload.body,
      icon: '/web-app-manifest-192x192.png',
      badge: '/favicon-96x96.png',
      data: { url: payload.url },
      tag: payload.tag,
    })
  })

  it('falls back to the default tag when the payload omits one', async () => {
    const payload = {
      title: 'Response ready',
      body: 'Your generation finished',
      url: '/chats/abc',
    }
    const event = createFakePushEvent(payload)

    handlePush(event as unknown as Parameters<typeof handlePush>[0])
    await waitUntilPromise

    expect(showNotification).toHaveBeenCalledWith(payload.title, {
      body: payload.body,
      icon: '/web-app-manifest-192x192.png',
      badge: '/favicon-96x96.png',
      data: { url: payload.url },
      tag: 'besidka-response-ready',
    })
  })

  it('suppresses the notification when a client is focused', async () => {
    matchAll.mockResolvedValue([{ focused: true }])

    const payload = {
      title: 'Response ready',
      body: 'Your generation finished',
      url: '/chats/abc',
    }
    const event = createFakePushEvent(payload)

    handlePush(event as unknown as Parameters<typeof handlePush>[0])
    await waitUntilPromise

    expect(showNotification).not.toHaveBeenCalled()
  })
})

describe('handleNotificationClick', () => {
  let openWindow: ReturnType<typeof vi.fn>
  let matchAll: ReturnType<typeof vi.fn>
  let fakeIndexedDb: ReturnType<typeof createFakeIndexedDb>
  let waitUntilPromise: Promise<unknown> | undefined

  beforeEach(() => {
    fakeIndexedDb = createFakeIndexedDb()
    openWindow = vi.fn(() => Promise.resolve(null))
    matchAll = vi.fn(() => Promise.resolve([]))
    waitUntilPromise = undefined

    vi.stubGlobal('self', {
      clients: { matchAll, openWindow },
    })
    vi.stubGlobal('indexedDB', fakeIndexedDb)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createFakeNotificationClickEvent(url: unknown) {
    return {
      notification: {
        close: vi.fn(),
        data: url === undefined ? undefined : { url },
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromise = promise
      }),
    }
  }

  it('closes the notification unconditionally', () => {
    const event = createFakeNotificationClickEvent('/chats/abc')

    handleNotificationClick(
      event as unknown as Parameters<typeof handleNotificationClick>[0],
    )

    expect(event.notification.close).toHaveBeenCalled()
  })

  it('posts the target url to a running client and focuses it', async () => {
    const focus = vi.fn(() => Promise.resolve())
    const postMessage = vi.fn()
    const client = createFakeWindowClient({
      focused: true,
      postMessage,
      focus,
    })

    matchAll.mockResolvedValue([client])

    const event = createFakeNotificationClickEvent('/chats/abc')

    handleNotificationClick(
      event as unknown as Parameters<typeof handleNotificationClick>[0],
    )
    await waitUntilPromise

    expect(postMessage).toHaveBeenCalledWith({
      type: 'besidka:push-navigate',
      url: '/chats/abc',
    })
    expect(focus).toHaveBeenCalled()
  })

  it('falls back to / when the notification carries no url', async () => {
    const postMessage = vi.fn()
    const client = createFakeWindowClient({ focused: true, postMessage })

    matchAll.mockResolvedValue([client])

    const event = createFakeNotificationClickEvent(undefined)

    handleNotificationClick(
      event as unknown as Parameters<typeof handleNotificationClick>[0],
    )
    await waitUntilPromise

    expect(postMessage).toHaveBeenCalledWith({
      type: 'besidka:push-navigate',
      url: '/',
    })
  })

  it('persists the target to IndexedDB before opening a window on cold start', async () => {
    matchAll.mockResolvedValue([])

    const event = createFakeNotificationClickEvent('/shared/abc')

    handleNotificationClick(
      event as unknown as Parameters<typeof handleNotificationClick>[0],
    )
    await waitUntilPromise
    await flushPromises()

    expect(fakeIndexedDb.putCalls).toHaveLength(1)
    expect(fakeIndexedDb.putCalls[0]?.url).toBe('/shared/abc')
    expect(typeof fakeIndexedDb.putCalls[0]?.savedAt).toBe('number')
    expect(openWindow).toHaveBeenCalledWith('/shared/abc')
  })

  it('does nothing when there is no client and no openWindow support', async () => {
    matchAll.mockResolvedValue([])
    vi.stubGlobal('self', { clients: { matchAll } })

    const event = createFakeNotificationClickEvent('/shared/abc')

    handleNotificationClick(
      event as unknown as Parameters<typeof handleNotificationClick>[0],
    )
    await waitUntilPromise
    await flushPromises()

    expect(fakeIndexedDb.putCalls).toHaveLength(0)
  })
})
