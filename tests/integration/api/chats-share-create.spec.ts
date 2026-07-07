import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  durationToExpiresAt: vi.fn(),
  syncChatShareFiles: vi.fn(),
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
  durationToExpiresAt: mocks.durationToExpiresAt,
  syncChatShareFiles: mocks.syncChatShareFiles,
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/share/index.post'
  )

  return module.default
}

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'

interface ChatFixture {
  id: string
  slug: string
  userId: number
}

function createDb(
  chatFixture: ChatFixture | null,
  shareRow: { id: string, slug: string },
) {
  const chatsFindFirst = vi.fn(async (
    { where }: { where: Record<string, unknown> },
  ) => {
    if (!chatFixture) {
      return undefined
    }

    const matches = Object.entries(where).every(([key, value]) => {
      return (chatFixture as unknown as Record<string, unknown>)[key]
        === value
    })

    return matches ? { id: chatFixture.id } : undefined
  })

  const onConflictDoUpdate = vi.fn(() => ({
    returning: vi.fn(() => ({
      get: vi.fn(async () => shareRow),
    })),
  }))
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate,
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  const db = {
    query: {
      chats: {
        findFirst: chatsFindFirst,
      },
    },
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  }

  return {
    db,
    chatsFindFirst,
    insertValues,
    onConflictDoUpdate,
    updateSet,
    updateWhere,
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    duration: 'week',
    indexable: false,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    ...overrides,
  }
}

describe('chat share create API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))

    mocks.durationToExpiresAt.mockReturnValue(
      new Date('2026-07-13T00:00:00.000Z'),
    )
    mocks.syncChatShareFiles.mockResolvedValue(undefined)
  })

  it('rejects unauthenticated requests', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const { db, insertValues } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      { id: 'share-1', slug: 'share-slug' },
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG },
      body: createBody(),
    } as never)).rejects.toThrow('Unauthorized')
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a non-owner and does not create a share', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '2' },
    }))

    const handler = await getHandler()
    const { db, insertValues } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      { id: 'share-1', slug: 'share-slug' },
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG },
      body: createBody(),
    } as never)).rejects.toThrow('Chat not found')
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('creates a share on success and always resets revoked to false', async () => {
    const handler = await getHandler()
    const {
      db,
      insertValues,
      onConflictDoUpdate,
      updateSet,
      updateWhere,
    } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      { id: 'share-1', slug: 'share-slug' },
    )

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: CHAT_SLUG },
      body: createBody({ duration: 'week' }),
    } as never)

    expect(response).toEqual({
      slug: 'share-slug',
      url: '/shared/share-slug',
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      indexable: false,
      showFiles: true,
      showMetadata: true,
      showAuthorAvatar: true,
      allowBranch: true,
    })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
    }))
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ revoked: false }),
    }))
    expect(updateSet).toHaveBeenCalledWith({ shared: true })
    expect(updateWhere).toHaveBeenCalledTimes(1)
    expect(mocks.syncChatShareFiles).toHaveBeenCalledWith(
      'share-1',
      'chat-1',
      1,
      true,
      expect.anything(),
    )
  })
})
