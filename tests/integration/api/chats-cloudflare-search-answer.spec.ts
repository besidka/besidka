import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPersistedEmptyAnswerFailureText } from '#shared/utils/chat-failure-text'

/**
 * Drives a Cloudflare AI Gateway + Brave search send through the real route,
 * the real Cloudflare gateway builder and catalog normalizer, and the real
 * `@ai-sdk/openai-compatible` provider. Only `fetch` is replaced: the catalog
 * endpoints answer with the shapes a live account returns, Brave answers
 * with LLM Context fixtures, and chat completions answer with SSE shaped
 * like Workers AI's `@cf/openai/gpt-oss-120b` stream, including its
 * behaviour when a request omits `max_tokens`: a 256-token default that the
 * model spends entirely on `reasoning_content`, ending in
 * `finish_reason: length` with empty `content`.
 */
const MODEL_ID = '@cf/openai/gpt-oss-120b'
const WORKERS_AI_DEFAULT_MAX_TOKENS = 256
const CONTINUATION_REASONING_TOKENS = 400
const CONTEXT_LENGTH = 128000
const CONTEXT_SAFETY_MARGIN_TOKENS = 1024
const CONTINUATION_ANSWER = '**Новини Польщі** — [TVN24](https://tvn24.pl/a).'
const USER_PROMPT = 'останні новини в польщі за сьогодні — коротко, з джерелами'

const SEARCHES = [
  {
    query: 'Poland news October 4 2026',
    results: [
      { url: 'https://tvn24.pl/a', title: 'TVN24', snippet: 'Top story.' },
      { url: 'https://example.pl/b', title: 'Example', snippet: 'Second.' },
    ],
  },
  {
    query: 'Poland today news site:wyborcza.pl',
    results: [],
  },
  {
    query: 'Poland news October 4 2026 TVN24',
    results: [
      { url: 'https://tvn24.pl/c', title: 'TVN24 digest', snippet: 'Digest.' },
    ],
  },
]

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  loggerSet: vi.fn(),
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
    set: mocks.loggerSet,
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
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
  isPersistedOversizedResponseFailureText: vi.fn(() => false),
  stripUndeliveredInlineDataParts: vi.fn((parts: unknown) => parts),
  persistGatewayGeneratedImageParts: vi.fn(
    async (input: { parts: unknown }) => ({ parts: input.parts, fileIds: [] }),
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

interface ChatCompletionRequest {
  max_tokens?: number
  tools?: unknown[]
  messages: Array<{ role: string }>
}

function buildMarketplaceCatalog(maxOutputLength: number | undefined) {
  return {
    data: [{
      id: MODEL_ID,
      name: 'OpenAI: Gpt Oss 120B',
      input_modalities: ['text'],
      output_modalities: ['text'],
      context_length: 128000,
      ...(maxOutputLength === undefined
        ? {}
        : { max_output_length: maxOutputLength }),
      pricing: { prompt: '0.0000003500', completion: '0.0000007500' },
      supported_features: ['tools', 'reasoning'],
    }],
  }
}

const DEFAULT_FORMAT_CATALOG = {
  result: [{
    name: MODEL_ID,
    properties: [
      { property_id: 'context_window', value: '128000' },
      {
        property_id: 'price',
        value: [
          { unit: 'per M input tokens', price: 0.35, currency: 'USD' },
          { unit: 'per M output tokens', price: 0.75, currency: 'USD' },
        ],
      },
      { property_id: 'function_calling', value: 'true' },
      { property_id: 'reasoning', value: 'true' },
    ],
  }],
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(deltas: Array<{
  delta: Record<string, unknown>
  finishReason?: string
  usage?: { prompt_tokens: number, completion_tokens: number }
}>): Response {
  const lines = deltas.map((entry) => {
    return `data: ${JSON.stringify({
      id: 'cf-chunk',
      object: 'chat.completion.chunk',
      created: 1,
      model: MODEL_ID,
      choices: [{
        index: 0,
        delta: entry.delta,
        finish_reason: entry.finishReason ?? null,
      }],
      ...(entry.usage
        ? {
          usage: {
            ...entry.usage,
            total_tokens: entry.usage.prompt_tokens
              + entry.usage.completion_tokens,
          },
        }
        : {}),
    })}\n\n`
  })

  return new Response(`${lines.join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function reasoningDelta(text: string) {
  return { delta: { reasoning: text, reasoning_content: text } }
}

function toolCallResponse(toolCallId: string, input: unknown): Response {
  return sseResponse([
    {
      delta: { role: 'assistant', content: '' },
      usage: { prompt_tokens: 1000, completion_tokens: 0 },
    },
    reasoningDelta('Search first.'),
    {
      delta: {
        tool_calls: [{
          index: 0,
          id: toolCallId,
          type: 'function',
          function: {
            name: 'web_search_brave',
            arguments: JSON.stringify(input),
          },
        }],
      },
    },
    {
      delta: {},
      finishReason: 'tool_calls',
      usage: { prompt_tokens: 1000, completion_tokens: 40 },
    },
  ])
}

function continuationResponse(request: ChatCompletionRequest): Response {
  const budget = request.max_tokens ?? WORKERS_AI_DEFAULT_MAX_TOKENS

  if (budget < CONTINUATION_REASONING_TOKENS) {
    return sseResponse([
      {
        delta: { role: 'assistant', content: '' },
        usage: { prompt_tokens: 5000, completion_tokens: 0 },
      },
      reasoningDelta('The user asks for today\'s news in Poland. '),
      reasoningDelta('We have several sources. We\'ll pick 5-6 key items:'),
      {
        delta: {},
        finishReason: 'length',
        usage: { prompt_tokens: 5000, completion_tokens: budget },
      },
    ])
  }

  return sseResponse([
    {
      delta: { role: 'assistant', content: '' },
      usage: { prompt_tokens: 5000, completion_tokens: 0 },
    },
    reasoningDelta('The user asks for today\'s news in Poland.'),
    { delta: { content: CONTINUATION_ANSWER } },
    {
      delta: {},
      finishReason: 'stop',
      usage: {
        prompt_tokens: 5000,
        completion_tokens: CONTINUATION_REASONING_TOKENS + 50,
      },
    },
  ])
}

function braveResponse(searchIndex: number): Response {
  const results = SEARCHES[searchIndex]?.results ?? []

  return jsonResponse({
    grounding: {
      generic: results.map((result) => {
        return {
          url: result.url,
          title: result.title,
          snippets: [result.snippet],
        }
      }),
    },
  })
}

function stubWorkersAiFetch(maxOutputLength: number | undefined) {
  const chatRequests: ChatCompletionRequest[] = []
  let braveCallCount = 0
  let toolCallStepCount = 0

  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)

    if (href.includes('format=openrouter')) {
      return jsonResponse(buildMarketplaceCatalog(maxOutputLength))
    }

    if (href.includes('/ai/models/search')) {
      return jsonResponse(DEFAULT_FORMAT_CATALOG)
    }

    if (href.includes('api.search.brave.com')) {
      braveCallCount += 1

      return braveResponse(braveCallCount - 1)
    }

    if (!href.includes('/ai/v1/chat/completions')) {
      throw new Error(`Unexpected fetch: ${href}`)
    }

    const request = JSON.parse(String(init?.body)) as ChatCompletionRequest

    chatRequests.push(request)

    if (request.tools) {
      const search = SEARCHES[toolCallStepCount]

      toolCallStepCount += 1

      return toolCallResponse(`call-${toolCallStepCount}`, {
        query: search?.query,
        freshness: 'day',
      })
    }

    const isForcedStep = request.messages.some((message) => {
      return message.role === 'tool'
    })

    if (isForcedStep) {
      return toolCallResponse('call-forced', { cursor: 2, id: 0 })
    }

    return continuationResponse(request)
  }))

  return { chatRequests }
}

function createDb() {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))

  insertValues.mockImplementation(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({
      returning: () => ({ get: insertGet }),
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
          findFirst: vi.fn(async (query: { where: { provider: string } }) => {
            return query.where.provider === 'brave'
              ? { apiKey: 'encrypted-brave-key' }
              : { apiKey: 'encrypted-cloudflare-key' }
          }),
        },
        messages: {
          findFirst: vi.fn(async () => undefined),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    },
    insertValues,
  }
}

async function runCloudflareSearchSend(maxOutputLength: number | undefined) {
  const { chatRequests } = stubWorkersAiFetch(maxOutputLength)
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const gateways = await import('../../../server/utils/gateways/index')

  for (const [name, value] of Object.entries(gateways)) {
    if (typeof value === 'function') {
      vi.stubGlobal(name, value)
    }
  }

  const handler = (await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )).default as (event: unknown) => Promise<{ ready: Promise<unknown> }>
  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: MODEL_ID,
      gateway: 'cloudflare',
      tools: ['web_search_brave'],
      reasoning: 'off',
      messages: [{
        id: 'user-public-1',
        role: 'user',
        parts: [{ type: 'text', text: USER_PROMPT }],
      }],
    },
  })

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const toolLoop = mocks.aiLoggerSet.mock.calls
    .map(([fields]) => fields?.attributes?.toolLoop)
    .find(Boolean)
  const persistedText = assistantInsert?.parts
    .filter((part: { type: string }) => part.type === 'text')
    .map((part: { text: string }) => part.text)
    .join('')

  return { chatRequests, assistantInsert, toolLoop, persistedText }
}

describe('Cloudflare gpt-oss search answer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []

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
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useStorage', () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (value: string) => {
      return value === 'encrypted-cloudflare-key'
        ? JSON.stringify({ accountId: 'account-1', apiKey: 'cf-token' })
        : 'brave-key'
    }))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: {} })))
  })

  it('sends a context-sized catalog max_tokens on every step so the continuation '
    + 'answers after three searches', async () => {
    const {
      chatRequests,
      toolLoop,
      persistedText,
    } = await runCloudflareSearchSend(CONTEXT_LENGTH)

    expect(chatRequests).toHaveLength(5)
    chatRequests.forEach((request) => {
      expect(request.max_tokens).toBeLessThanOrEqual(
        CONTEXT_LENGTH - CONTEXT_SAFETY_MARGIN_TOKENS,
      )
      expect(request.max_tokens).toBeGreaterThan(CONTEXT_LENGTH / 2)
    })
    expect(persistedText).toBe(CONTINUATION_ANSWER)
    expect(toolLoop).toMatchObject({
      forcedStepRejectedToolCall: true,
      continuationRan: true,
      continuationProducedText: true,
      continuationFinishReason: 'stop',
    })
  })

  it('records the continuation\'s own length finish when Workers AI\'s '
    + 'default max_tokens truncates it inside reasoning', async () => {
    const {
      chatRequests,
      toolLoop,
      persistedText,
    } = await runCloudflareSearchSend(undefined)

    expect(chatRequests.at(-1)?.max_tokens).toBeUndefined()
    expect(persistedText).toBe(getPersistedEmptyAnswerFailureText())
    expect(toolLoop).toMatchObject({
      continuationRan: true,
      continuationProducedText: false,
      continuationFinishReason: 'length',
    })
  })
})
