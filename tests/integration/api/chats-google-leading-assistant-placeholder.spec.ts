import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamTextOptions: [] as Array<Record<string, any>>,
  toUIMessageStreamOptions: [] as Array<Record<string, any>>,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      const writer = {
        write: vi.fn(),
        merge: vi.fn(),
      }

      const ready = execute({ writer })

      return {
        writer,
        ready,
      }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
    streamText: vi.fn((options) => {
      mocks.streamTextOptions.push(options)

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(controller) {
          controller.close()
        } }),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      mocks.toUIMessageStreamOptions.push(options)

      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'start',
            messageId: options.generateMessageId(),
          })
          controller.enqueue({ type: 'finish' })
          controller.close()
        },
      })
    }),
    smoothStream: vi.fn(() => undefined),
    convertToModelMessages: vi.fn(async (messages: unknown) => messages),
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
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/index.post')

  return module.default
}

function createNewUserMessage(text: string) {
  return {
    id: 'new-message-1',
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createAssistantFirstHistory() {
  return [{
    id: 1,
    publicId: 'assistant-first-public',
    role: 'assistant' as const,
    parts: [{ type: 'text', text: 'Stored answer' }],
    tools: [] as string[],
    reasoning: 'off' as const,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  }]
}

function createUserFirstHistory() {
  return [{
    id: 1,
    publicId: 'user-first-public',
    role: 'user' as const,
    parts: [{ type: 'text', text: 'Original question' }],
    tools: [] as string[],
    reasoning: 'off' as const,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  }]
}

function createDb(chatMessages: unknown[]) {
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
            messages: chatMessages,
          })),
        },
      },
      insert: insertCall,
      transaction,
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
  }
}

describe('google leading-assistant placeholder', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.streamTextOptions.length = 0
    mocks.toUIMessageStreamOptions.length = 0

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

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
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('validateMessageFilePolicy', vi.fn(async () => undefined))
    vi.stubGlobal('convertFilesForAI', vi.fn(async (messages: unknown) => ({
      messages,
      missingFiles: [],
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

  function stubGoogleProvider() {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'google' },
      model: {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        tools: [],
      },
    })))
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
  }

  function stubOpenAiProvider() {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-5-mini', tools: [] },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
  }

  it('prepends a synthetic user placeholder for a Google request when the persisted history starts with an assistant message', async () => {
    const handler = await getHandler()
    const { db } = createDb(createAssistantFirstHistory())

    vi.stubGlobal('useDb', () => db)
    stubGoogleProvider()

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gemini-2.5-flash-lite',
        tools: [],
        reasoning: 'off',
        messages: [createNewUserMessage('Follow-up question')],
      },
    } as any)

    await response.ready

    const modelMessages = mocks.streamTextOptions[0]?.messages as Array<any>
    const originalMessages = mocks.toUIMessageStreamOptions[0]
      ?.originalMessages as Array<any>

    expect(modelMessages).toHaveLength(3)
    expect(modelMessages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: '(earlier message deleted)' }],
    })
    expect(modelMessages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Stored answer' }],
    })
    expect(modelMessages[2]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Follow-up question' }],
    })

    expect(originalMessages).toHaveLength(2)
    expect(originalMessages[0]).toMatchObject({ role: 'assistant' })
    expect(originalMessages).not.toContainEqual(
      expect.objectContaining({
        parts: [{ type: 'text', text: '(earlier message deleted)' }],
      }),
    )
  })

  it('does not prepend a placeholder for a Google request when history starts with a user message', async () => {
    const handler = await getHandler()
    const { db } = createDb(createUserFirstHistory())

    vi.stubGlobal('useDb', () => db)
    stubGoogleProvider()

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gemini-2.5-flash-lite',
        tools: [],
        reasoning: 'off',
        messages: [createNewUserMessage('Follow-up question')],
      },
    } as any)

    await response.ready

    const modelMessages = mocks.streamTextOptions[0]?.messages as Array<any>

    expect(modelMessages).toHaveLength(2)
    expect(modelMessages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Original question' }],
    })
    expect(modelMessages[1]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Follow-up question' }],
    })
  })

  it('does not prepend a placeholder for an OpenAI request even when history starts with an assistant message', async () => {
    const handler = await getHandler()
    const { db } = createDb(createAssistantFirstHistory())

    vi.stubGlobal('useDb', () => db)
    stubOpenAiProvider()

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createNewUserMessage('Follow-up question')],
      },
    } as any)

    await response.ready

    const modelMessages = mocks.streamTextOptions[0]?.messages as Array<any>

    expect(modelMessages).toHaveLength(2)
    expect(modelMessages[0]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Stored answer' }],
    })
    expect(modelMessages[1]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'Follow-up question' }],
    })
  })
})
