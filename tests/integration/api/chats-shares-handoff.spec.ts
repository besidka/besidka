import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveActiveShareBySlug: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/chats/share', () => ({
  resolveActiveShareBySlug: mocks.resolveActiveShareBySlug,
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/shares/[slug]/handoff.post'
  )

  return module.default
}

function createDb(overrides: {
  subscriptions?: { id: string }[]
} = {}) {
  return {
    query: {
      pushSubscriptions: {
        findMany: vi.fn(async () => {
          return overrides.subscriptions ?? [{ id: 'subscription-1' }]
        }),
      },
    },
  }
}

function createWaitUntilEvent(base: Record<string, unknown>) {
  const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

  return {
    event: {
      ...base,
      context: {
        cloudflare: { context: { waitUntil } },
      },
    },
    waitUntil,
  }
}

describe('shared chat handoff API', () => {
  let sendPushNotificationToUserMock: ReturnType<typeof vi.fn>
  let kvGetMock: ReturnType<typeof vi.fn>
  let kvPutMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getHeader', vi.fn(() => 'same-origin'))

    kvGetMock = vi.fn(async () => null)
    kvPutMock = vi.fn(async () => undefined)
    vi.stubGlobal('useKV', () => ({
      get: kvGetMock,
      put: kvPutMock,
    }))
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
    vi.stubGlobal('buildVapidSubject', vi.fn((subject: string) => {
      return subject ? `mailto:${subject}` : undefined
    }))
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
      vapidSubject: 'push@besidka.com',
      vapidPrivateKey: 'private-key',
      public: {
        vapidPublicKey: 'public-key',
      },
    })))

    vi.stubGlobal('isPushConfigured', vi.fn(() => true))

    sendPushNotificationToUserMock = vi.fn(async () => ({
      sent: 1,
      staleRemoved: 0,
      rejected: 0,
      failed: 0,
      failures: [],
    }))
    vi.stubGlobal(
      'sendPushNotificationToUser',
      sendPushNotificationToUserMock,
    )

    mocks.resolveActiveShareBySlug.mockResolvedValue({
      slug: 'share-slug',
      chatId: 'chat-1',
      allowBranch: true,
    })
  })

  it('sends a push with the shared page url and reports sent', async () => {
    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as never)

    expect(response).toEqual({ sent: true, reason: null })
    expect(sendPushNotificationToUserMock).toHaveBeenCalledWith(
      db,
      1,
      {
        title: 'Shared chat ready',
        body: 'Tap to open the shared chat in Besidka.',
        url: '/shared/share-slug',
      },
      expect.anything(),
      expect.anything(),
    )
    expect(kvPutMock).toHaveBeenCalledWith(
      'chat-share-handoff:1',
      '1',
      { expirationTtl: 60 },
    )
  })

  it('reports not-configured when VAPID keys are missing', async () => {
    vi.stubGlobal('isPushConfigured', vi.fn(() => false))

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as never)

    expect(response).toEqual({ sent: false, reason: 'not-configured' })
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
    expect(kvPutMock).not.toHaveBeenCalled()
  })

  it('reports delivery-failed with details when nothing was accepted', async () => {
    const failures = [{
      host: 'web.push.apple.com',
      status: 403,
      reason: '{"reason":"VapidPkHashMismatch"}',
    }]

    sendPushNotificationToUserMock.mockResolvedValue({
      sent: 0,
      staleRemoved: 1,
      rejected: 0,
      failed: 1,
      failures,
    })

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as never)

    expect(response).toEqual({
      sent: false,
      reason: 'delivery-failed',
      failures,
    })
    expect(kvPutMock).not.toHaveBeenCalled()
  })

  it('rejects cross-site requests', async () => {
    vi.stubGlobal('getHeader', vi.fn(() => 'cross-site'))

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow('Forbidden')
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('throws 429 while the per-user cooldown is active', async () => {
    kvGetMock.mockResolvedValue('1')

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow(
      'Notification already sent',
    )
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
    expect(kvPutMock).not.toHaveBeenCalled()
  })

  it('reports not sent when the user has no push subscriptions', async () => {
    const handler = await getHandler()
    const db = createDb({ subscriptions: [] })
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as never)

    expect(response).toEqual({ sent: false, reason: 'no-subscriptions' })
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('still sends without a waitUntil context', async () => {
    const handler = await getHandler()
    const db = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'share-slug' },
      context: {},
    } as never)

    expect(response).toEqual({ sent: true, reason: null })
    expect(sendPushNotificationToUserMock).toHaveBeenCalledWith(
      db,
      1,
      expect.anything(),
      expect.anything(),
      undefined,
    )
  })

  it('throws 404 when the share is missing or inactive', async () => {
    mocks.resolveActiveShareBySlug.mockResolvedValue(null)

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow(
      'Shared chat not found',
    )
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const db = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow('Unauthorized')
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })
})
