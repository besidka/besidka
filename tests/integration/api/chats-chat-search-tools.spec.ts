import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import {
  CHAT_SEARCH_INSTRUCTION,
} from '../../../server/utils/ai/chat-search-tools'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

const CHAT_SEARCH_MODEL_ID = 'gpt-5-mini'
const CHAT_SEARCH_PROVIDER_ID = 'openai'
const GATEWAY_MODEL_ID = 'anthropic/claude-opus-5'
const SEARCH_CHATS_QUERY = 'launch plan'
const BRAVE_QUERY = 'besidka release'

/**
 * Route-level wiring of the cross-chat `search_chats`/`read_chat` tools.
 * `getChatSearchTools` is replaced by a stub that keeps the real budget
 * (`createChatSearchBudget`/`consumeChatSearchCall`) so the 429 behaviour and
 * the per-request budget wiring are genuine, while the D1/FTS access is not
 * needed here — the real tools are unit-tested with their own database
 * fixtures. Brave runs un-mocked apart from `fetch`, to prove the two tool
 * families coexist in one `streamText` call.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  chatSearchToolsInputs: [] as Array<Record<string, any>>,
  isChatSearchToolEnabled: true,
  aiLoggerSet: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      const writer = {
        write: vi.fn(),
        merge: vi.fn((stream: ReadableStream) => {
          mocks.mergedStreams.push(stream)
        }),
      }
      const ready = execute({ writer })

      return { writer, ready }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: mocks.aiLoggerSet,
    emit: vi.fn(() => null),
    getContext: () => ({}),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: { message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  getModelContextFileStorageKeys: vi.fn(() => []),
  getGeneratedImageFileIds: vi.fn(() => []),
  isKnownImageGenerationModel: vi.fn(() => false),
  buildModelContextMessages: vi.fn(
    (messages: unknown) => ({ messages, omittedFiles: [] }),
  ),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
  isPersistedOversizedResponseFailureText: vi.fn(() => false),
  stripUndeliveredInlineDataParts: vi.fn((parts: unknown) => parts),
  persistGatewayGeneratedImageParts: vi.fn(
    async (input: { parts: unknown }) => ({
      parts: input.parts,
      fileIds: [],
    }),
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/memory/tools/enabled', () => ({
  isChatSearchToolEnabled: () => mocks.isChatSearchToolEnabled,
  isMemoryToolsEnabled: () => false,
}))

vi.mock('~~/server/utils/memory/tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')
  const { consumeChatSearchCall } = await import(
    '~~/server/utils/memory/tools/chat-search-budget'
  )

  return {
    getChatSearchTools: (input: Record<string, any>) => {
      mocks.chatSearchToolsInputs.push(input)

      return {
        tools: {
          search_chats: withFollowUpTurn(tool({
            description: 'Stub search_chats.',
            inputSchema: z.object({ query: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return {
                notice: 'Quoted history.',
                results: [{
                  chatId: 'chat-earlier',
                  title: 'Earlier chat',
                  url: '/chats/chat-earlier',
                  snippet: 'We agreed on the launch plan.',
                }],
              }
            },
          })),
          read_chat: withFollowUpTurn(tool({
            description: 'Stub read_chat.',
            inputSchema: z.object({ chatId: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return { notice: 'Quoted history.', chatId: 'chat-earlier' }
            },
          })),
        },
      }
    },
  }
})

function createUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 20,
      text: 20,
      reasoning: undefined,
    },
  }
}

function createToolCallChunks(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
) {
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: 'finish' as const,
      finishReason: {
        unified: 'tool-calls' as const,
        raw: undefined,
      },
      usage: createUsage(),
    },
  ]
}

function searchChatsCall(toolCallId: string) {
  return createToolCallChunks(toolCallId, 'search_chats', {
    query: SEARCH_CHATS_QUERY,
  })
}

function readChatCall(toolCallId: string) {
  return createToolCallChunks(toolCallId, 'read_chat', {
    chatId: 'chat-earlier',
  })
}

function braveCall(toolCallId: string) {
  return createToolCallChunks(toolCallId, 'web_search_brave', {
    query: BRAVE_QUERY,
  })
}

function createTextChunks(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: {
        unified: 'stop' as const,
        raw: undefined,
      },
      usage: createUsage(),
    },
  ]
}

function createScriptedModel(steps: Array<Array<Record<string, unknown>>>) {
  let callCount = 0
  const doStream = vi.fn(async () => {
    const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

    callCount += 1

    return {
      stream: simulateReadableStream({ chunks: chunks as any }),
    }
  })

  return {
    model: new MockLanguageModelV4({ doStream }),
    doStream,
  }
}

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
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

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
        userSettings: { findFirst: vi.fn(async () => undefined) },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: [],
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
        },
        messages: {
          findFirst: vi.fn(async () => undefined),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
  }
}

function braveFetch() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      grounding: {
        generic: [{
          title: 'Besidka release notes',
          url: 'https://example.com/release-notes',
          snippets: ['Latest release notes for Besidka.'],
        }],
      },
    }),
  })) as unknown as typeof fetch
}

async function readClientChunks() {
  const stream = mocks.mergedStreams[0]

  if (!stream) {
    return []
  }

  const chunks: Array<Record<string, any>> = []

  for await (const chunk of stream as any) {
    chunks.push(chunk)
  }

  return chunks
}

function stubChatProvider(toolCall: boolean | undefined) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: CHAT_SEARCH_PROVIDER_ID },
    model: {
      id: CHAT_SEARCH_MODEL_ID,
      name: 'GPT-5 mini',
      tools: ['web_search', 'image_generation'],
      ...(toolCall === undefined ? {} : { toolCall }),
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  tools?: string[]
  providerTools?: Record<string, unknown>
  gateway?: { toolCall: boolean | undefined }
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: input.providerTools ?? {},
    providerOptions: {},
  })))
  vi.stubGlobal('useGateway', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
    generateChatTitle: vi.fn(),
    toolCall: input.gateway?.toolCall,
  })))
  vi.stubGlobal('fetch', braveFetch())

  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: input.gateway
        ? GATEWAY_MODEL_ID
        : CHAT_SEARCH_MODEL_ID,
      ...(input.gateway ? { gateway: 'openrouter' } : {}),
      tools: input.tools ?? [],
      reasoning: 'off',
      messages: [{
        id: 'user-public-1',
        role: 'user',
        parts: [{ type: 'text', text: 'What did we decide about the launch?' }],
      }],
    },
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const chunks = await readClientChunks()

  return { doStream, assistantInsert, chunks }
}

function readToolNames(callOptions: any): string[] {
  const tools = callOptions?.tools ?? []

  return tools.map((declaredTool: { name: string }) => declaredTool.name)
}

function readSystemPrompt(callOptions: any): string {
  const systemMessage = callOptions?.prompt?.find((message: any) => {
    return message.role === 'system'
  })

  return String(systemMessage?.content ?? '')
}

function getChatSearchAttributes() {
  return mocks.aiLoggerSet.mock.calls
    .map(([fields]) => fields as Record<string, any>)
    .filter(fields => fields.attributes?.chatSearch !== undefined)
    .at(-1)?.attributes.chatSearch
}

describe('chat search tools send-path wiring', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.chatSearchToolsInputs = []
    mocks.isChatSearchToolEnabled = true

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
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
    vi.stubGlobal('getRouterParams', (
      event: { params: unknown },
    ) => {
      return event.params
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
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    stubChatProvider(true)
  })

  it('registers both chat tools next to Brave on a tool-calling model and '
    + 'grants the raised step cap', async () => {
    const { doStream, assistantInsert, chunks } = await runSend({
      tools: ['web_search_brave'],
      steps: [
        braveCall('call-1'),
        searchChatsCall('call-2'),
        searchChatsCall('call-3'),
        readChatCall('call-4'),
        searchChatsCall('call-5'),
        braveCall('call-6'),
        createTextChunks('Here is the combined answer.'),
      ],
    })
    const firstCallOptions = doStream.mock.calls[0]?.[0] as any
    const finalCallOptions = doStream.mock.calls[6]?.[0] as any
    const parts = assistantInsert?.parts ?? []

    expect(readToolNames(firstCallOptions).sort()).toEqual([
      'read_chat',
      'search_chats',
      'web_search_brave',
    ])
    expect(doStream).toHaveBeenCalledTimes(7)
    expect(readToolNames(doStream.mock.calls[3]?.[0])).not.toEqual([])
    expect(finalCallOptions?.toolChoice).toEqual({ type: 'none' })
    expect(finalCallOptions?.tools).toBeUndefined()
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'text',
      text: 'Here is the combined answer.',
    }))
    expect(chunks.map(chunk => chunk.type)).not.toContain('error')
    expect(chunks.map(chunk => chunk.type)).not.toContain('abort')
  })

  it('wires the request budget, user and chat id into the tool factory '
    + 'without a project id', async () => {
    await runSend({ steps: [createTextChunks('No lookup needed.')] })

    expect(mocks.chatSearchToolsInputs).toHaveLength(1)
    expect(mocks.chatSearchToolsInputs[0]).toEqual(expect.objectContaining({
      userId: 1,
      currentChatId: 'chat-1',
      budget: { maxCalls: 3, usedCalls: 0 },
    }))
    expect(mocks.chatSearchToolsInputs[0]?.projectId).toBeUndefined()
    expect(getChatSearchAttributes()).toEqual({
      registered: true,
      usedCalls: 0,
    })
  })

  it('turns an exhausted chat budget into a tool-error part and still '
    + 'answers, without failing the turn', async () => {
    const { assistantInsert, chunks } = await runSend({
      tools: ['web_search_brave'],
      steps: [
        braveCall('call-1'),
        searchChatsCall('call-2'),
        searchChatsCall('call-3'),
        readChatCall('call-4'),
        searchChatsCall('call-5'),
        braveCall('call-6'),
        createTextChunks('Answer after the budget error.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const budgetErrorPart = parts.find((part: any) => {
      return part.toolCallId === 'call-5'
    })

    expect(budgetErrorPart).toEqual(expect.objectContaining({
      type: 'tool-search_chats',
      state: 'output-error',
    }))
    expect(budgetErrorPart?.errorText).toContain('limit')
    expect(getChatSearchAttributes()).toEqual({
      registered: true,
      usedCalls: 3,
    })
    expect(parts.filter((part: any) => {
      return part.type === 'tool-search_chats'
        && part.state === 'output-available'
    })).toHaveLength(2)
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-read_chat',
      state: 'output-available',
    }))
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'text',
      text: 'Answer after the budget error.',
    }))
    expect(chunks.map(chunk => chunk.type)).not.toContain('error')
    expect(chunks.map(chunk => chunk.type)).not.toContain('abort')
    expect(assistantInsert?.usage).toEqual(expect.objectContaining({
      searchProvider: 'brave',
      searchUnits: 2,
      searchBillingUnit: 'search',
    }))
  })

  it('never counts chat tool calls as billable web searches', async () => {
    const { assistantInsert } = await runSend({
      steps: [
        searchChatsCall('call-1'),
        readChatCall('call-2'),
        createTextChunks('From your earlier chat.'),
      ],
    })

    expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
      type: 'tool-search_chats',
      state: 'output-available',
    }))
    expect(assistantInsert?.parts).not.toContainEqual(expect.objectContaining({
      type: 'source-url',
    }))
    expect(assistantInsert?.usage?.searchUnits).toBeUndefined()
    expect(assistantInsert?.usage?.searchProvider).toBeUndefined()
    expect(assistantInsert?.usage?.searchCost).toBeUndefined()
  })

  it('puts the chat-search instruction first in the stable prefix, ahead '
    + 'of the dated search instruction', async () => {
    const { doStream } = await runSend({
      tools: ['web_search_brave'],
      steps: [createTextChunks('No search needed.')],
    })
    const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

    expect(systemPrompt.startsWith(CHAT_SEARCH_INSTRUCTION)).toBe(true)
    expect(systemPrompt.indexOf(CHAT_SEARCH_INSTRUCTION))
      .toBeLessThan(systemPrompt.indexOf('Today\'s date'))
    expect(systemPrompt).toContain('Today\'s date')
  })

  it('keeps the instruction line constant across turns', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T23:30:00.000Z'))

    const first = await runSend({
      steps: [createTextChunks('First.')],
    })

    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'))
    mocks.mergedStreams = []
    vi.resetModules()

    const second = await runSend({
      steps: [createTextChunks('Second.')],
    })

    expect(readSystemPrompt(first.doStream.mock.calls[0]?.[0]))
      .toBe(CHAT_SEARCH_INSTRUCTION)
    expect(readSystemPrompt(second.doStream.mock.calls[0]?.[0]))
      .toBe(CHAT_SEARCH_INSTRUCTION)
  })

  it.each([
    ['false', false],
    ['undefined', undefined],
  ])('registers nothing and stays single step when the model toolCall is %s',
    async (_label, toolCall) => {
      stubChatProvider(toolCall)

      const { doStream, assistantInsert } = await runSend({
        steps: [createTextChunks('Plain answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(getChatSearchAttributes()).toBeUndefined()
      expect(doStream).toHaveBeenCalledTimes(1)
      expect(callOptions?.tools).toBeUndefined()
      expect(readSystemPrompt(callOptions)).not.toContain(
        CHAT_SEARCH_INSTRUCTION,
      )
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Plain answer.',
      }))
    })

  it('registers the chat tools on a gateway send only when the gateway '
    + 'reports toolCall true', async () => {
    const supported = await runSend({
      gateway: { toolCall: true },
      steps: [createTextChunks('Gateway answer.')],
    })

    expect(readToolNames(supported.doStream.mock.calls[0]?.[0]).sort())
      .toEqual(['read_chat', 'search_chats'])
    expect(readSystemPrompt(supported.doStream.mock.calls[0]?.[0]))
      .toContain(CHAT_SEARCH_INSTRUCTION)
  })

  it.each([
    ['false', false],
    ['undefined', undefined],
  ])('registers nothing on a gateway send when toolCall is %s',
    async (_label, toolCall) => {
      mocks.mergedStreams = []

      const { doStream } = await runSend({
        gateway: { toolCall },
        steps: [createTextChunks('Gateway answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(callOptions?.tools).toBeUndefined()
      expect(readSystemPrompt(callOptions)).not.toContain(
        CHAT_SEARCH_INSTRUCTION,
      )
    })

  it('registers nothing on a gateway image-generation send, which forces '
    + 'no toolChoice', async () => {
    const { doStream } = await runSend({
      gateway: { toolCall: true },
      tools: ['image_generation'],
      steps: [createTextChunks('Here is your image.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any

    expect(mocks.chatSearchToolsInputs).toHaveLength(0)
    expect(callOptions?.tools).toBeUndefined()
    expect(readSystemPrompt(callOptions)).not.toContain(
      CHAT_SEARCH_INSTRUCTION,
    )
  })

  it('registers nothing when the gate is switched off', async () => {
    mocks.isChatSearchToolEnabled = false

    const { doStream } = await runSend({
      steps: [createTextChunks('Plain answer.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any

    expect(mocks.chatSearchToolsInputs).toHaveLength(0)
    expect(callOptions?.tools).toBeUndefined()
    expect(readSystemPrompt(callOptions)).not.toContain(
      CHAT_SEARCH_INSTRUCTION,
    )
  })

  it('does not register the chat tools next to a forced toolChoice',
    async () => {
      const forcedTool = tool({
        description: 'Forced tool.',
        inputSchema: z.object({ prompt: z.string() }),
        async execute() {
          return { ok: true }
        },
      })
      const { doStream } = await runSend({
        steps: [
          createToolCallChunks('call-1', 'generate_image', { prompt: 'cat' }),
          createTextChunks('Never reached.'),
        ],
        providerTools: {
          tools: { generate_image: forcedTool },
          toolChoice: { type: 'tool', toolName: 'generate_image' },
        },
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(readToolNames(callOptions)).toEqual(['generate_image'])
      expect(callOptions?.toolChoice).toEqual({
        type: 'tool',
        toolName: 'generate_image',
      })
      expect(doStream).toHaveBeenCalledTimes(1)
      expect(readSystemPrompt(callOptions)).not.toContain(
        CHAT_SEARCH_INSTRUCTION,
      )
    })

  it('leaves the instruction out of the tool-less search-answer '
    + 'continuation', async () => {
    const { doStream, assistantInsert } = await runSend({
      steps: [
        searchChatsCall('call-1'),
        searchChatsCall('call-2'),
        searchChatsCall('call-3'),
        readChatCall('call-4'),
        createTextChunks('Answer from the continuation.'),
      ],
    })
    const continuationCallOptions = doStream.mock.calls[4]?.[0] as any

    expect(doStream).toHaveBeenCalledTimes(5)
    expect(readSystemPrompt(doStream.mock.calls[0]?.[0]))
      .toContain(CHAT_SEARCH_INSTRUCTION)
    expect(continuationCallOptions?.tools).toBeUndefined()
    expect(readSystemPrompt(continuationCallOptions)).not.toContain(
      CHAT_SEARCH_INSTRUCTION,
    )
    expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
      type: 'text',
      text: 'Answer from the continuation.',
    }))
  })
})
