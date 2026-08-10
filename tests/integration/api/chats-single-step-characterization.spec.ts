import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { getModelCostMap } from '../../../server/utils/ai/cost-map'
import {
  getImageGenerationCost,
} from '../../../server/utils/ai/image-generation-cost'

/**
 * Characterization suite for every send shape that must stay single step now
 * that the multi-step tool loop exists. None of these sends carries a
 * `withFollowUpTurn()` tool, so `resolveToolLoopOptions()` returns undefined
 * and no `stopWhen` reaches `streamText()`, whose own default is
 * `stopWhen: isStepCount(1)`. These assertions pin that contract so a later
 * loop change cannot silently widen it. Treat a failure here as a regression
 * in the send path, never as a test to update. The multi-step counterpart
 * lives in `chats-tool-loop.spec.ts`.
 */
const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  streamTextOptions: [] as Array<Record<string, any>>,
  lastMessageMetadata: undefined as Record<string, any> | undefined,
  finishStepCount: 0,
  uiChunks: undefined as Array<Record<string, unknown>> | undefined,
}))

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      const chunks = mocks.uiChunks ?? [
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
      options.onEnd?.({ usage: mocks.usage })

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
        usage: Promise.resolve(mocks.usage),
        steps: Promise.resolve([{ usage: mocks.usage }]),
        finalStep: Promise.resolve({}),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      mocks.finishStepCount += 1
      options.messageMetadata?.({
        part: {
          type: 'finish-step',
        },
      })
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
    keysFindFirst,
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

/**
 * The single-step contract, asserted as explicit absences rather than a
 * whole-object snapshot: `streamText`'s args carry functions and provider
 * instances that no snapshot can compare usefully, and the thing that must
 * stay true is that no multi-step knob is passed at all.
 */
function expectSingleStepStreamTextCall(options: Record<string, any>) {
  expect(options).toBeDefined()
  expect('stopWhen' in options).toBe(false)
  expect('timeout' in options).toBe(false)
  expect('onStepFinish' in options).toBe(false)
  expect('prepareStep' in options).toBe(false)
}

function getAssistantInsert(insertValues: ReturnType<typeof vi.fn>) {
  const call = insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })

  return call?.[0]
}

async function runHandler(body: Record<string, unknown>) {
  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body,
  } as any)

  await result.ready

  return created
}

describe('chat send pipeline: single-step characterization', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    mocks.streamTextOptions = []
    mocks.lastMessageMetadata = undefined
    mocks.finishStepCount = 0
    mocks.uiChunks = undefined

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
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
      public: {},
    })))
  })

  it('(a) plain direct-provider send stays single step and prices tokens '
    + 'from the model cost map', async () => {
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

    const { insertValues } = await runHandler(baseBody())
    const options = mocks.streamTextOptions[0]

    expect(streamText).toHaveBeenCalledTimes(1)
    expectSingleStepStreamTextCall(options)
    expect(options?.tools).toBeUndefined()
    expect(options?.toolChoice).toBeUndefined()
    expect(options?.maxOutputTokens).toBeUndefined()
    expect(options?.reasoning).toBeUndefined()
    expect(options?.providerOptions).toEqual({ openai: {} })

    const modelCost = getModelCostMap()['gpt-5-mini']
    const expectedUsage = {
      model: 'gpt-5-mini',
      provider: 'openai',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputCost: (10 * (modelCost?.input ?? 0)) / 1_000_000,
      outputCost: (20 * (modelCost?.output ?? 0)) / 1_000_000,
    }

    expect(modelCost).toBeDefined()

    expect(getAssistantInsert(insertValues)?.usage).toEqual(expectedUsage)
    expect(mocks.lastMessageMetadata?.usage).toEqual(expectedUsage)
    expect(getAssistantInsert(insertValues)?.usage.totalCost).toBeUndefined()
  })

  it('(b) qwen enable_search send stays single step, sends no AI SDK tool '
    + 'and threads the raw body flags through providerOptions', async () => {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'qwen' },
      model: {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        tools: ['web_search'],
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('useQwen', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {
        enable_search: true,
        search_options: { search_strategy: 'agent' },
      },
      reasoning: undefined,
    })))

    const { insertValues } = await runHandler(baseBody({
      model: 'qwen3.7-plus',
      tools: ['web_search'],
    }))
    const options = mocks.streamTextOptions[0]

    expect(streamText).toHaveBeenCalledTimes(1)
    expectSingleStepStreamTextCall(options)
    expect(options?.tools).toBeUndefined()
    expect(options?.toolChoice).toBeUndefined()
    expect(options?.providerOptions).toEqual({
      qwen: {
        enable_search: true,
        search_options: { search_strategy: 'agent' },
      },
    })
    expect(getAssistantInsert(insertValues)?.usage.totalCost).toBeUndefined()
  })

  it('(e) image-generation send stays single step, forces the tool and '
    + 'persists the tool part with its image cost', async () => {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
        tools: ['image_generation'],
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      imageModel: {},
      imageModelId: 'gpt-image-2',
      tools: {},
      providerOptions: {},
    })))

    mocks.uiChunks = [
      { type: 'start', messageId: 'assistant-1' },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'generate_image',
        input: { prompt: 'A quiet forest', aspectRatio: '1:1' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: {
          status: 'ready',
          provider: 'openai',
          model: 'gpt-image-2',
          fileId: 'file-1',
        },
      },
      { type: 'finish' },
    ]

    const { insertValues } = await runHandler(baseBody({
      tools: ['image_generation'],
    }))
    const options = mocks.streamTextOptions[0]

    expect(streamText).toHaveBeenCalledTimes(1)
    expectSingleStepStreamTextCall(options)
    expect(options?.tools).toEqual({
      generate_image: expect.anything(),
    })
    expect(options?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'generate_image',
    })
    expect(typeof options?.tools.generate_image.execute).toBe('function')

    const assistantInsert = getAssistantInsert(insertValues)

    expect(assistantInsert?.tools).toEqual(['image_generation'])
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-generate_image' }),
    ]))
    const textOutputCost = (20 * (getModelCostMap()['gpt-5-mini']?.output ?? 0))
      / 1_000_000
    const imageCost = getImageGenerationCost('gpt-image-2', '1:1')

    expect(imageCost).toBeDefined()
    expect(assistantInsert?.usage.outputCost).toBe(
      textOutputCost + (imageCost ?? 0),
    )
  })

  it('emits exactly one finish-step per send across every path today',
    async () => {
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

      await runHandler(baseBody())

      expect(mocks.finishStepCount).toBe(1)
    })
})
