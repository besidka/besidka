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
    '../../../server/api/v1/chats/shares/[slug]/branch.post'
  )

  return module.default
}

function createMessages() {
  return [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      tools: [],
      reasoning: 'off',
    },
    {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi there' }],
      tools: [],
      reasoning: 'off',
    },
  ]
}

function createDb(overrides: {
  messages?: ReturnType<typeof createMessages>
} = {}) {
  const insertValues = vi.fn(() => ({
    returning: vi.fn(() => ({
      get: vi.fn(async () => ({
        id: 'new-chat-id',
        slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
      })),
    })),
  }))

  const db = {
    query: {
      chats: {
        findFirst: vi.fn(async () => ({
          id: 'chat-1',
          title: 'Test Chat',
          messages: overrides.messages ?? createMessages(),
        })),
      },
    },
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    batch: vi.fn(async (queries: unknown[]) => {
      return queries.map(() => undefined)
    }),
  }

  return { db, insertValues }
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

describe('shared chat branch API', () => {
  let sendPushNotificationToUserMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getHeader', vi.fn(() => 'same-origin'))
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
    vi.stubGlobal('useKV', vi.fn(() => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    })))
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

    sendPushNotificationToUserMock = vi.fn(async () => undefined)
    vi.stubGlobal(
      'sendPushNotificationToUser',
      sendPushNotificationToUserMock,
    )

    mocks.resolveActiveShareBySlug.mockResolvedValue({
      chatId: 'chat-1',
      allowBranch: true,
    })
  })

  it('sends a generic push notification via waitUntil after branching', async () => {
    const handler = await getHandler()
    const { db } = createDb()
    const { event, waitUntil } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as never)

    expect(response).toEqual({ slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(sendPushNotificationToUserMock).toHaveBeenCalledWith(
      db,
      1,
      {
        title: 'Added to your chats',
        body: 'Your shared chat is ready in Besidka.',
        url: '/chats/01ARZ3NDEKTSV4RRFFQ69G5FB0',
      },
      expect.anything(),
      expect.anything(),
    )
  })

  it('does not send a push notification without a waitUntil context', async () => {
    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'share-slug' },
      context: {},
    } as never)

    expect(response).toEqual({ slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0' })
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('rejects cross-site requests', async () => {
    vi.stubGlobal('getHeader', vi.fn(() => 'cross-site'))

    const handler = await getHandler()
    const { db } = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow('Forbidden')
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('does not create a chat or send a push when branching is disallowed', async () => {
    mocks.resolveActiveShareBySlug.mockResolvedValue({
      chatId: 'chat-1',
      allowBranch: false,
    })

    const handler = await getHandler()
    const { db } = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler(event as never)).rejects.toThrow()
    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('strips file parts from branched messages when the share hides files', async () => {
    mocks.resolveActiveShareBySlug.mockResolvedValue({
      chatId: 'chat-1',
      allowBranch: true,
      showFiles: false,
    })

    const handler = await getHandler()
    const { db, insertValues } = createDb({
      messages: [{
        role: 'user',
        parts: [
          { type: 'text', text: 'Hello' },
          { type: 'file', url: '/files/a.png', mediaType: 'image/png' },
        ],
      }],
    })
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await handler(event as never)

    expect(insertValues).toHaveBeenCalledWith({
      chatId: 'new-chat-id',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    })
  })

  it('keeps file parts in branched messages when the share allows files', async () => {
    mocks.resolveActiveShareBySlug.mockResolvedValue({
      chatId: 'chat-1',
      allowBranch: true,
      showFiles: true,
    })

    const filePart = {
      type: 'file',
      url: '/files/a.png',
      mediaType: 'image/png',
    }

    const handler = await getHandler()
    const { db, insertValues } = createDb({
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }, filePart],
      }],
    })
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await handler(event as never)

    expect(insertValues).toHaveBeenCalledWith({
      chatId: 'new-chat-id',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }, filePart],
    })
  })

  it('never forwards the source tools or reasoning to branched messages', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: 'share-slug' },
    })

    vi.stubGlobal('useDb', () => db)

    await handler(event as never)

    expect(insertValues).toHaveBeenCalledWith({
      chatId: 'new-chat-id',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    })
    expect(insertValues).toHaveBeenCalledWith({
      chatId: 'new-chat-id',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi there' }],
    })
  })
})
