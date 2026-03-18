import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
  refreshProjectActivityAt: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
}))

vi.mock('~~/server/utils/projects/activity', () => ({
  refreshProjectActivityAt: mocks.refreshProjectActivityAt,
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/branch/index.post'
  )

  return module.default
}

function createMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    publicId: `public-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text: `Message ${index + 1}` }],
    tools: index % 2 === 0 ? ['web_search'] : [],
    reasoning: 'off',
  }))
}

interface PreparedInsert {
  __values: unknown
}

function createDb(overrides: {
  projectId?: string | null
  messages?: ReturnType<typeof createMessages>
} = {}) {
  const batchedQueries: PreparedInsert[][] = []

  const insertValues = vi.fn((value: unknown) => {
    const query: PreparedInsert = { __values: value }

    return {
      returning: vi.fn(() => ({
        get: vi.fn(async () => ({
          id: 'new-chat',
          slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
        })),
      })),
      ...query,
    }
  })

  const db = {
    query: {
      chats: {
        findFirst: vi.fn(async () => ({
          id: 'chat-1',
          title: 'Test Chat',
          projectId: overrides.projectId ?? null,
          messages: overrides.messages ?? createMessages(1),
        })),
      },
    },
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    batch: vi.fn(async (queries: PreparedInsert[]) => {
      batchedQueries.push(queries)

      return queries.map(() => undefined)
    }),
  }

  return { db, batchedQueries, insertValues }
}

describe('chat branch API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal(
      'defineEventHandler',
      (handler: unknown) => handler,
    )
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }) => {
      const exception = new Error(
        input.statusMessage || 'Error',
      )

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal(
      'useUserSession',
      vi.fn().mockResolvedValue({
        user: { id: '1' },
      }),
    )
    vi.stubGlobal(
      'useUnauthorizedError',
      vi.fn(() => {
        throw new Error('Unauthorized')
      }),
    )
  })

  it('refreshes project activity and memory when branching a project chat', async () => {
    const handler = await getHandler()
    const { db } = createDb({ projectId: 'project-1' })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-1',
      },
    } as never)

    expect(response).toEqual({
      slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    })
    expect(
      mocks.refreshProjectActivityAt,
    ).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
    expect(
      mocks.markProjectsMemoryStale,
    ).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })

  it('batches message inserts via db.batch()', async () => {
    const handler = await getHandler()
    const messages = createMessages(3)
    const { db, batchedQueries } = createDb({ messages })

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-3',
      },
    } as never)

    expect(db.batch).toHaveBeenCalledOnce()
    expect(batchedQueries[0]).toHaveLength(3)
  })

  it('inserts messages with correct fields and without id', async () => {
    const handler = await getHandler()
    const messages = createMessages(2)
    const { db, insertValues } = createDb({ messages })

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-2',
      },
    } as never)

    const messageInsertCalls = insertValues.mock.calls.filter(
      ([value]) => {
        return value.role === 'user'
          || value.role === 'assistant'
      },
    )

    expect(messageInsertCalls[0][0]).toEqual({
      chatId: 'new-chat',
      role: 'user',
      parts: [{ type: 'text', text: 'Message 1' }],
      tools: ['web_search'],
      reasoning: 'off',
    })
    expect(messageInsertCalls[1][0]).toEqual({
      chatId: 'new-chat',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Message 2' }],
      tools: [],
      reasoning: 'off',
    })

    for (const [value] of messageInsertCalls) {
      expect(value).not.toHaveProperty('id')
      expect(value).not.toHaveProperty('publicId')
    }
  })

  it('copies only messages up to the branch point', async () => {
    const handler = await getHandler()
    const messages = createMessages(5)
    const { db, batchedQueries } = createDb({ messages })

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-3',
      },
    } as never)

    expect(batchedQueries[0]).toHaveLength(3)
  })

  it('branches at the first message', async () => {
    const handler = await getHandler()
    const messages = createMessages(4)
    const { db, batchedQueries, insertValues } = createDb({
      messages,
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-1',
      },
    } as never)

    expect(batchedQueries[0]).toHaveLength(1)

    const messageInsertCalls = insertValues.mock.calls.filter(
      ([value]) => value.role === 'user',
    )

    expect(messageInsertCalls[0][0]).toEqual({
      chatId: 'new-chat',
      role: 'user',
      parts: [{ type: 'text', text: 'Message 1' }],
      tools: ['web_search'],
      reasoning: 'off',
    })
  })

  it('handles branching chat without project', async () => {
    const handler = await getHandler()
    const { db } = createDb({ projectId: null })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'message-1',
      },
    } as never)

    expect(response).toEqual({
      slug: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    })
    expect(
      mocks.refreshProjectActivityAt,
    ).toHaveBeenCalledWith(
      [null],
      1,
      db,
    )
    expect(
      mocks.markProjectsMemoryStale,
    ).toHaveBeenCalledWith(
      [null],
      1,
      db,
    )
  })

  it('finds branch point by publicId', async () => {
    const handler = await getHandler()
    const messages = createMessages(3)
    const { db, batchedQueries } = createDb({ messages })

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: {
        chatSlug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        messageId: 'public-2',
      },
    } as never)

    expect(batchedQueries[0]).toHaveLength(2)
  })
})
