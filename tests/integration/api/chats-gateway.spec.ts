import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
  useGateway,
} from '../../../server/utils/gateways/index'

/**
 * Gateway counterpart of `chats-single-step-characterization.spec.ts`. The
 * gateway cases were deleted from that suite when gateway support was
 * removed; this file restores them alongside it rather than reverting it, so
 * the direct-provider rewiring it gained in the meantime stays intact. It
 * also pins the two behaviours that did not exist before the restoration: the
 * per-step OpenRouter cost sum reading the same `steps` the search accounting
 * reads, and the double-count guard that keeps a gateway-bundled search fee
 * out of `searchCost`.
 */
const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  steps: [] as Array<Record<string, unknown>>,
  streamTextOptions: [] as Array<Record<string, any>>,
  lastMessageMetadata: undefined as Record<string, any> | undefined,
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
        providerMetadata: undefined,
        steps: mocks.steps,
      })

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
        usage: Promise.resolve(mocks.usage),
        steps: Promise.resolve(mocks.steps),
        finalStep: Promise.resolve(mocks.steps.at(-1) ?? {}),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      for (const step of mocks.steps) {
        options.messageMetadata?.({
          part: {
            type: 'finish-step',
            providerMetadata: step.providerMetadata,
          },
        })
      }

      mocks.lastMessageMetadata = options.messageMetadata?.({
        part: {
          type: 'finish',
          totalUsage: mocks.usage,
        },
      })

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
  isKnownImageGenerationModel: vi.fn(() => true),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

// The real gateway builders resolve a catalog entry over the network. Tests
// that care about `maxOutputTokens` or `pricing` supply them explicitly
// through a stubbed `useGateway`, so this entry deliberately carries neither
// — only the `toolCall: true` the Brave/Exa send-path gate reads, so a
// builder-level test exercises the allowed path rather than the rejection.
vi.mock('../../../server/utils/gateways/catalog', () => ({
  findGatewayCatalogModel: vi.fn(async () => ({
    id: 'catalog-model',
    name: 'Catalog model',
    toolCall: true,
  })),
  getCachedGatewayCatalog: vi.fn(async () => []),
  getCachedCloudflareGatewayCatalog: vi.fn(async () => []),
}))

vi.mock('~~/server/utils/search/brave', () => ({
  getBraveWebSearchTools: vi.fn(async () => ({
    tools: { web_search_brave: { description: 'brave' } },
  })),
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
    usage: {
      model: 'x',
      provider: 'x',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
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

function getAssistantInsert(insertValues: ReturnType<typeof vi.fn>) {
  const call = insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })

  return call?.[0]
}

function openRouterStep(cost: number) {
  return {
    providerMetadata: {
      openrouter: {
        usage: { cost },
      },
    },
  }
}

/**
 * Field names and the decimal-STRING shape are copied verbatim from a real
 * `providerMetadata.gateway` captured against the live Vercel AI Gateway on
 * a `perplexitySearch()` send — the turn whose figures diverge, where
 * `cost` matched the async `getGenerationInfo().totalCost` of `0.00522065`
 * and `inferenceCost` did not. `generationId` is included because the same
 * metadata carries it.
 */
function vercelStep(overrides: Record<string, unknown> = {}) {
  return {
    providerMetadata: {
      gateway: {
        cost: '0.00522065',
        marketCost: '0.00522065',
        surchargeCost: '0',
        gatewayCost: '0.00522065',
        inferenceCost: '0.00022065',
        generationId: 'gen_123',
        ...overrides,
      },
    },
  }
}

async function runHandler(
  body: Record<string, unknown>,
  context?: Record<string, unknown>,
) {
  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body,
    ...(context ? { context } : {}),
  } as any)

  await result.ready

  return created
}

describe('gateway chat completion routing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    mocks.steps = []
    mocks.streamTextOptions = []
    mocks.lastMessageMetadata = undefined

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
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('buildPersistedAssistantReplayChunks', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: {} })))
    vi.stubGlobal('useGateway', useGateway)
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    vi.stubGlobal('useChatProvider', vi.fn(() => {
      throw new Error('useChatProvider must not run on the gateway path')
    }))
  })

  it('routes a gateway selection to useGateway and never touches the '
    + 'curated catalog', async () => {
    const { db } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(db.query.keys.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'openrouter' }),
      }),
    )
  })

  it('keeps a non-search openrouter send free of tools and toolChoice',
    async () => {
      await runHandler(baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
      }))

      expect(mocks.streamTextOptions[0]?.tools).toBeUndefined()
      expect(mocks.streamTextOptions[0]?.toolChoice).toBeUndefined()
    })

  it('keeps a non-search vercel send free of tools and toolChoice',
    async () => {
      await runHandler(baseBody({
        model: 'openai/gpt-4o',
        gateway: 'vercel',
      }))

      expect(mocks.streamTextOptions[0]?.tools).toBeUndefined()
      expect(mocks.streamTextOptions[0]?.toolChoice).toBeUndefined()
    })

  it('threads a requested reasoning level into an openrouter send',
    async () => {
      await runHandler(baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
        reasoning: 'high',
      }))

      expect(mocks.streamTextOptions[0]?.reasoning).toBe('high')
    })

  it('threads a requested reasoning level into a vercel send', async () => {
    await runHandler(baseBody({
      model: 'openai/gpt-4o',
      gateway: 'vercel',
      reasoning: 'medium',
    }))

    expect(mocks.streamTextOptions[0]?.reasoning).toBe('medium')
  })

  it('forces reasoning off for a cloudflare send even when requested, since '
    + 'cloudflare has no functional reasoning mechanism wired', async () => {
    vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
      accountId: 'account-1',
      apiKey: 'cf-token',
    })))

    await runHandler(baseBody({
      model: '@cf/meta/llama-3.3-70b-instruct',
      gateway: 'cloudflare',
      reasoning: 'high',
    }))

    expect(mocks.streamTextOptions[0]?.reasoning).toBeUndefined()
  })

  it('allows image_generation through the vercel gateway and threads it into '
    + 'useGateway', async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    await runHandler(baseBody({
      model: 'google/gemini-3.1-flash-image-preview',
      gateway: 'vercel',
      tools: ['image_generation'],
    }))

    expect(useGatewayMock).toHaveBeenCalledWith(
      'vercel',
      '1',
      'google/gemini-3.1-flash-image-preview',
      ['image_generation'],
      'off',
      expect.anything(),
    )
  })

  it('allows image_generation through the openrouter gateway and threads it '
    + 'into useGateway', async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))

    expect(useGatewayMock).toHaveBeenCalledWith(
      'openrouter',
      '1',
      'openai/gpt-5-image',
      ['image_generation'],
      'off',
      expect.anything(),
    )
  })

  it('rejects image_generation through the cloudflare gateway', async () => {
    const useGatewayCalls = vi.fn()

    vi.stubGlobal('useGateway', useGatewayCalls)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: '@cf/meta/llama-3.3-70b-instruct',
        gateway: 'cloudflare',
        tools: ['image_generation'],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(useGatewayCalls).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects web_search through the cloudflare gateway', async () => {
    const useGatewayCalls = vi.fn()

    vi.stubGlobal('useGateway', useGatewayCalls)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: '@cf/meta/llama-3.3-70b-instruct',
        gateway: 'cloudflare',
        tools: ['web_search'],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(useGatewayCalls).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('allows web_search through the vercel gateway and threads it into '
    + 'useGateway', async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    await runHandler(baseBody({
      model: 'openai/gpt-4o',
      gateway: 'vercel',
      tools: ['web_search'],
    }))

    expect(useGatewayMock).toHaveBeenCalledWith(
      'vercel',
      '1',
      'openai/gpt-4o',
      ['web_search'],
      'off',
      expect.anything(),
    )
  })

  it('allows web_search through the openrouter gateway and threads it into '
    + 'useGateway', async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search'],
    }))

    expect(useGatewayMock).toHaveBeenCalledWith(
      'openrouter',
      '1',
      'anthropic/claude-opus-5',
      ['web_search'],
      'off',
      expect.anything(),
    )
  })

  it('rejects a gateway request when the first turn already persisted an '
    + 'unsupported tool', async () => {
    const useGatewayCalls = vi.fn()

    vi.stubGlobal('useGateway', useGatewayCalls)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    db.query.chats.findFirst = vi.fn(async () => ({
      id: 'chat-1',
      projectId: null,
      project: null,
      messages: [{ role: 'user', tools: ['image_generation'] }],
    })) as any

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: '@cf/meta/llama-3.3-70b-instruct',
        gateway: 'cloudflare',
        tools: [],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(useGatewayCalls).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('routes a cloudflare selection to useGateway and never touches the '
    + 'curated catalog', async () => {
    vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
      accountId: 'account-1',
      apiKey: 'cf-token',
    })))

    const { db } = await runHandler(baseBody({
      model: '@cf/meta/llama-3.3-70b-instruct',
      gateway: 'cloudflare',
    }))

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(db.query.keys.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'cloudflare-gateway' }),
      }),
    )
  })

  it('returns a 401 response when no cloudflare credentials are stored',
    async () => {
      const handler = await getHandler()
      const { db, insertValues } = createDb()

      db.query.keys.findFirst = vi.fn(async () => undefined) as any

      vi.stubGlobal('useDb', () => db)

      const response = await handler({
        params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        body: baseBody({ gateway: 'cloudflare' }),
      } as any)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(401)
      expect(getAssistantInsert(insertValues)).toBeUndefined()
    })

  it('never persists a cost for a cloudflare send when no catalog pricing is '
    + 'available', async () => {
    vi.stubGlobal('useDecryptText', vi.fn(async () => JSON.stringify({
      accountId: 'account-1',
      apiKey: 'cf-token',
    })))

    const { insertValues } = await runHandler(baseBody({
      model: '@cf/meta/llama-3.3-70b-instruct',
      gateway: 'cloudflare',
    }))

    expect(getAssistantInsert(insertValues)?.usage?.totalCost).toBeUndefined()
    expect(getAssistantInsert(insertValues)?.usage?.costEstimated)
      .toBeUndefined()
  })

  it('estimates and persists a cloudflare cost from catalog pricing, and '
    + 'shows it live without waiting for a reload', async () => {
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      pricing: { input: '0.000001', output: '0.000002' },
    })))

    const { insertValues } = await runHandler(baseBody({
      model: '@cf/meta/llama-3.3-70b-instruct',
      gateway: 'cloudflare',
    }))
    const expectedCost = 10 * 0.000001 + 20 * 0.000002

    expect(getAssistantInsert(insertValues)?.usage).toEqual(
      expect.objectContaining({
        totalCost: expectedCost,
        costEstimated: true,
      }),
    )
    expect(mocks.lastMessageMetadata?.usage).toEqual(
      expect.objectContaining({
        totalCost: expectedCost,
        costEstimated: true,
      }),
    )
  })

  it('caps maxOutputTokens for a vercel send with a catalog entry',
    async () => {
      vi.stubGlobal('useGateway', vi.fn(async () => ({
        instance: {},
        tools: {},
        providerOptions: {},
        generateChatTitle: vi.fn(),
        maxOutputTokens: 4096,
      })))

      await runHandler(baseBody({
        model: 'openai/gpt-4o',
        gateway: 'vercel',
      }))

      expect(mocks.streamTextOptions[0]?.maxOutputTokens).toBe(4096)
    })

  it('leaves maxOutputTokens unset for an openrouter send', async () => {
    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    expect(mocks.streamTextOptions[0]?.maxOutputTokens).toBeUndefined()
  })

  it('leaves maxOutputTokens unset for a direct-provider send', async () => {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
        tools: [],
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))

    await runHandler(baseBody({ model: 'gpt-5-mini' }))

    expect(mocks.streamTextOptions[0]?.maxOutputTokens).toBeUndefined()
  })

  it('threads OpenRouter\'s cost into the live streamed message metadata, '
    + 'not just the persisted row', async () => {
    mocks.steps = [openRouterStep(0.0042)]

    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    expect(mocks.lastMessageMetadata?.usage).toEqual(
      expect.objectContaining({ totalCost: 0.0042 }),
    )
  })

  it('persists OpenRouter-reported cost on the assistant message', async () => {
    mocks.steps = [openRouterStep(0.0042)]

    const { insertValues } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    expect(getAssistantInsert(insertValues)?.usage).toEqual(
      expect.objectContaining({ totalCost: 0.0042 }),
    )
  })

  it('sums OpenRouter per-step costs across a multi-step turn instead of '
    + 'taking the last step\'s cost', async () => {
    mocks.steps = [
      openRouterStep(0.001),
      openRouterStep(0.002),
      openRouterStep(0.004),
    ]

    const { insertValues } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    expect(getAssistantInsert(insertValues)?.usage?.totalCost)
      .toBeCloseTo(0.007, 10)
    expect(mocks.lastMessageMetadata?.usage?.totalCost).toBeCloseTo(0.007, 10)
  })

  it('threads Vercel\'s synchronous gateway cost into the live streamed '
    + 'message metadata and the persisted row, parsing its decimal string',
  async () => {
    mocks.steps = [vercelStep()]

    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    })))

    const { insertValues } = await runHandler(baseBody({
      model: 'openai/gpt-4o',
      gateway: 'vercel',
    }))

    expect(mocks.lastMessageMetadata?.usage?.totalCost).toBe(0.00522065)
    expect(getAssistantInsert(insertValues)?.usage?.totalCost)
      .toBe(0.00522065)
    expect(getAssistantInsert(insertValues)?.usage?.costEstimated)
      .toBeUndefined()
  })

  it('reads Vercel\'s `cost`, not `inferenceCost`, so a gateway-bundled '
    + 'search fee is never dropped from the blended total', async () => {
    mocks.steps = [vercelStep()]

    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    })))

    const { insertValues } = await runHandler(baseBody({
      model: 'openai/gpt-4o',
      gateway: 'vercel',
    }))

    expect(getAssistantInsert(insertValues)?.usage?.totalCost)
      .not.toBe(0.00022065)
  })

  it('sums Vercel per-step costs across a multi-step turn', async () => {
    mocks.steps = [
      vercelStep({ cost: '0.001' }),
      vercelStep({ cost: '0.002' }),
    ]

    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    })))

    const { insertValues } = await runHandler(baseBody({
      model: 'openai/gpt-4o',
      gateway: 'vercel',
    }))

    expect(getAssistantInsert(insertValues)?.usage?.totalCost)
      .toBeCloseTo(0.003, 10)
  })

  it('never fabricates a live cost for a vercel send whose metadata carries '
    + 'no cost field, leaving the async fallback to fill it in', async () => {
    mocks.steps = [{
      providerMetadata: { gateway: { generationId: 'gen_123' } },
    }]

    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    })))

    await runHandler(baseBody({ model: 'openai/gpt-4o', gateway: 'vercel' }))

    expect(mocks.lastMessageMetadata?.usage?.totalCost).toBeUndefined()
  })

  it('never fabricates a cost from an unparseable Vercel cost string',
    async () => {
      mocks.steps = [vercelStep({ cost: 'n/a' })]

      vi.stubGlobal('useGateway', vi.fn(async () => ({
        instance: {},
        tools: {},
        providerOptions: {},
        generateChatTitle: vi.fn(),
      })))

      const { insertValues } = await runHandler(baseBody({
        model: 'openai/gpt-4o',
        gateway: 'vercel',
      }))

      expect(getAssistantInsert(insertValues)?.usage?.totalCost)
        .toBeUndefined()
    })

  it('carries the gateway telemetry fields under attributes', async () => {
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

    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))

    const expectedAttributes = {
      chat: {
        gateway: 'openrouter',
        gatewayProvider: 'anthropic',
        gatewayModel: 'anthropic/claude-opus-5',
      },
    }
    const gatewayAiLoggerCall = aiLoggerSet.mock.calls.find(([fields]) => {
      return fields.modelId === 'anthropic/claude-opus-5'
    })

    expect(gatewayAiLoggerCall?.[0]).toEqual(expect.objectContaining({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
      attributes: expectedAttributes,
    }))

    const gatewayParentLoggerCall = parentLoggerSet.mock.calls.find(
      ([fields]) => fields.modelId === 'anthropic/claude-opus-5',
    )

    expect(gatewayParentLoggerCall?.[0]).toEqual(expect.objectContaining({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
      attributes: expectedAttributes,
    }))
  })

  it('schedules a background Vercel generation-cost lookup', async () => {
    mocks.steps = [{
      providerMetadata: { gateway: { generationId: 'gen_123' } },
    }]

    const persistVercelGenerationCostMock = vi.fn(async () => undefined)
    const fakeVercelClient = { getGenerationInfo: vi.fn() }
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

    vi.stubGlobal(
      'persistVercelGenerationCost',
      persistVercelGenerationCostMock,
    )
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      client: fakeVercelClient,
    })))

    const { db } = await runHandler(
      baseBody({ model: 'openai/gpt-4o', gateway: 'vercel' }),
      { cloudflare: { context: { waitUntil } } },
    )

    expect(persistVercelGenerationCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        client: fakeVercelClient,
        generationId: 'gen_123',
        publicId: expect.any(String),
      }),
    )
  })

  it('does not schedule a Vercel cost lookup without a generation id',
    async () => {
      const persistVercelGenerationCostMock = vi.fn(async () => undefined)
      const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

      vi.stubGlobal(
        'persistVercelGenerationCost',
        persistVercelGenerationCostMock,
      )
      vi.stubGlobal('useGateway', vi.fn(async () => ({
        instance: {},
        tools: {},
        providerOptions: {},
        generateChatTitle: vi.fn(),
        client: { getGenerationInfo: vi.fn() },
      })))

      await runHandler(
        baseBody({ model: 'openai/gpt-4o', gateway: 'vercel' }),
        { cloudflare: { context: { waitUntil } } },
      )

      expect(persistVercelGenerationCostMock).not.toHaveBeenCalled()
    })

  it('registers the Brave tool on a gateway-routed send, so Epic 1 external '
    + 'search works through a gateway with no gateway-side change', async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      toolCall: true,
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search_brave'],
    }))

    expect(useGatewayMock).toHaveBeenCalledWith(
      'openrouter',
      '1',
      'anthropic/claude-opus-5',
      ['web_search_brave'],
      'off',
      expect.anything(),
    )
    expect(mocks.streamTextOptions[0]?.tools?.web_search_brave).toBeDefined()
  })

  it('never sets searchCost for a gateway-bundled web search: an OpenRouter '
    + '`web` plugin turn reports one blended totalCost only', async () => {
    mocks.steps = [{
      ...openRouterStep(0.0042),
      content: [{
        type: 'tool-result',
        toolName: 'web_search',
        output: { status: 'ready' },
      }],
    }]

    const { insertValues } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search'],
    }))
    const persistedUsage = getAssistantInsert(insertValues)?.usage

    expect(persistedUsage?.totalCost).toBe(0.0042)
    expect(persistedUsage?.searchCost).toBeUndefined()
    expect(persistedUsage?.searchUnits).toBeUndefined()
    expect(persistedUsage?.searchProvider).toBeUndefined()
    expect(mocks.lastMessageMetadata?.usage?.searchCost).toBeUndefined()
  })

  it('rejects Brave on a gateway model whose catalog entry says it cannot '
    + 'call tools, instead of billing a search the model never sees',
  async () => {
    const useGatewayMock = vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      toolCall: false,
    }))

    vi.stubGlobal('useGateway', useGatewayMock)

    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
        tools: ['web_search_brave'],
      }),
    } as any)).rejects.toMatchObject({
      status: 400,
      message: 'The selected model does not support the requested tool.',
      why: 'anthropic/claude-opus-5 does not support tool calling.',
      fix: expect.stringContaining('Choose a tool-calling model'),
    })

    expect(db.query.keys.findFirst).toHaveBeenCalled()
    expect(useGatewayMock).toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
    expect(getAssistantInsert(insertValues)).toBeUndefined()
  })

  it('rejects Exa on a gateway model with no resolvable catalog entry, '
    + 'since an unknown tool-calling capability is not a yes', async () => {
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
    })))

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: baseBody({
        model: 'anthropic/claude-opus-5',
        gateway: 'openrouter',
        tools: ['web_search_exa'],
      }),
    } as any)).rejects.toMatchObject({ status: 400 })

    expect(streamText).not.toHaveBeenCalled()
  })

  it('leaves a gateway send with no external search tool unaffected by the '
    + 'toolCall gate, whatever the catalog says', async () => {
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      toolCall: false,
    })))

    await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search'],
    }))

    expect(streamText).toHaveBeenCalledTimes(1)
  })

  /**
   * `resolveSearchUsage` is stubbed to always report a billable search, so
   * these two pin the guard itself rather than the fact that today's provider
   * dispatch happens to return `undefined` for a gateway's `providerId`. If
   * the guard were removed, the first of the pair would start reporting a
   * `searchCost` on top of the blended `totalCost`.
   */
  function mockAlwaysBillableSearchUsage() {
    const resolveSearchUsage = vi.fn(() => ({
      units: 3,
      billingUnit: 'search',
      cost: 0.03,
      googleQueries: undefined,
      googleGroundedSteps: undefined,
      provider: 'brave',
    }))

    vi.doMock('~~/server/utils/ai/search-usage', () => ({
      resolveSearchRates: vi.fn(() => ({})),
      resolveSearchUsage,
    }))

    return resolveSearchUsage
  }

  it('double-count guard: a gateway-bundled web_search turn never records a '
    + 'searchCost, even when the search accounting reports one', async () => {
    const resolveSearchUsage = mockAlwaysBillableSearchUsage()

    mocks.steps = [openRouterStep(0.0042)]

    const { insertValues } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search'],
    }))
    const persistedUsage = getAssistantInsert(insertValues)?.usage

    expect(resolveSearchUsage).not.toHaveBeenCalled()
    expect(persistedUsage?.totalCost).toBe(0.0042)
    expect(persistedUsage?.searchCost).toBeUndefined()
    expect(persistedUsage?.searchUnits).toBeUndefined()
    expect(mocks.lastMessageMetadata?.usage?.searchCost).toBeUndefined()
  })

  it('double-count guard: Brave through a gateway keeps its own separate '
    + 'searchCost line, because the gateway never billed for it', async () => {
    const resolveSearchUsage = mockAlwaysBillableSearchUsage()

    mocks.steps = [openRouterStep(0.0042)]

    const { insertValues } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
      tools: ['web_search_brave'],
    }))
    const persistedUsage = getAssistantInsert(insertValues)?.usage

    expect(resolveSearchUsage).toHaveBeenCalled()
    expect(persistedUsage?.totalCost).toBe(0.0042)
    expect(persistedUsage?.searchCost).toBe(0.03)
    expect(persistedUsage?.searchUnits).toBe(3)
    expect(persistedUsage?.searchProvider).toBe('brave')
  })

  it('behaves byte-identically to pre-gateway clients when gateway is absent',
    async () => {
      const useChatProviderMock = vi.fn(() => ({
        provider: { id: 'openai' },
        model: {
          id: 'gpt-5-mini',
          name: 'GPT-5 mini',
          tools: [],
          modalities: { input: ['text'], output: ['text'] },
        },
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

      const { insertValues } = await runHandler(baseBody({
        model: 'gpt-5-mini',
      }))

      expect(useChatProviderMock).toHaveBeenCalledWith('gpt-5-mini')
      expect(useGatewayMock).not.toHaveBeenCalled()
      expect(getAssistantInsert(insertValues)?.usage?.totalCost)
        .toBeUndefined()
    })
})
