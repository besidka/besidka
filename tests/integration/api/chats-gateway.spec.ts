import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGenerationId,
  useGateway,
} from '../../../server/utils/gateways/index'

const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  providerMetadata: undefined as Record<string, unknown> | undefined,
  streamTextOptions: [] as Array<Record<string, any>>,
}))

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      const chunks = [
        { type: 'start', messageId },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Hi' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish' },
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
      const writer = {
        write: vi.fn(),
        merge: vi.fn(),
      }
      const ready = execute({ writer })

      return { writer, ready }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
    streamText: vi.fn((options: Record<string, any>) => {
      mocks.streamTextOptions.push(options)
      options.onEnd?.({
        usage: mocks.usage,
        providerMetadata: mocks.providerMetadata,
      })

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
        usage: Promise.resolve(mocks.usage),
        finalStep: Promise.resolve({
          providerMetadata: mocks.providerMetadata,
        }),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      return createMockUIMessageStream(options.generateMessageId())
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

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

function createDb() {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const messagesFindFirst = vi.fn(async () => ({
    usage: { model: 'x', provider: 'x', inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const insertCall = vi.fn(() => ({ values: insertValues }))
  const keysFindFirst = vi.fn(async () => ({ apiKey: 'encrypted-key' }))

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
        keys: {
          findFirst: keysFindFirst,
        },
        messages: {
          findFirst: messagesFindFirst,
        },
      },
      insert: insertCall,
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
    insertGet,
    updateSet,
    updateWhere,
    keysFindFirst,
    messagesFindFirst,
  }
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-5-mini',
    tools: [],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    }],
    ...overrides,
  }
}

describe('gateway chat completion routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    mocks.providerMetadata = undefined
    mocks.streamTextOptions = []

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      status?: number
      message?: string
    }) => {
      const exception = new Error(
        input.statusMessage || input.message || 'Error',
      )

      Object.assign(exception, {
        statusCode: input.statusCode ?? input.status,
        ...input,
      })

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
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('useGateway', useGateway)
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
  })

  it('routes a gateway selection to useGateway and never touches the curated catalog', async () => {
    const useChatProviderMock = vi.fn(() => {
      throw new Error('useChatProvider must not run on the gateway path')
    })

    vi.stubGlobal('useChatProvider', useChatProviderMock)

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
      }),
    } as any)

    await result.ready

    expect(useChatProviderMock).not.toHaveBeenCalled()
    expect(streamText).toHaveBeenCalledTimes(1)
    expect(db.query.keys.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'openrouter' }),
      }),
    )
  })

  it('rejects a gateway request that also requests tools', async () => {
    const useGatewayCalls = vi.fn()

    vi.stubGlobal('useGateway', useGatewayCalls)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        gateway: 'vercel',
        tools: ['web_search'],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(useGatewayCalls).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a gateway request when the first turn already persisted tools', async () => {
    const useGatewayCalls = vi.fn()

    vi.stubGlobal('useGateway', useGatewayCalls)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    db.query.chats.findFirst = vi.fn(async () => ({
      id: 'chat-1',
      projectId: null,
      project: null,
      messages: [{ tools: ['web_search'] }],
    }))

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        gateway: 'vercel',
        tools: [],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(useGatewayCalls).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('routes a cloudflare selection to useGateway and never touches the curated catalog',
    async () => {
      const useChatProviderMock = vi.fn(() => {
        throw new Error('useChatProvider must not run on the gateway path')
      })

      vi.stubGlobal('useChatProvider', useChatProviderMock)
      vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
        accountId: 'account-1',
        apiKey: 'cf-token',
      })))

      const handler = await getHandler()
      const { db } = createDb()

      vi.stubGlobal('useDb', () => db)

      const result = await handler({
        params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        body: baseBody({
          model: '@cf/meta/llama-3.3-70b-instruct',
          gateway: 'cloudflare',
        }),
      } as any)

      await result.ready

      expect(useChatProviderMock).not.toHaveBeenCalled()
      expect(streamText).toHaveBeenCalledTimes(1)
      expect(db.query.keys.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'cloudflare-gateway' }),
        }),
      )
    })

  it('returns a 401 response when no cloudflare credentials are stored',
    async () => {
      const useChatProviderMock = vi.fn(() => {
        throw new Error('useChatProvider must not run on the gateway path')
      })

      vi.stubGlobal('useChatProvider', useChatProviderMock)

      const handler = await getHandler()
      const { db, insertValues } = createDb()

      db.query.keys.findFirst = vi.fn(async () => undefined)

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        body: baseBody({ gateway: 'cloudflare' }),
      } as any)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(401)

      const assistantInsert = insertValues.mock.calls.find(
        ([value]) => value.role === 'assistant',
      )

      expect(assistantInsert).toBeUndefined()
    })

  it('never persists a cost for a cloudflare send, unlike OpenRouter', async () => {
    mocks.providerMetadata = undefined
    vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
      accountId: 'account-1',
      apiKey: 'cf-token',
    })))

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: '@cf/meta/llama-3.3-70b-instruct',
        gateway: 'cloudflare',
      }),
    } as any)

    await result.ready

    const assistantInsert = insertValues.mock.calls.find(
      ([value]) => value.role === 'assistant',
    )

    expect(assistantInsert?.[0].usage?.totalCost).toBeUndefined()
  })

  it('carries flat + nested gateway telemetry fields', async () => {
    const aiLoggerSet = vi.fn()
    const parentLoggerSet = vi.fn()

    vi.doMock('evlog', () => ({
      useLogger: () => ({
        set: parentLoggerSet,
        getContext: () => ({ requestId: 'test-request-id' }),
      }),
      createRequestLogger: () => ({
        set: aiLoggerSet,
        emit: vi.fn(() => null),
        getContext: () => ({}),
      }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      createError: (input: { message?: string, status?: number }) => {
        const exception = new Error(input.message || 'Error')

        Object.assign(exception, input)

        return exception
      },
    }))

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
      }),
    } as any)

    await result.ready

    const gatewayAiLoggerCall = aiLoggerSet.mock.calls.find(([fields]) => {
      return fields.modelId === 'anthropic/claude-opus-5'
    })

    expect(gatewayAiLoggerCall?.[0]).toEqual(expect.objectContaining({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
      attributes: {
        chat: {
          gateway: 'openrouter',
          gatewayProvider: 'anthropic',
          gatewayModel: 'anthropic/claude-opus-5',
        },
      },
    }))

    const gatewayParentLoggerCall = parentLoggerSet.mock.calls.find(
      ([fields]) => fields.modelId === 'anthropic/claude-opus-5',
    )

    expect(gatewayParentLoggerCall?.[0]).toEqual(expect.objectContaining({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
      attributes: {
        chat: {
          gateway: 'openrouter',
          gatewayProvider: 'anthropic',
          gatewayModel: 'anthropic/claude-opus-5',
        },
      },
    }))
  })

  it('persists OpenRouter-reported cost on the assistant message', async () => {
    mocks.providerMetadata = {
      openrouter: {
        usage: { cost: 0.0042 },
      },
    }

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
      }),
    } as any)

    await result.ready

    const assistantInsert = insertValues.mock.calls.find(
      ([value]) => value.role === 'assistant',
    )

    expect(assistantInsert?.[0].usage).toEqual(expect.objectContaining({
      totalCost: 0.0042,
    }))
  })

  it('schedules a background Vercel generation-cost lookup', async () => {
    mocks.providerMetadata = {
      gateway: { generationId: 'gen_123' },
    }

    const persistVercelGenerationCostMock = vi.fn(async () => undefined)
    const fakeVercelClient = { getGenerationInfo: vi.fn() }
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

    vi.stubGlobal(
      'persistVercelGenerationCost',
      persistVercelGenerationCostMock,
    )
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      client: fakeVercelClient,
    })))

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'openai/gpt-4o',
        gateway: 'vercel',
      }),
      context: {
        cloudflare: { context: { waitUntil } },
      },
    } as any)

    await result.ready

    expect(persistVercelGenerationCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        client: fakeVercelClient,
        generationId: 'gen_123',
        publicId: expect.any(String),
      }),
    )
  })

  it('does not schedule a Vercel cost lookup without a generation id', async () => {
    mocks.providerMetadata = undefined

    const persistVercelGenerationCostMock = vi.fn(async () => undefined)
    const fakeVercelClient = { getGenerationInfo: vi.fn() }
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

    vi.stubGlobal(
      'persistVercelGenerationCost',
      persistVercelGenerationCostMock,
    )
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      client: fakeVercelClient,
    })))

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'openai/gpt-4o',
        gateway: 'vercel',
      }),
      context: {
        cloudflare: { context: { waitUntil } },
      },
    } as any)

    await result.ready

    expect(persistVercelGenerationCostMock).not.toHaveBeenCalled()
  })

  it('behaves byte-identically to pre-gateway clients when gateway is absent', async () => {
    const useChatProviderMock = vi.fn(() => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-5-mini', tools: [] },
    }))
    const useGatewayMock = vi.fn(() => {
      throw new Error('useGateway must not run for non-gateway sends')
    })

    vi.stubGlobal('useChatProvider', useChatProviderMock)
    vi.stubGlobal('useGateway', useGatewayMock)
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const result = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({ model: 'gpt-5-mini' }),
    } as any)

    await result.ready

    expect(useChatProviderMock).toHaveBeenCalledWith('gpt-5-mini')
    expect(useGatewayMock).not.toHaveBeenCalled()

    const assistantInsert = insertValues.mock.calls.find(
      ([value]) => value.role === 'assistant',
    )

    expect(assistantInsert?.[0].usage?.totalCost).toBeUndefined()
  })
})
