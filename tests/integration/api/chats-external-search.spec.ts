import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

const EXTERNAL_SEARCH_MODEL_ID = 'gpt-5-mini'
const EXTERNAL_SEARCH_PROVIDER_ID = 'openai'

/**
 * Drives the real send pipeline with a real, un-mocked
 * `getBraveWebSearchTools`/`getExaWebSearchTools` tool registered by WP 1.3's
 * injection point, so this is genuine evidence that the tool key, the
 * `withFollowUpTurn()` multi-step loop, and the search-usage/cost dispatch
 * added in this package all wire together end to end. Only `fetch` (the
 * vendor HTTP call) and the UI-stream plumbing entry points are stubbed.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
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
  createError: (input: { message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  getGeneratedImageFileIds: vi.fn(() => []),
  isKnownImageGenerationModel: vi.fn(() => false),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

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
  query: string,
) {
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      input: JSON.stringify({ query }),
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

function baseBody(tool: string) {
  return {
    model: EXTERNAL_SEARCH_MODEL_ID,
    tools: [tool],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'What shipped recently?' }],
    }],
  }
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

async function runExternalSearchSend(input: {
  tool: 'web_search_brave' | 'web_search_exa'
  toolName: string
  steps: Array<Array<Record<string, unknown>>>
  fetchImpl: typeof fetch
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))
  vi.stubGlobal('fetch', input.fetchImpl)

  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: baseBody(input.tool),
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const chunks = await readClientChunks()

  return {
    doStream,
    assistantInsert,
    chunks,
    keysFindFirst: created.db.query.keys.findFirst,
  }
}

function braveFetch() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      web: {
        results: [{
          title: 'Besidka release notes',
          url: 'https://example.com/release-notes',
          description: 'Latest release notes for Besidka.',
        }],
      },
    }),
  })) as unknown as typeof fetch
}

function exaFetch(costDollarsTotal: number) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      results: [{
        title: 'Besidka release notes',
        url: 'https://example.com/release-notes',
        highlights: ['Latest release notes for Besidka.'],
      }],
      costDollars: { total: costDollarsTotal },
    }),
  })) as unknown as typeof fetch
}

describe('external search send-path wiring', () => {
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
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: EXTERNAL_SEARCH_PROVIDER_ID },
      model: {
        id: EXTERNAL_SEARCH_MODEL_ID,
        name: 'GPT-5 mini',
        tools: ['web_search', 'image_generation'],
        toolCall: true,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
  })

  it('registers the Brave tool under web_search_brave, runs a second '
    + 'turn, and persists searchProvider/searchUnits/searchBillingUnit',
  async () => {
    const {
      doStream,
      assistantInsert,
      chunks,
      keysFindFirst,
    } = await runExternalSearchSend({
      tool: 'web_search_brave',
      toolName: 'web_search_brave',
      steps: [
        createToolCallChunks('call-1', 'web_search_brave', 'besidka release'),
        createTextChunks('Here is what shipped, via Brave.'),
      ],
      fetchImpl: braveFetch(),
    })

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(keysFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1, provider: 'brave' },
    }))
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-web_search_brave',
        state: 'output-available',
      }),
      expect.objectContaining({
        type: 'source-url',
        url: 'https://example.com/release-notes',
        title: 'Besidka release notes',
      }),
    ]))
    expect(assistantInsert?.usage).toEqual(expect.objectContaining({
      searchProvider: 'brave',
      searchUnits: 1,
      searchBillingUnit: 'search',
    }))
    expect(chunks.some(chunk => chunk.type === 'abort')).toBe(false)
  })

  it('registers the Exa tool under web_search_exa and prices the turn '
    + 'from the response\'s own costDollars', async () => {
    const { doStream, assistantInsert } = await runExternalSearchSend({
      tool: 'web_search_exa',
      toolName: 'web_search_exa',
      steps: [
        createToolCallChunks('call-1', 'web_search_exa', 'besidka release'),
        createTextChunks('Here is what shipped, via Exa.'),
      ],
      fetchImpl: exaFetch(0.021),
    })

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-web_search_exa',
        state: 'output-available',
      }),
      expect.objectContaining({
        type: 'source-url',
        url: 'https://example.com/release-notes',
        title: 'Besidka release notes',
      }),
    ]))
    expect(assistantInsert?.usage).toEqual(expect.objectContaining({
      searchProvider: 'exa',
      searchUnits: 1,
      searchBillingUnit: 'search',
      searchCost: 0.021,
    }))
  })
})
