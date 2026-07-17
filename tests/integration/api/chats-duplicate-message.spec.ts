import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      const chunks = [
        {
          type: 'start',
          messageId,
        },
        {
          type: 'text-start',
          id: 'text-1',
        },
        {
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hi',
        },
        {
          type: 'text-end',
          id: 'text-1',
        },
        {
          type: 'finish',
        },
      ]

      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      return new ReadableStream({
        start(controller) {
          const pendingMerges: Array<Promise<void>> = []
          const writer = {
            write: vi.fn((chunk: unknown) => {
              controller.enqueue(chunk)
            }),
            merge: vi.fn((stream: ReadableStream<unknown>) => {
              const pendingMerge = (async () => {
                const reader = stream.getReader()

                try {
                  while (true) {
                    const { done, value } = await reader.read()

                    if (done) {
                      break
                    }

                    controller.enqueue(value)
                  }
                } finally {
                  reader.releaseLock()
                }
              })()

              pendingMerges.push(pendingMerge)
            }),
          }

          Promise.resolve(execute({ writer }))
            .then(async () => {
              await Promise.all(pendingMerges)
              controller.close()
            })
            .catch((exception) => {
              controller.error(exception)
            })
        },
      })
    },
    createUIMessageStreamResponse: (
      { stream }: { stream: unknown },
    ) => stream,
    streamText: vi.fn(() => ({
      consumeStream: vi.fn(),
      stream: new ReadableStream({ start(c) {
        c.close()
      } }),
    })),
    toUIMessageStream: vi.fn((options) => {
      return createMockUIMessageStream(options.generateMessageId())
    }),
    smoothStream: vi.fn(() => undefined),
    convertToModelMessages: vi.fn(
      async (messages: unknown) => messages,
    ),
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: vi.fn(),
    emit: vi.fn(() => null),
    getContext: () => ({}),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
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
  getGeneratedImageFileIds: vi.fn(() => []),
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
    onConflictDoNothing: () => ({
      returning: () => ({
        get: insertGet,
      }),
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
      model: { id: 'gpt-5-mini', tools: ['web_search', 'image_generation'] },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
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

  it('replays the stored assistant when the turn already fully persisted (issue #263 disconnect retry)', async () => {
    const handler = await getHandler()
    const userMessage = {
      id: 'db-user-1',
      publicId: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Question' }],
      tools: [] as string[],
      reasoning: 'off',
      createdAt: new Date('2026-06-22T14:14:31Z'),
    }
    const assistantMessage = {
      id: 'db-assistant-1',
      publicId: 'assistant-public-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Stored answer' }],
      tools: [] as string[],
      reasoning: 'off',
      createdAt: new Date('2026-06-22T14:14:43Z'),
    }
    const { db, insertValues, updateSet } = createDb({
      messages: [userMessage, assistantMessage],
    })

    vi.stubGlobal('useDb', () => db)

    const stream = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Question' }],
        }],
      },
    } as any)

    const chunks = await collectStreamChunks(stream)

    expect(insertValues).not.toHaveBeenCalled()
    expect(updateSet).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
    expect(chunks[0]).toEqual({
      type: 'start',
      messageId: 'assistant-public-1',
    })
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'text-delta',
      delta: 'Stored answer',
    }))
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })

  it('replays the assistant adjacent to the matched user message, not a later turn', async () => {
    const handler = await getHandler()
    const messages = [
      {
        id: 'db-user-1',
        publicId: 'user-public-1',
        role: 'user',
        parts: [{ type: 'text', text: 'First question' }],
        tools: [] as string[],
        reasoning: 'off',
        createdAt: new Date('2026-06-22T14:00:00Z'),
      },
      {
        id: 'db-assistant-1',
        publicId: 'assistant-public-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'First answer' }],
        tools: [] as string[],
        reasoning: 'off',
        createdAt: new Date('2026-06-22T14:00:05Z'),
      },
      {
        id: 'db-user-2',
        publicId: 'user-public-2',
        role: 'user',
        parts: [{ type: 'text', text: 'Second question' }],
        tools: [] as string[],
        reasoning: 'off',
        createdAt: new Date('2026-06-22T14:01:00Z'),
      },
      {
        id: 'db-assistant-2',
        publicId: 'assistant-public-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Second answer' }],
        tools: [] as string[],
        reasoning: 'off',
        createdAt: new Date('2026-06-22T14:01:05Z'),
      },
    ]
    const { db, insertValues } = createDb({ messages })

    vi.stubGlobal('useDb', () => db)

    const stream = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'First question' }],
        }],
      },
    } as any)

    const chunks = await collectStreamChunks(stream)

    expect(insertValues).not.toHaveBeenCalled()
    expect(chunks[0]).toEqual({
      type: 'start',
      messageId: 'assistant-public-1',
    })
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'text-delta',
      delta: 'First answer',
    }))
    expect(chunks).not.toContainEqual(expect.objectContaining({
      type: 'text-delta',
      delta: 'Second answer',
    }))
  })

  it('does not replay reasoning parts when reasoning is off', async () => {
    const handler = await getHandler()
    const userMessage = {
      id: 'db-user-1',
      publicId: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Question' }],
      tools: [] as string[],
      reasoning: 'off',
      createdAt: new Date('2026-06-22T14:14:31Z'),
    }
    const assistantMessage = {
      id: 'db-assistant-1',
      publicId: 'assistant-public-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Hidden reasoning' },
        { type: 'text', text: 'Visible answer' },
      ],
      tools: [] as string[],
      reasoning: 'off',
      createdAt: new Date('2026-06-22T14:14:43Z'),
    }
    const { db } = createDb({
      messages: [userMessage, assistantMessage],
    })

    vi.stubGlobal('useDb', () => db)

    const stream = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Question' }],
        }],
      },
    } as any)

    const chunks = await collectStreamChunks(stream)
    const reasoningChunks = chunks.filter((chunk) => {
      return typeof chunk?.type === 'string'
        && chunk.type.startsWith('reasoning')
    })

    expect(reasoningChunks).toHaveLength(0)
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'text-delta',
      delta: 'Visible answer',
    }))
  })
})

async function collectStreamChunks(stream: any): Promise<any[]> {
  const reader = stream.getReader()
  const chunks: any[] = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
  }

  return chunks
}
