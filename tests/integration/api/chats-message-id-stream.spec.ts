import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  failConvertToModelMessages: false,
  toUIMessageStreamOptions: [] as Array<Record<string, any>>,
}))

vi.mock('ai', () => ({
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
    toUIMessageStream: vi.fn((options) => {
      mocks.toUIMessageStreamOptions.push(options)

      return {}
    }),
  })),
  smoothStream: vi.fn(() => undefined),
  convertToModelMessages: vi.fn(async (messages) => {
    if (mocks.failConvertToModelMessages) {
      throw new Error('Failed to prepare model messages')
    }

    return messages
  }),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
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

const ULID_PATTERN = /^[0-9A-Z]{26}$/

describe('chat stream message ids', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.failConvertToModelMessages = false
    mocks.toUIMessageStreamOptions.length = 0

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
  })

  it('uses a pre-generated ULID as the streamed assistant message id', async () => {
    const handler = await getHandler()
    const { db, insertValues, transaction, updateSet, updateWhere } = createDb()

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
    const generatedId = streamOptions.generateMessageId()

    expect(generatedId).toMatch(ULID_PATTERN)

    await streamOptions.onFinish({
      isAborted: false,
      responseMessage: {
        id: generatedId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
      },
    })

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi' }],
      tools: [],
      reasoning: 'off',
    }))
    expect(transaction).toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith({ publicId: generatedId })
    expect(updateWhere).toHaveBeenCalled()
  })

  it('does not insert assistant row when the stream is aborted', async () => {
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

    const streamOptions = mocks.toUIMessageStreamOptions[0]

    await streamOptions.onFinish({
      isAborted: true,
      responseMessage: { role: 'assistant', parts: [] },
    })

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

  it('does not send publicId during the initial user message insert', async () => {
    const handler = await getHandler()
    const { db, insertValues, transaction, updateSet } = createDb()

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
    }))
    expect(transaction).toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({
      publicId: 'message-1',
    }))
    expect(updateSet).toHaveBeenCalledWith({ publicId: 'message-1' })
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
      message: 'Invalid OpenAI API key',
      providerRequestId: 'req_prestream_123',
      status: 401,
    }))
  })
})
