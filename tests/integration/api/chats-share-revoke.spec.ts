import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/share/revoke.post'
  )

  return module.default
}

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'

interface ChatFixture {
  id: string
  slug: string
  userId: number
}

interface ShareRowFixture {
  id: string
  chatId: string
}

function createDb(
  chatFixture: ChatFixture | null,
  shares: ShareRowFixture[],
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

  const deleteReturning = vi.fn(async () => {
    if (!chatFixture) {
      return []
    }

    const removed = shares.filter((share) => {
      return share.chatId === chatFixture.id
    })
    const remaining = shares.filter((share) => {
      return share.chatId !== chatFixture.id
    })

    shares.length = 0
    shares.push(...remaining)

    return removed.map(share => ({ id: share.id }))
  })
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  const db = {
    query: {
      chats: {
        findFirst: chatsFindFirst,
      },
    },
    delete: vi.fn(() => ({ where: deleteWhere })),
    update: vi.fn(() => ({ set: updateSet })),
  }

  return {
    db,
    chatsFindFirst,
    deleteWhere,
    deleteReturning,
    updateSet,
    updateWhere,
  }
}

describe('chat share revoke API', () => {
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
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
  })

  it('rejects a non-owner and leaves the share active', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '2' },
    }))

    const handler = await getHandler()
    const shares: ShareRowFixture[] = [
      { id: 'share-1', chatId: 'chat-1' },
    ]
    const { db, deleteWhere } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      shares,
    )

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: CHAT_SLUG },
    } as never)).rejects.toThrow('Chat not found')
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(shares).toEqual([{ id: 'share-1', chatId: 'chat-1' }])
  })

  it('revokes the share and marks the chat as unshared', async () => {
    const handler = await getHandler()
    const shares: ShareRowFixture[] = [
      { id: 'share-1', chatId: 'chat-1' },
    ]
    const { db, updateSet, updateWhere } = createDb(
      { id: 'chat-1', slug: CHAT_SLUG, userId: 1 },
      shares,
    )

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: CHAT_SLUG },
    } as never)

    expect(response).toEqual({ ok: true })
    expect(shares).toEqual([])
    expect(updateSet).toHaveBeenCalledWith({ shared: false })
    expect(updateWhere).toHaveBeenCalledTimes(1)
  })
})
