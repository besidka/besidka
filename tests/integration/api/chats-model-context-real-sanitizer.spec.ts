import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamTextOptions: [] as Array<Record<string, any>>,
  toUIMessageStreamOptions: [] as Array<Record<string, any>>,
  convertedMessages: [] as Array<unknown>,
  persistFile: vi.fn(),
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
    convertToModelMessages: vi.fn(
      async (messages: unknown, options?: unknown) => {
        mocks.convertedMessages.push(messages)

        return await actual.convertToModelMessages(
          messages as any,
          options as any,
        )
      },
    ),
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

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
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
        userSettings: { findFirst: vi.fn(async () => undefined) },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: chatMessages,
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
        },
        messages: {
          findFirst: vi.fn(async () => ({
            usage: {
              model: 'x',
              provider: 'x',
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
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

function createHistoryRow(
  index: number,
  role: 'user' | 'assistant',
  parts: Array<Record<string, unknown>>,
) {
  return {
    id: index,
    publicId: `history-public-${index}`,
    role,
    parts,
    tools: [] as string[],
    reasoning: 'off' as const,
    createdAt: new Date(`2026-08-01T00:00:0${index}.000Z`),
  }
}

function createMixedProviderHistory() {
  return [
    createHistoryRow(1, 'user', [{ type: 'text', text: 'First question' }]),
    createHistoryRow(2, 'assistant', [
      {
        type: 'reasoning',
        text: 'Anthropic thinking',
        state: 'done',
        providerMetadata: { anthropic: { signature: 'sig' } },
      },
      { type: 'text', text: 'Anthropic answer' },
    ]),
    createHistoryRow(3, 'user', [{ type: 'text', text: 'Second question' }]),
    createHistoryRow(4, 'assistant', [
      {
        type: 'text',
        text: 'OpenAI answer',
        providerMetadata: { openai: { itemId: 'msg_1' } },
      },
      {
        type: 'tool-web_search_brave',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { query: 'besidka' },
        output: { results: [] },
      },
      {
        type: 'source-url',
        sourceId: 'source-1',
        url: 'https://example.com',
      },
    ]),
    createHistoryRow(5, 'user', [{ type: 'text', text: 'Third question' }]),
    createHistoryRow(6, 'assistant', [{
      type: 'reasoning',
      text: 'Only thinking, no answer',
      state: 'done',
      providerMetadata: { anthropic: { signature: 'sig' } },
    }]),
  ]
}

describe('chat model context through the real sanitizer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.streamTextOptions.length = 0
    mocks.toUIMessageStreamOptions.length = 0
    mocks.convertedMessages.length = 0

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

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
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-5-mini',
        tools: [],
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
  })

  it('sends only alternating, metadata-free text turns to the provider '
    + 'and keeps placeholders out of originalMessages', async () => {
    const handler = await getHandler()
    const { db } = createDb(createMixedProviderHistory())

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createNewUserMessage('Fourth question')],
      },
    } as any)

    await response.ready

    const convertedMessages = mocks.convertedMessages[0] as Array<any>
    const convertedParts = convertedMessages.flatMap(message => message.parts)
    const originalMessages = mocks.toUIMessageStreamOptions[0]
      ?.originalMessages as Array<any>

    expect(convertedParts.every(part => part.type === 'text')).toBe(true)
    expect(convertedParts.some(part => 'providerMetadata' in part)).toBe(false)
    expect(convertedMessages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(convertedMessages[5]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: '(no reply)' }],
    })
    expect(convertedMessages.map(message => message.parts[0].text)).toEqual([
      'First question',
      'Anthropic answer',
      'Second question',
      'OpenAI answer',
      'Third question',
      '(no reply)',
      'Fourth question',
    ])

    const streamedRoles = (mocks.streamTextOptions[0]?.messages as Array<any>)
      .map(message => message.role)

    expect(streamedRoles).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(JSON.stringify(originalMessages)).not.toContain('(no reply)')
  })
})
