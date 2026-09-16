import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHistoryChat,
} from '../../setup/helpers/history-fixtures'
import {
  MAX_SEARCH_RESULTS,
} from '../../../server/utils/chats/history/search'
import { createSearchCursor } from '../../../server/utils/chats/history/search-cursor'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  findChatsMatchingMessageContent: vi.fn(async () => []),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      status: input.status,
      why: input.why,
      message: input.message,
    })

    return exception
  },
}))

vi.mock(
  '~~/server/utils/chats/history/search',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('~~/server/utils/chats/history/search')
    >()

    return {
      ...actual,
      findChatsMatchingMessageContent: mocks.findChatsMatchingMessageContent,
    }
  },
)

async function getHistoryHandler() {
  const module = await import('../../../server/api/v1/chats/history/index.get')

  return module.default
}

function createSelectChain<T>(result?: T) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => {
      if (result !== undefined) {
        return Promise.resolve(result)
      }

      return chain
    }),
  }

  return chain
}

function withDateFields<T extends {
  activityAt: string
  createdAt: string
  pinnedAt: string | null
}>(chat: T) {
  return {
    ...chat,
    activityAt: new Date(chat.activityAt),
    createdAt: new Date(chat.createdAt),
    pinnedAt: chat.pinnedAt ? new Date(chat.pinnedAt) : null,
  }
}

describe('chat history content search', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.findChatsMatchingMessageContent.mockResolvedValue([])

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('behaves exactly as today when no search param is present', async () => {
    const handler = await getHistoryHandler()
    const pinnedChat = withDateFields(createHistoryChat({
      id: 'chat-pinned',
      pinnedAt: '2026-03-11T08:00:00.000Z',
    }))
    const firstChat = withDateFields(createHistoryChat({
      id: 'chat-1',
      activityAt: '2026-03-11T10:00:00.000Z',
    }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[pinnedChat], [firstChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({ query: {} } as never)

    expect(response.pinned).toEqual([pinnedChat])
    expect(response.chats).toEqual([firstChat])
    expect(response.nextCursor).toBeNull()
    expect(mocks.findChatsMatchingMessageContent).not.toHaveBeenCalled()
  })

  it('merges title matches first, then content-only matches', async () => {
    const handler = await getHistoryHandler()
    const titleOnlyChat = withDateFields(createHistoryChat({
      id: 'chat-title-only',
      title: 'Roadmap notes',
    }))
    const contentOnlyChat = withDateFields(createHistoryChat({
      id: 'chat-content-only',
      title: 'Untitled',
    }))
    const titleSelectChain = createSelectChain()
    const pinnedSelectChain = createSelectChain()
    const contentFetchChain = createSelectChain([contentOnlyChat])
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(titleSelectChain)
        .mockReturnValueOnce(pinnedSelectChain)
        .mockReturnValueOnce(contentFetchChain),
      batch: vi.fn(async () => {
        return [[], [titleOnlyChat]]
      }),
    }

    mocks.findChatsMatchingMessageContent.mockResolvedValue([
      {
        chatId: 'chat-content-only',
        messageRowId: 5,
        score: -1,
        snippet: 'a content snippet',
      },
    ])

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap' },
    } as never)

    expect(response.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-title-only',
      'chat-content-only',
    ])
    expect(response.chats[0].matchedIn).toBe('title')
    expect(response.chats[1].matchedIn).toBe('content')
    expect(response.chats[1].snippet).toBe('a content snippet')
  })

  it('marks a chat matched by both legs as "both" with its snippet', async () => {
    const handler = await getHistoryHandler()
    const bothChat = withDateFields(createHistoryChat({
      id: 'chat-both',
      title: 'Roadmap notes',
    }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], [bothChat]]
      }),
    }

    mocks.findChatsMatchingMessageContent.mockResolvedValue([
      {
        chatId: 'chat-both',
        messageRowId: 7,
        score: -2,
        snippet: 'both-leg snippet',
      },
    ])

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap' },
    } as never)

    expect(response.chats).toHaveLength(1)
    expect(response.chats[0].matchedIn).toBe('both')
    expect(response.chats[0].snippet).toBe('both-leg snippet')
  })

  it(
    'surfaces a pinned chat matched only by content in chats, not pinned',
    async () => {
      const handler = await getHistoryHandler()
      const pinnedContentOnlyChat = withDateFields(createHistoryChat({
        id: 'chat-pinned-content-only',
        title: 'Untitled',
        pinnedAt: '2026-03-11T08:00:00.000Z',
      }))
      const contentFetchChain = createSelectChain([pinnedContentOnlyChat])
      const db = {
        select: vi.fn()
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(contentFetchChain),
        batch: vi.fn(async () => {
          return [[], []]
        }),
      }

      mocks.findChatsMatchingMessageContent.mockResolvedValue([
        {
          chatId: 'chat-pinned-content-only',
          messageRowId: 9,
          score: -1,
          snippet: 'pinned content snippet',
        },
      ])

      vi.stubGlobal('useDb', () => db)
      vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

      const response = await handler({
        query: { search: 'anything' },
      } as never)

      expect(response.pinned).toEqual([])
      expect(response.chats).toHaveLength(1)
      expect(response.chats[0].id).toBe('chat-pinned-content-only')
      expect(response.chats[0].matchedIn).toBe('content')
      expect(response.chats[0].pinnedAt).toBeInstanceOf(Date)
    },
  )

  it('returns pinned: [] when the search cursor offset is > 0', async () => {
    const handler = await getHistoryHandler()
    const titleChat = withDateFields(createHistoryChat({ id: 'chat-1' }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], [titleChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap', cursor: createSearchCursor(5) },
    } as never)

    expect(response.pinned).toEqual([])
    expect(db.batch).toHaveBeenCalledTimes(1)
  })

  it(
    'does not re-surface a pinned+title+content chat as a duplicate '
    + 'content-only hit on a later search page',
    async () => {
      const handler = await getHistoryHandler()
      const pinnedChat = withDateFields(createHistoryChat({
        id: 'chat-pinned-both',
        title: 'Roadmap notes',
        pinnedAt: '2026-03-11T08:00:00.000Z',
      }))
      const contentChatA = withDateFields(createHistoryChat({
        id: 'chat-content-a',
        title: 'Untitled',
      }))
      const contentChatB = withDateFields(createHistoryChat({
        id: 'chat-content-b',
        title: 'Untitled',
      }))

      mocks.findChatsMatchingMessageContent.mockResolvedValue([
        {
          chatId: 'chat-pinned-both',
          messageRowId: 1,
          score: -9,
          snippet: 'pinned+both snippet',
        },
        {
          chatId: 'chat-content-a',
          messageRowId: 2,
          score: -5,
          snippet: 'content a snippet',
        },
        {
          chatId: 'chat-content-b',
          messageRowId: 3,
          score: -3,
          snippet: 'content b snippet',
        },
      ])

      const db = {
        select: vi.fn()
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(
            createSelectChain([pinnedChat, contentChatA, contentChatB]),
          )
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(createSelectChain())
          .mockReturnValueOnce(
            createSelectChain([pinnedChat, contentChatA, contentChatB]),
          ),
        batch: vi.fn()
          .mockResolvedValueOnce([[pinnedChat], []])
          .mockResolvedValueOnce([[{ id: 'chat-pinned-both' }], []]),
      }

      vi.stubGlobal('useDb', () => db)
      vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

      const firstPage = await handler({
        query: { search: 'roadmap', limit: '1' },
      } as never)

      expect(firstPage.pinned.map((chat: { id: string }) => chat.id))
        .toEqual(['chat-pinned-both'])
      expect(firstPage.chats.map((chat: { id: string }) => chat.id))
        .not.toContain('chat-pinned-both')
      expect(firstPage.nextCursor).not.toBeNull()

      const secondPage = await handler({
        query: {
          search: 'roadmap',
          limit: '1',
          cursor: firstPage.nextCursor,
        },
      } as never)

      expect(secondPage.pinned).toEqual([])
      expect(secondPage.chats.map((chat: { id: string }) => chat.id))
        .not.toContain('chat-pinned-both')
      expect(secondPage.nextCursor).toBeNull()

      const allChatIdsAcrossBothPages = [
        ...firstPage.pinned.map((chat: { id: string }) => chat.id),
        ...firstPage.chats.map((chat: { id: string }) => chat.id),
        ...secondPage.pinned.map((chat: { id: string }) => chat.id),
        ...secondPage.chats.map((chat: { id: string }) => chat.id),
      ]
      const pinnedBothOccurrences = allChatIdsAcrossBothPages.filter((id) => {
        return id === 'chat-pinned-both'
      })

      expect(pinnedBothOccurrences).toHaveLength(1)
    },
  )

  it('nextCursor round-trips through createSearchCursor / parseSearchCursor', async () => {
    const handler = await getHistoryHandler()
    const firstChat = withDateFields(createHistoryChat({ id: 'chat-1' }))
    const secondChat = withDateFields(createHistoryChat({ id: 'chat-2' }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], [firstChat, secondChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap', limit: '1' },
    } as never)

    expect(response.nextCursor).toBe(createSearchCursor(1))
  })

  it('sets searchCapped: true when merged results hit MAX_SEARCH_RESULTS', async () => {
    const handler = await getHistoryHandler()
    const titleChats = Array.from(
      { length: MAX_SEARCH_RESULTS },
      (_, index) => {
        return withDateFields(createHistoryChat({ id: `chat-${index}` }))
      },
    )
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], titleChats]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap', limit: '100' },
    } as never)

    expect(response.searchCapped).toBe(true)
  })

  it('skips the content leg when searchIn=title', async () => {
    const handler = await getHistoryHandler()
    const titleChat = withDateFields(createHistoryChat({ id: 'chat-1' }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], [titleChat]]
      }),
    }

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    await handler({
      query: { search: 'roadmap', searchIn: 'title' },
    } as never)

    expect(mocks.findChatsMatchingMessageContent).not.toHaveBeenCalled()
  })

  it('skips the title/pinned legs when searchIn=content', async () => {
    const handler = await getHistoryHandler()
    const contentOnlyChat = withDateFields(createHistoryChat({
      id: 'chat-content-only',
    }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain([contentOnlyChat])),
      batch: vi.fn(),
    }

    mocks.findChatsMatchingMessageContent.mockResolvedValue([
      {
        chatId: 'chat-content-only',
        messageRowId: 3,
        score: -1,
        snippet: 'snippet',
      },
    ])

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap', searchIn: 'content' },
    } as never)

    expect(db.batch).not.toHaveBeenCalled()
    expect(response.pinned).toEqual([])
    expect(response.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-content-only',
    ])
  })

  it('degrades to title-only results when the content leg throws', async () => {
    const handler = await getHistoryHandler()
    const titleChat = withDateFields(createHistoryChat({ id: 'chat-1' }))
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createSelectChain())
        .mockReturnValueOnce(createSelectChain()),
      batch: vi.fn(async () => {
        return [[], [titleChat]]
      }),
    }

    mocks.findChatsMatchingMessageContent.mockRejectedValue(
      new Error('fts5 boom'),
    )

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    const response = await handler({
      query: { search: 'roadmap' },
    } as never)

    expect(response.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-1',
    ])
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      messageSearchContent: expect.objectContaining({
        action: 'content-leg-failed',
      }),
    }))
  })

  it('returns 401 for an unauthenticated request', async () => {
    const handler = await getHistoryHandler()

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('getQuery', (event: { query: unknown }) => event.query)

    await expect(handler({
      query: { search: 'roadmap' },
    } as never)).rejects.toThrow()
  })
})
