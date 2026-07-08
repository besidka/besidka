import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  failConvertToModelMessages: false,
  toUIMessageStreamOptions: [] as Array<Record<string, any>>,
  generatedMessageIds: [] as string[],
  uiMessageStreamChunks: null as Array<Record<string, any>> | null,
  persistAssistantError: null as Record<string, any> | null,
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
    streamText: vi.fn(() => ({
      consumeStream: vi.fn(),
      stream: new ReadableStream({ start(c) {
        c.close()
      } }),
    })),
    toUIMessageStream: vi.fn((options) => {
      mocks.toUIMessageStreamOptions.push(options)
      const generatedMessageId = options.generateMessageId()

      mocks.generatedMessageIds.push(generatedMessageId)

      return new ReadableStream({
        start(controller) {
          const chunks = mocks.uiMessageStreamChunks ?? [
            {
              type: 'start',
              messageId: generatedMessageId,
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
    }),
    smoothStream: vi.fn(() => undefined),
    convertToModelMessages: vi.fn(async (messages) => {
      if (mocks.failConvertToModelMessages) {
        throw new Error('Failed to prepare model messages')
      }

      return messages
    }),
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
  sanitizeMessagesForModelContext: vi.fn(messages => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(async (input) => {
    if (mocks.persistAssistantError) {
      throw mocks.persistAssistantError
    }

    return input.parts
  }),
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/index.post')

  return module.default
}

function createMessage(text: string) {
  return {
    id: 'message-1',
    role: 'user',
    parts: [
      {
        type: 'text',
        text,
      },
    ],
  }
}

function createDb() {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }))
  const insertCall = vi.fn(() => ({
    values: insertValues,
  }))
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
            messages: [],
          })),
        },
      },
      insert: insertCall,
      transaction,
      update: vi.fn(() => {
        return {
          set: updateSet,
        }
      }),
    },
    insertValues,
    insertGet,
    transaction,
    updateSet,
    updateWhere,
  }
}

function createKv(isGenerating = false) {
  const get = vi.fn(async () => (isGenerating ? '1' : null))
  const put = vi.fn(async () => undefined)
  const remove = vi.fn(async () => undefined)

  return {
    kv: { get, put, delete: remove },
    get,
    put,
    delete: remove,
  }
}

function createPersistedUserMessage(text: string) {
  return {
    id: 1,
    publicId: 'message-1',
    role: 'user' as const,
    parts: [{ type: 'text', text }],
    tools: [],
    reasoning: 'off' as const,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

const ULID_PATTERN = /^[0-9A-Z]{26}$/

describe('chat stream message ids', () => {
  let sendPushNotificationToUserMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.failConvertToModelMessages = false
    mocks.toUIMessageStreamOptions.length = 0
    mocks.generatedMessageIds.length = 0
    mocks.uiMessageStreamChunks = null
    mocks.persistAssistantError = null

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
    vi.stubGlobal('convertFilesForAI', vi.fn(async messages => ({
      messages,
      missingFiles: [],
    })))
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-5-mini' },
      modelName: 'GPT-5 mini',
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => createKv().kv)
    vi.stubGlobal('buildVapidSubject', vi.fn((subject: string) => {
      return subject ? `mailto:${subject}` : undefined
    }))
    sendPushNotificationToUserMock = vi.fn(async () => undefined)
    vi.stubGlobal('sendPushNotificationToUser', sendPushNotificationToUserMock)
  })

  function createWaitUntilEvent(base: Record<string, any>) {
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

  it('uses a pre-generated ULID as the streamed assistant message id', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    const generatedId = mocks.generatedMessageIds[0]

    expect(generatedId).toMatch(ULID_PATTERN)
    expect(insertValues.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      role: 'assistant',
      parts: [
        expect.objectContaining({
          type: 'text',
          text: 'Hi',
        }),
      ],
      tools: [],
      reasoning: 'off',
      publicId: generatedId,
    }))
  })

  it('rejects a deep research model with a 400', async () => {
    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'o3-deep-research',
        research: {
          tier: 'thorough',
          assistModel: 'gpt-5.4-nano',
          costEstimate: '~$10 / task',
          timeEstimate: '10–30 min',
        },
      },
      modelName: 'o3 Deep Research',
    })))

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'o3-deep-research',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)).rejects.toThrow('This model only runs deep research.')

    expect(mocks.generatedMessageIds).toHaveLength(0)
  })

  it('sends a push notification via waitUntil after a successful generation', async () => {
    const handler = await getHandler()
    const { db } = createDb()
    const { event, waitUntil } = createWaitUntilEvent({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as any)

    await response.ready

    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(sendPushNotificationToUserMock).toHaveBeenCalledWith(
      db,
      1,
      {
        title: 'Your response is ready',
        body: 'Open the chat to see what Besidka generated for you.',
        url: '/chats/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      expect.anything(),
      expect.anything(),
    )
  })

  it('does not send a push notification when the stream is aborted', async () => {
    const handler = await getHandler()
    const { db } = createDb()
    const { event } = createWaitUntilEvent({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    })

    mocks.uiMessageStreamChunks = [{ type: 'abort' }]

    vi.stubGlobal('useDb', () => db)

    const response = await handler(event as any)

    await response.ready

    expect(sendPushNotificationToUserMock).not.toHaveBeenCalled()
  })

  it('sets and clears the in-flight generation flag around a normal run', async () => {
    const handler = await getHandler()
    const { db } = createDb()
    const { kv, put, delete: remove } = createKv()

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useKV', () => kv)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    expect(put).toHaveBeenCalledWith(
      'chat-generating:chat-1:message-1',
      '1',
      { expirationTtl: 600 },
    )
    expect(remove).toHaveBeenCalledWith('chat-generating:chat-1:message-1')
  })

  it('returns a pending signal instead of starting a duplicate generation', async () => {
    const handler = await getHandler()
    const { db } = createDb()
    const { kv } = createKv(true)

    db.query.chats.findFirst.mockResolvedValue({
      id: 'chat-1',
      projectId: null,
      project: null,
      messages: [createPersistedUserMessage('Hello')],
    })

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useKV', () => kv)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    // transient: true and no messageId on start/finish are load-bearing: any
    // of those would make the AI SDK write() a message-list entry keyed by a
    // fresh id unrelated to the real in-progress assistant message, pushing
    // a hidden phantom message into chatSdk.messages (issue #275 follow-up).
    expect(response.writer.write).toHaveBeenCalledWith({ type: 'start' })
    expect(response.writer.write).toHaveBeenCalledWith({
      type: 'data-generation-pending',
      data: {},
      transient: true,
    })
    expect(response.writer.write).toHaveBeenCalledWith({ type: 'finish' })
    expect(mocks.generatedMessageIds).toHaveLength(0)
  })

  it('does not insert assistant row when the stream is aborted', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    mocks.uiMessageStreamChunks = [{
      type: 'abort',
    }]

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    const assistantInserts = insertValues.mock.calls.filter(
      ([payload]) => payload.role === 'assistant',
    )

    expect(assistantInserts).toHaveLength(0)
  })

  it('does not insert or delete when stream setup fails', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    mocks.failConvertToModelMessages = true

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await expect(response.ready).rejects.toThrow(
      'Failed to prepare model messages',
    )

    const assistantInserts = insertValues.mock.calls.filter(
      ([payload]) => payload.role === 'assistant',
    )

    expect(assistantInserts).toHaveLength(0)
  })

  it('sends publicId during the initial user message insert', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
      publicId: 'message-1',
    }))
  })

  it('serializes provider errors for the UI stream', async () => {
    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await response.ready

    const streamOptions = mocks.toUIMessageStreamOptions[0]
    const serializedError = streamOptions.onError({
      message: 'Rate limit exceeded',
      statusCode: 429,
      responseHeaders: {
        'x-request-id': 'req_123',
      },
    })

    expect(JSON.parse(serializedError)).toEqual(expect.objectContaining({
      code: 'provider-rate-limit',
      providerRequestId: 'req_123',
      status: 429,
    }))
  })

  it('returns structured metadata for pre-stream provider errors', async () => {
    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useOpenAI', vi.fn(async () => {
      throw Object.assign(new Error('Invalid OpenAI API key'), {
        status: 401,
        requestId: 'req_prestream_123',
      })
    }))

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: 'provider-auth',
      message: 'The provider rejected the API credentials.',
      providerRequestId: 'req_prestream_123',
      status: 401,
    }))
  })

  it('preserves structured metadata when assistant persistence fails', async () => {
    const handler = await getHandler()
    const { db } = createDb()

    mocks.persistAssistantError = {
      code: 'message-persist-failed',
      message: 'The response could not be saved.',
      why: 'The response could not be stored in the database.',
      fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
      status: 500,
      requestId: 'cf-ray-123',
      providerId: 'openai',
      providerRequestId: 'req_persist_123',
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    await expect(response.ready).rejects.toEqual(expect.objectContaining({
      code: 'message-persist-failed',
      requestId: 'cf-ray-123',
      providerRequestId: 'req_persist_123',
    }))

    const streamOptions = mocks.toUIMessageStreamOptions[0]

    expect(JSON.parse(streamOptions.onError(mocks.persistAssistantError)))
      .toEqual({
        code: 'message-persist-failed',
        message: 'The response could not be saved.',
        why: 'The response could not be stored in the database.',
        fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
        status: 500,
        requestId: 'cf-ray-123',
        providerId: 'openai',
        providerRequestId: 'req_persist_123',
      })
  })
})
