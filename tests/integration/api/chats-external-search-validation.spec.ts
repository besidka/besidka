import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toUIMessageStreamOptions: [] as Array<Record<string, any>>,
  generatedMessageIds: [] as string[],
  uiMessageStreamChunks: null as Array<Record<string, any>> | null,
  streamTextOptions: [] as Array<Record<string, any>>,
  getActiveShareForChat: vi.fn(),
  syncChatShareFiles: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    readUIMessageStream: (options: Record<string, unknown>) => {
      return actual.readUIMessageStream(options as any)
    },
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
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
      }
    }),
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
    convertToModelMessages: vi.fn(async messages => messages),
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
  sanitizeMessagesForModelContext: vi.fn(messages => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(async (input) => {
    return input.parts
  }),
}))

vi.mock('~~/server/utils/chats/share', () => ({
  getActiveShareForChat: mocks.getActiveShareForChat,
  syncChatShareFiles: mocks.syncChatShareFiles,
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

function createDb(keysFindFirst = vi.fn(async () => null)) {
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
        keys: {
          findFirst: keysFindFirst,
        },
      },
      insert: insertCall,
      transaction,
      update: vi.fn(() => ({
        set: updateSet,
      })),
    },
    insertValues,
  }
}

function createKv() {
  return {
    kv: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  }
}

describe('chats external search validation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.toUIMessageStreamOptions.length = 0
    mocks.generatedMessageIds.length = 0
    mocks.uiMessageStreamChunks = null
    mocks.streamTextOptions.length = 0
    mocks.getActiveShareForChat.mockResolvedValue(null)
    mocks.syncChatShareFiles.mockResolvedValue(undefined)

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
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => createKv().kv)
    vi.stubGlobal('buildVapidSubject', vi.fn((subject: string) => {
      return subject ? `mailto:${subject}` : undefined
    }))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
  })

  function stubToolCallingModel(overrides: Record<string, unknown> = {}) {
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
        tools: ['web_search', 'image_generation'],
        toolCall: true,
        modalities: { input: ['text'], output: ['text'] },
        ...overrides,
      },
      modelName: 'GPT-5 mini',
    })))
  }

  it('rejects web_search_brave when the model does not support tool calling', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel({ toolCall: false })

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_brave'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      why: 'GPT-5 mini does not support tool calling.',
      fix: 'Choose a tool-calling model, or use the model\'s built-in web search.',
    }))

    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects web_search_exa when the model does not support tool calling', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel({ toolCall: false })

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_exa'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      why: 'GPT-5 mini does not support tool calling.',
      fix: 'Choose a tool-calling model, or use the model\'s built-in web search.',
    }))

    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects web_search_brave when no Brave key is saved', async () => {
    const handler = await getHandler()
    const keysFindFirst = vi.fn(async () => null)
    const { db, insertValues } = createDb(keysFindFirst)

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel()

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_brave'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      why: 'No Brave Search API key is saved for this account.',
      fix: 'Add one at /profile/keys → Search providers.',
    }))

    expect(keysFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1, provider: 'brave' },
    }))
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects web_search_exa when no Exa key is saved', async () => {
    const handler = await getHandler()
    const keysFindFirst = vi.fn(async () => null)
    const { db, insertValues } = createDb(keysFindFirst)

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel()

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_exa'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      why: 'No Exa API key is saved for this account.',
      fix: 'Add one at /profile/keys → Search providers.',
    }))

    expect(keysFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1, provider: 'exa' },
    }))
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('allows web_search_brave when the model supports tool calling and a key is saved', async () => {
    const handler = await getHandler()
    const keysFindFirst = vi.fn(async () => ({ apiKey: 'encrypted-brave-key' }))
    const { db } = createDb(keysFindFirst)

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel()

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_brave'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)

    await response.ready
    expect(keysFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1, provider: 'brave' },
    }))
  })

  it('allows web_search_exa when the model supports tool calling and a key is saved', async () => {
    const handler = await getHandler()
    const keysFindFirst = vi.fn(async () => ({ apiKey: 'encrypted-exa-key' }))
    const { db } = createDb(keysFindFirst)

    vi.stubGlobal('useDb', () => db)
    stubToolCallingModel()

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: ['web_search_exa'],
        reasoning: 'off',
        messages: [createMessage('Search the web')],
      },
    } as any)

    await response.ready
    expect(keysFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1, provider: 'exa' },
    }))
  })

  it('rejects a web search tool for a model that always generates images', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        tools: [],
        toolCall: false,
        modalities: { input: ['text'], output: ['image'] },
        imageGeneration: {
          controllerModel: 'gpt-5-nano',
        },
      },
      modelName: 'GPT Image 2',
    })))

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-image-2',
        tools: ['web_search_brave'],
        reasoning: 'off',
        messages: [createMessage('Draw a forest')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      message: 'The selected model does not support the requested tool.',
      why: 'GPT Image 2 always generates images and cannot also perform a web search.',
      fix: 'Choose a different model to enable web search.',
    }))

    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a web search tool for a tool-calling model that always generates images', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        tools: ['web_search'],
        toolCall: true,
        modalities: { input: ['text'], output: ['image'] },
        imageGeneration: {
          controllerModel: 'gpt-5-nano',
        },
      },
      modelName: 'GPT Image 2',
    })))

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-image-2',
        tools: ['web_search_brave'],
        reasoning: 'off',
        messages: [createMessage('Draw a forest')],
      },
    } as any)).rejects.toEqual(expect.objectContaining({
      message: 'The selected model does not support the requested tool.',
      why: 'GPT Image 2 always generates images and cannot also perform a web search.',
      fix: 'Choose a different model to enable web search.',
    }))

    expect(insertValues).not.toHaveBeenCalled()
  })
})
