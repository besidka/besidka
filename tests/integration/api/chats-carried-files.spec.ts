import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  convertFilesForAI: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  previousMessages: [] as Array<Record<string, unknown>>,
}))

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start', messageId })
      controller.enqueue({ type: 'finish' })
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
      options.onEnd?.({
        usage: mocks.usage,
        providerMetadata: undefined,
        steps: [],
      })

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
        usage: Promise.resolve(mocks.usage),
        steps: Promise.resolve([]),
        finalStep: Promise.resolve({}),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      options.messageMetadata?.({
        part: { type: 'finish', totalUsage: mocks.usage },
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
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: vi.fn(),
}))

vi.mock('~~/server/utils/files/assistant-files', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/assistant-files')
  >()

  return {
    ...actual,
    getGeneratedImageFileIds: vi.fn(() => []),
    normalizeAssistantMessagePartsForPersistence: vi.fn(
      async (input: { parts: unknown }) => input.parts,
    ),
  }
})

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/file-governance')
  >()

  return {
    ...actual,
    validateMessageFilePolicy: vi.fn(async () => undefined),
    getOwnedFilesByStorageKeys: mocks.getOwnedFilesByStorageKeys,
  }
})

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

const carriedStorageKey = 'carried-image.png'
const carriedFileSize = 1024

function createChatsFindFirst() {
  return vi.fn(async () => ({
    id: 'chat-1',
    projectId: null,
    project: null,
    messages: mocks.previousMessages,
  }))
}

function createDb() {
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const insertValues = vi.fn(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({
      returning: () => ({ get: insertGet }),
    }),
  }))
  const updateWhere = vi.fn(async () => undefined)

  return {
    query: {
      chats: { findFirst: createChatsFindFirst() },
      keys: {
        findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
      },
      messages: { findFirst: vi.fn(async () => undefined) },
    },
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
  }
}

function createEarlierUserMessageRow() {
  return {
    id: 1,
    publicId: 'user-public-0',
    role: 'user',
    parts: [
      { type: 'text', text: 'Look at this picture' },
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'picture.png',
        url: `/files/${carriedStorageKey}`,
      },
    ],
    tools: [],
    reasoning: 'off',
    createdAt: new Date(),
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-5-mini',
    tools: [],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'And now?' }],
    }],
    ...overrides,
  }
}

function stubDirectProvider(inputModalities: string[]) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'openai' },
    model: {
      id: 'gpt-5-mini',
      name: 'GPT-5 mini',
      tools: [],
      modalities: { input: inputModalities, output: ['text'] },
    },
  })))
  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: {},
    imageModel: {},
    imageModelId: 'gpt-image-2',
    tools: {},
    providerOptions: {},
  })))
  vi.stubGlobal('useGateway', vi.fn(() => {
    throw new Error('useGateway must not run for a direct-provider send')
  }))
}

async function runHandler(body: Record<string, unknown>) {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  vi.stubGlobal('useDb', () => createDb())

  const result = await (module.default as any)({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body,
  })

  await result.ready
}

function getEarlierUserParts() {
  const [messages] = mocks.convertFilesForAI.mock.calls[0] ?? []
  const earlierUserMessage = (messages as Array<Record<string, any>>)
    .find(message => message.id === 'user-public-0')

  return earlierUserMessage?.parts as Array<Record<string, unknown>>
}

describe('carried files in the chat route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.previousMessages = [createEarlierUserMessageRow()]
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
      carriedStorageKey,
      { id: 'file-1', storageKey: carriedStorageKey, size: carriedFileSize },
    ]]))
    mocks.convertFilesForAI.mockImplementation(async (messages: unknown) => ({
      messages,
      missingFiles: [],
    }))

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
      vi.fn().mockResolvedValue({ user: { id: '7' } }),
    )
    vi.stubGlobal('convertFilesForAI', mocks.convertFilesForAI)
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
    vi.stubGlobal('keyProviderIdForGateway', vi.fn((gatewayId: string) => {
      return gatewayId === 'openrouter' ? 'openrouter' : `${gatewayId}-gateway`
    }))
    vi.stubGlobal('readOpenRouterCost', vi.fn(() => undefined))
    vi.stubGlobal('readVercelGatewayCost', vi.fn(() => undefined))
    vi.stubGlobal('readVercelGenerationId', vi.fn(() => undefined))
  })

  it('sends an earlier image to a direct vision model', async () => {
    stubDirectProvider(['text', 'image'])

    await runHandler(createBody())

    expect(getEarlierUserParts()).toContainEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'picture.png',
      url: `/files/${carriedStorageKey}`,
    })
  })

  it('omits an earlier image after switching to a text-only model', async () => {
    stubDirectProvider(['text'])

    await runHandler(createBody())

    expect(getEarlierUserParts()).toEqual([
      { type: 'text', text: 'Look at this picture' },
      {
        type: 'text',
        text: 'Previously attached file omitted from model context: picture.png.',
      },
    ])
  })

  it('never carries earlier files on a gateway send', async () => {
    vi.stubGlobal('useGateway', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
      generateChatTitle: vi.fn(),
      toolCall: true,
    })))
    vi.stubGlobal('useChatProvider', vi.fn(() => {
      throw new Error('useChatProvider must not run on the gateway path')
    }))

    await runHandler(createBody({
      model: 'openai/gpt-5',
      gateway: 'openrouter',
    }))

    expect(getEarlierUserParts()).toContainEqual({
      type: 'text',
      text: 'Previously attached file omitted from model context: picture.png.',
    })
  })
})
