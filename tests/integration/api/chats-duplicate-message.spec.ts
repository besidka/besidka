import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({
  createUIMessageStream: ({ execute }: { execute: Function }) => {
    const writer = { write: vi.fn(), merge: vi.fn() }
    const ready = execute({ writer })

    return { writer, ready }
  },
  createUIMessageStreamResponse: (
    { stream }: { stream: unknown },
  ) => stream,
  streamText: vi.fn(() => ({
    consumeStream: vi.fn(),
    toUIMessageStream: vi.fn(() => ({})),
  })),
  smoothStream: vi.fn(() => undefined),
  convertToModelMessages: vi.fn(
    async (messages: unknown) => messages,
  ),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: vi.fn() }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
    fix?: string
    code?: string
    providerRequestId?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  sanitizeMessagesForModelContext: vi.fn(
    (messages: unknown) => messages,
  ),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

function createDb(overrides: {
  messages?: Array<{
    id: string
    publicId: string
    role: string
    parts: unknown[]
    tools: string[]
    reasoning: string
    createdAt: Date
  }>
} = {}) {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const insertCall = vi.fn(() => ({ values: insertValues }))
  const transaction = vi.fn(async (callback) => {
    return await callback({
      insert: insertCall,
      update: vi.fn(() => ({
        set: updateSet,
      })),
    })
  })

  insertValues.mockImplementation(() => ({
    returning: () => ({
      get: insertGet,
    }),
  }))

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: overrides.messages ?? [],
          })),
        },
      },
      insert: insertCall,
      transaction,
      update: vi.fn(() => ({ set: updateSet })),
      delete: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    },
    insertValues,
    insertGet,
    transaction,
    updateSet,
    updateWhere,
  }
}

describe('chat duplicate message detection', () => {
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
    }) => {
      const exception = new Error(
        input.statusMessage || 'Error',
      )

      Object.assign(exception, input)

      return exception
    })
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
    vi.stubGlobal(
      'useUserSession',
      vi.fn().mockResolvedValue({ user: { id: '1' } }),
    )
    vi.stubGlobal(
      'validateMessageFilePolicy',
      vi.fn(async () => undefined),
    )
    vi.stubGlobal(
      'convertFilesForAI',
      vi.fn(async (messages: unknown) => ({
        messages,
        missingFiles: [],
      })),
    )
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-5-mini' },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
  })

  it('detects duplicate by message ID even when reasoning differs', async () => {
    const handler = await getHandler()
    const existingMessage = {
      id: 'db-id-1',
      publicId: 'public-id-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      tools: ['web_search'] as string[],
      reasoning: 'off',
      createdAt: new Date(),
    }
    const { db, insertValues, updateSet } = createDb({
      messages: [existingMessage],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search'],
        reasoning: 'medium',
        messages: [{
          id: 'public-id-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }],
      },
    } as any)

    const userInserts = insertValues.mock.calls.filter(
      ([value]) => value.role === 'user',
    )

    expect(userInserts).toHaveLength(0)
    expect(updateSet).toHaveBeenCalledWith({
      publicId: 'public-id-1',
    })
  })

  it('detects duplicate by message ID even when tools differ', async () => {
    const handler = await getHandler()
    const existingMessage = {
      id: 'db-id-1',
      publicId: 'public-id-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      tools: ['web_search'] as string[],
      reasoning: 'off',
      createdAt: new Date(),
    }
    const { db, insertValues, updateSet } = createDb({
      messages: [existingMessage],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [{
          id: 'public-id-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }],
      },
    } as any)

    const userInserts = insertValues.mock.calls.filter(
      ([value]) => value.role === 'user',
    )

    expect(userInserts).toHaveLength(0)
    expect(updateSet).toHaveBeenCalledWith({
      publicId: 'public-id-1',
    })
  })

  it('inserts new message when ID and content both differ', async () => {
    const handler = await getHandler()
    const existingMessage = {
      id: 'db-id-1',
      publicId: 'public-id-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      tools: [] as string[],
      reasoning: 'off',
      createdAt: new Date(),
    }
    const { db, insertValues, updateSet } = createDb({
      messages: [existingMessage],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [{
          id: 'new-message-id',
          role: 'user',
          parts: [{ type: 'text', text: 'Different' }],
        }],
      },
    } as any)

    const userInserts = insertValues.mock.calls.filter(
      ([value]) => value.role === 'user',
    )

    expect(userInserts).toHaveLength(1)
    expect(userInserts[0][0]).toEqual(
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', text: 'Different' }],
        publicId: 'new-message-id',
      }),
    )
    expect(updateSet).not.toHaveBeenCalledWith({
      publicId: 'new-message-id',
    })
  })
})
