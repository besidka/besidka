import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { APICallError, simulateReadableStream } from 'ai'
import { JEV_AUTO_WEB_SEARCH } from '#shared/utils/jev-policy'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const MODEL_ID = 'gpt-5-mini'
const PROVIDER_ID = 'openai'
const SENT_MESSAGE_ID = 'user-public-1'
const QUESTION_ID = JEV_AUTO_WEB_SEARCH.questionId

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  decide: vi.fn(),
  loggerSet: vi.fn(),
  kvValues: new Map<string, string>(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
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

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: async (value: string) => `decrypted-${value}`,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
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
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

interface PersistedMessage {
  id: string
  publicId: string
  role: 'user' | 'assistant'
  parts: Array<Record<string, unknown>>
  tools: string[]
  reasoning: 'off'
  usage: null
  createdAt: Date
}

interface SendInput {
  tools: string[]
  webSearchMode?: 'auto' | 'always'
  hasTypesafeKey: boolean
  typesafeRoles?: Record<string, boolean> | null
  messages?: PersistedMessage[]
  text?: string
}

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

function createTextModel() {
  const doStream = vi.fn(async () => {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'A plain answer.' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: createUsage(),
          },
        ] as any,
      }),
    }
  })

  return { model: new MockLanguageModelV4({ doStream }), doStream }
}

function persistedUserMessage(
  publicId: string,
  tools: string[],
): PersistedMessage {
  return {
    id: `db-${publicId}`,
    publicId,
    role: 'user',
    parts: [{ type: 'text', text: 'Write a haiku about autumn' }],
    tools,
    reasoning: 'off',
    usage: null,
    createdAt: new Date('2026-10-26T10:00:00.000Z'),
  }
}

function createDb(input: SendInput) {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
  const keysFindFirst = vi.fn(async (query: {
    where: { provider: string }
  }) => {
    if (query.where.provider === 'typesafe') {
      return input.hasTypesafeKey ? { apiKey: 'typesafe-key' } : undefined
    }

    return { apiKey: 'encrypted-key' }
  })

  insertValues.mockImplementation(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({
      returning: () => ({ get: insertGet }),
    }),
  }))

  return {
    db: {
      query: {
        userSettings: {
          findFirst: vi.fn(async () => ({
            memoryEnabled: false,
            chatSearchEnabled: false,
            memoryIncludeSensitive: false,
            aboutMe: null,
            typesafeRoles: input.typesafeRoles ?? null,
          })),
        },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: input.messages ?? [],
          })),
        },
        keys: { findFirst: keysFindFirst },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
    keysFindFirst,
    updateSet,
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

function readToolNames(doStream: ReturnType<typeof vi.fn>): string[] {
  const [options] = doStream.mock.calls[0] as unknown as [
    { tools?: Array<{ name: string }> },
  ]

  return (options.tools ?? []).map(tool => tool.name).sort()
}

function readSystemPrompt(doStream: ReturnType<typeof vi.fn>): string {
  const [options] = doStream.mock.calls[0] as unknown as [
    { prompt: Array<{ role: string, content: unknown }> },
  ]

  return String(options.prompt.find((message) => {
    return message.role === 'system'
  })?.content ?? '')
}

function readAutoWebSearchLog(): Record<string, any> | undefined {
  const calls = mocks.loggerSet.mock.calls as Array<[Record<string, any>]>

  return calls
    .map(([fields]) => fields.attributes?.autoWebSearchJev)
    .filter(Boolean)
    .at(-1)
}

async function runSend(input: SendInput) {
  const { model, doStream } = createTextModel()

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))

  const module = await import('../../../server/api/v1/chats/[slug]/index.post')
  const created = createDb(input)

  vi.stubGlobal('useDb', () => created.db)

  const result = await module.default({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: MODEL_ID,
      tools: input.tools,
      ...(input.webSearchMode ? { webSearchMode: input.webSearchMode } : {}),
      reasoning: 'off',
      messages: [{
        id: SENT_MESSAGE_ID,
        role: 'user',
        parts: [{
          type: 'text',
          text: input.text ?? 'Write a haiku about autumn',
        }],
      }],
    },
  } as any)

  await (result as { ready: Promise<unknown> }).ready

  const userInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'user'
  })?.[0]
  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const chunks = await readClientChunks()
  const finishMetadata = chunks.find((chunk) => {
    return chunk.type === 'finish'
  })?.messageMetadata

  return {
    toolNames: readToolNames(doStream),
    systemPrompt: readSystemPrompt(doStream),
    userInsert,
    assistantInsert,
    finishMetadata,
    keysFindFirst: created.keysFindFirst,
    updateSet: created.updateSet,
  }
}

function jevAnswer(probability: number) {
  return {
    answers: { [QUESTION_ID]: { type: 'boolean', probability } },
    usage: { inputTokens: 443 },
  }
}

function braveKeyLookups(keysFindFirst: ReturnType<typeof vi.fn>) {
  return keysFindFirst.mock.calls.filter(([query]) => {
    return (query as { where: { provider: string } }).where.provider === 'brave'
  })
}

describe('Auto web search on the chat send path', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.decide.mockReset().mockResolvedValue(jevAnswer(0.05))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'))

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
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
    mocks.kvValues.clear()
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async (key: string) => mocks.kvValues.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        mocks.kvValues.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        mocks.kvValues.delete(key)
      }),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: PROVIDER_ID },
      model: {
        id: MODEL_ID,
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

  it('without a TypeSafe AI key behaves exactly like the always mode',
    async () => {
      const always = await runSend({
        tools: ['web_search_brave'],
        hasTypesafeKey: false,
      })

      vi.clearAllMocks()
      mocks.mergedStreams = []

      const auto = await runSend({
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        hasTypesafeKey: false,
      })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(auto.toolNames)
        .toEqual(always.toolNames)
      expect(auto.toolNames).toContain('web_search_brave')
      expect(auto.systemPrompt)
        .toBe(always.systemPrompt)
      expect(auto.userInsert?.tools).toEqual(['web_search_brave'])
      expect(auto.userInsert?.tools).toEqual(always.userInsert?.tools)
      expect(auto.assistantInsert?.usage?.autoWebSearch).toBeUndefined()
      expect(auto.finishMetadata?.usage?.autoWebSearch).toBeUndefined()
      expect(readAutoWebSearchLog()).toBeUndefined()
    })

  it('skips the search and the search prompt when Jev says no search is '
    + 'needed, and persists the resolved tools', async () => {
    const always = await runSend({
      tools: [],
      hasTypesafeKey: true,
    })

    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.decide.mockResolvedValue(jevAnswer(0.05))

    const skipped = await runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
    })

    expect(mocks.decide).toHaveBeenCalledTimes(1)
    expect(skipped.toolNames).not.toContain('web_search_brave')
    expect(skipped.systemPrompt)
      .toBe(always.systemPrompt)
    expect(braveKeyLookups(skipped.keysFindFirst)).toHaveLength(1)
    expect(skipped.userInsert?.tools).toEqual([])
    expect(skipped.assistantInsert?.usage?.autoWebSearch).toBe('skipped')
    expect(skipped.finishMetadata?.usage?.autoWebSearch).toBe('skipped')
    expect(readAutoWebSearchLog()).toMatchObject({
      status: 'ok',
      calls: 1,
      counts: { skipped: 1 },
    })
  })

  it('searches with the chosen provider when Jev says a search is needed',
    async () => {
      mocks.decide.mockResolvedValue(jevAnswer(0.9))

      const searched = await runSend({
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        hasTypesafeKey: true,
      })

      expect(searched.toolNames).toContain('web_search_brave')
      expect(searched.userInsert?.tools).toEqual(['web_search_brave'])
      expect(searched.assistantInsert?.usage?.autoWebSearch).toBe('searched')
    })

  it.each([
    ['a 401', () => new APICallError({
      message: 'unauthorized',
      url: 'https://api.typesafe.ai/v1/systemone',
      requestBodyValues: {},
      statusCode: 401,
    }), 'unauthorized'],
    ['a timeout', () => {
      const exception = new Error('The operation timed out')

      exception.name = 'TimeoutError'

      return exception
    }, 'timeout'],
  ])('searches as usual after %s from Jev', async (_label, error, status) => {
    mocks.decide.mockRejectedValue(error())

    const fallback = await runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
    })

    expect(fallback.toolNames).toContain('web_search_brave')
    expect(fallback.userInsert?.tools).toEqual(['web_search_brave'])
    expect(fallback.assistantInsert?.usage?.autoWebSearch).toBe('fallback')
    expect(readAutoWebSearchLog()).toMatchObject({
      status,
      counts: { fallback: 1 },
    })
  })

  it('forces a search for a message with a URL without calling Jev',
    async () => {
      const forced = await runSend({
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        hasTypesafeKey: true,
        text: 'Summarise https://example.com/changelog',
      })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(forced.toolNames).toContain('web_search_brave')
      expect(forced.assistantInsert?.usage?.autoWebSearch).toBe('forced')
    })

  it('sends the last turns of the chat with the message', async () => {
    const earlier: PersistedMessage[] = [
      persistedUserMessage('user-public-0', ['web_search_brave']),
      {
        ...persistedUserMessage('assistant-public-0', []),
        role: 'assistant',
        parts: [{ type: 'text', text: 'Bitcoin is at 70k today.' }],
      },
    ]

    await runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
      messages: earlier,
      text: 'and in euros?',
    })

    const [options] = mocks.decide.mock.calls[0] as [Record<string, any>]

    expect(options.state).toEqual({
      message: 'and in euros?',
      recent_turns: [
        { role: 'user', text: 'Write a haiku about autumn' },
        { role: 'assistant', text: 'Bitcoin is at 70k today.' },
      ],
    })
  })

  it.each([
    [[] as string[], 'skipped'],
    [['web_search_brave'], 'searched'],
  ])('reuses a retried message\'s persisted tools %j without a second Jev '
    + 'call', async (persistedTools, outcome) => {
    const earlier: PersistedMessage[] = [
      persistedUserMessage('user-public-0', ['web_search_brave']),
      {
        ...persistedUserMessage('assistant-public-0', []),
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier answer.' }],
      },
      persistedUserMessage(SENT_MESSAGE_ID, persistedTools),
    ]

    const retried = await runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
      messages: earlier,
    })

    expect(mocks.decide).not.toHaveBeenCalled()
    expect(retried.userInsert).toBeUndefined()
    expect(retried.toolNames.includes('web_search_brave'))
      .toBe(persistedTools.length > 0)
    expect(retried.assistantInsert?.usage?.autoWebSearch).toBe(outcome)
  })

  it.each([
    [0.05, 'skipped', [] as string[]],
    [0.9, 'searched', ['web_search_brave']],
  ])('decides a new chat\'s first message in its first POST (score %s)',
    async (score, outcome, resolvedTools) => {
      mocks.decide.mockResolvedValue(jevAnswer(score))

      const first = await runSend({
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        hasTypesafeKey: true,
        messages: [persistedUserMessage(SENT_MESSAGE_ID, ['web_search_brave'])],
      })

      expect(mocks.decide).toHaveBeenCalledTimes(1)
      expect(first.toolNames.includes('web_search_brave'))
        .toBe(resolvedTools.length > 0)
      expect(first.assistantInsert?.usage?.autoWebSearch).toBe(outcome)
      expect([...mocks.kvValues.entries()]).toEqual([[
        `auto-web-search-first-message:chat-1:${SENT_MESSAGE_ID}`,
        outcome,
      ]])

      const toolUpdates = first.updateSet.mock.calls.filter(([values]) => {
        return 'tools' in (values as Record<string, unknown>)
      })

      expect(toolUpdates).toEqual(
        resolvedTools.length > 0 ? [] : [[{ tools: resolvedTools }]],
      )
    })

  it.each([
    [[] as string[], 'skipped'],
    [['web_search_brave'], 'searched'],
  ])('reuses the decided first message\'s persisted tools %j on a retry',
    async (persistedTools, outcome) => {
      mocks.kvValues.set(
        `auto-web-search-first-message:chat-1:${SENT_MESSAGE_ID}`,
        outcome,
      )

      const retried = await runSend({
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        hasTypesafeKey: true,
        messages: [persistedUserMessage(SENT_MESSAGE_ID, persistedTools)],
      })

      expect(mocks.decide).not.toHaveBeenCalled()
      expect(retried.toolNames.includes('web_search_brave'))
        .toBe(persistedTools.length > 0)
      expect(retried.assistantInsert?.usage?.autoWebSearch).toBe(outcome)
    })

  it('decides a first message from the tools the PUT persisted even when '
    + 'the client sent none while its model capability was loading',
  async () => {
    const first = await runSend({
      tools: [],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
      messages: [persistedUserMessage(SENT_MESSAGE_ID, ['web_search_brave'])],
    })

    expect(mocks.decide).toHaveBeenCalledTimes(1)
    expect(first.toolNames).not.toContain('web_search_brave')
    expect(first.assistantInsert?.usage?.autoWebSearch).toBe('skipped')
  })

  it('validates the requested tools before asking Jev: a model without '
    + 'tool calling answers 400 and nothing reaches TypeSafe AI', async () => {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: PROVIDER_ID },
      model: {
        id: MODEL_ID,
        name: 'GPT-5 mini',
        tools: ['web_search'],
        toolCall: false,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))

    await expect(runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
    })).rejects.toMatchObject({ status: 400 })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('validates a missing Brave key before asking Jev', async () => {
    const module = await import('../../../server/api/v1/chats/[slug]/index.post')
    const created = createDb({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
    })

    created.keysFindFirst.mockImplementation(async (query: {
      where: { provider: string }
    }) => {
      return query.where.provider === 'typesafe'
        ? { apiKey: 'typesafe-key' }
        : undefined
    })
    vi.stubGlobal('useDb', () => created.db)

    await expect(module.default({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: MODEL_ID,
        tools: ['web_search_brave'],
        webSearchMode: 'auto',
        reasoning: 'off',
        messages: [{
          id: SENT_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Write a haiku about autumn' }],
        }],
      },
    } as any)).rejects.toMatchObject({ status: 400 })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('checks the transfer consent before asking Jev', async () => {
    const consent = await import('~~/server/utils/legal/consent')
    const granted = await consent.requireLegalConsent(1)

    vi.mocked(consent.requireLegalConsent).mockResolvedValueOnce({
      ...granted,
      providerTransferConsents: null,
    })
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'deepseek' },
      model: {
        id: 'deepseek-chat',
        name: 'DeepSeek',
        tools: [],
        toolCall: true,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))

    await expect(runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
    })).rejects.toMatchObject({ status: 403 })
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('ignores Auto when the autoWebSearch role is off', async () => {
    const result = await runSend({
      tools: ['web_search_brave'],
      webSearchMode: 'auto',
      hasTypesafeKey: true,
      typesafeRoles: { autoWebSearch: false },
    })

    expect(mocks.decide).not.toHaveBeenCalled()
    expect(result.toolNames).toContain('web_search_brave')
    expect(result.assistantInsert?.usage?.autoWebSearch).toBeUndefined()
  })
})
