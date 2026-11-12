import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { OFFICE_MEDIA_TYPES } from '#shared/utils/office-files'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  getOwnedFilesByStorageKeys: vi.fn(),
  extractOfficeText: vi.fn(),
  previousMessages: [] as Array<Record<string, unknown>>,
  insert: vi.fn(),
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
      const writer = { write: vi.fn(), merge: vi.fn() }
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

vi.mock('~~/server/utils/documents/renderer', () => ({
  extractOfficeText: mocks.extractOfficeText,
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

const DOCX_KEY = 'plan.docx'
const EARLIER_DOCX_KEY = 'earlier.docx'

function docxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-docx',
    storageKey: DOCX_KEY,
    size: 4000,
    name: 'plan.docx',
    type: OFFICE_MEDIA_TYPES.docx,
    textStatus: 'ready',
    textBytes: 20,
    textVersion: 1,
    ...overrides,
  }
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

  mocks.insert.mockImplementation(() => ({ values: insertValues }))

  return {
    query: {
      userSettings: {
        findFirst: vi.fn(async () => ({
          memoryEnabled: false,
          chatSearchEnabled: true,
          memoryIncludeSensitive: false,
          aboutMe: null,
        })),
      },
      chats: {
        findFirst: vi.fn(async () => ({
          id: 'chat-1',
          projectId: null,
          project: null,
          messages: mocks.previousMessages,
        })),
      },
      keys: { findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })) },
      messages: { findFirst: vi.fn(async () => undefined) },
    },
    insert: mocks.insert,
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  }
}

function createBody(
  fileParts: Array<{ url: string, mediaType: string, filename?: string }>,
  overrides: Record<string, unknown> = {},
) {
  return {
    model: 'claude-sonnet-4-5',
    tools: [],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Summarise the attachment' },
        ...fileParts.map((part) => {
          return { type: 'file', ...part }
        }),
      ],
    }],
    ...overrides,
  }
}

function stubAnthropicProvider(modalities = ['text', 'image', 'pdf']) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'anthropic' },
    model: {
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet',
      tools: [],
      modalities: { input: modalities, output: ['text'] },
    },
  })))
  vi.stubGlobal('useAnthropic', vi.fn(async () => ({
    instance: {},
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
    context: {},
  })

  await result.ready
}

function getModelMessageParts(): Array<Record<string, any>> {
  const [options] = vi.mocked(streamText).mock.calls[0] ?? []
  const messages = (options as { messages: Array<{ parts: unknown[] }> })
    .messages

  return messages.flatMap((message) => {
    return message.parts as Array<Record<string, any>>
  })
}

describe('Office attachments in the chat route', () => {
  let storedObjects: Map<string, string | Uint8Array>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    storedObjects = new Map([
      [`${DOCX_KEY}.text.md`, '# Plan\n\nLaunch in March.'],
      [`${EARLIER_DOCX_KEY}.text.md`, 'Earlier notes.'],
    ])
    mocks.previousMessages = []
    mocks.getOwnedFilesByStorageKeys.mockImplementation(
      async (_userId: number, keys: string[]) => {
        const rows = [
          docxRow(),
          docxRow({
            id: 'file-earlier',
            storageKey: EARLIER_DOCX_KEY,
            name: 'earlier.docx',
            textBytes: 14,
          }),
        ]

        return new Map(rows
          .filter(row => keys.includes(row.storageKey))
          .map(row => [row.storageKey, row]))
      },
    )

    const { convertFilesForAI } = await import(
      '~~/server/utils/files/convert-files-for-ai'
    )

    vi.stubGlobal('convertFilesForAI', convertFilesForAI)
    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
    vi.stubGlobal('createError', (input: Record<string, any>) => {
      const exception = new Error(
        input.statusMessage || input.message || 'Error',
      )

      Object.assign(exception, {
        statusCode: input.statusCode ?? input.status,
        ...input,
      })

      return exception
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('getDecodedRouterParams', (event: { params: unknown }) => {
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
      vi.fn().mockResolvedValue({ user: { id: '7' } }),
    )
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useFileStorage', () => ({
      put: vi.fn(async (key: string, value: Uint8Array) => {
        storedObjects.set(key, value)

        return { key }
      }),
      get: vi.fn(async (key: string) => {
        const content = storedObjects.get(key)

        if (content === undefined) {
          return null
        }

        const bytes = typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content

        return {
          arrayBuffer: async () => bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          text: async () => new TextDecoder().decode(bytes),
        }
      }),
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

  it('sends a ready DOCX to Anthropic as text and no raw file part', async () => {
    stubAnthropicProvider()

    await runHandler(createBody([{
      url: `/files/${DOCX_KEY}`,
      mediaType: OFFICE_MEDIA_TYPES.docx,
      filename: 'plan.docx',
    }]))

    const parts = getModelMessageParts()
    const texts = parts
      .filter(part => part.type === 'text')
      .map(part => part.text as string)

    expect(parts.filter(part => part.type === 'file')).toEqual([])
    expect(texts.join('\n')).toContain('**plan.docx** (Word document)')
    expect(texts.join('\n')).toContain(
      'Extracted text. Images, charts and formatting are not included.',
    )
    expect(texts.join('\n')).toContain('Launch in March.')
  })

  it('rejects a DOCX without readable text with a 400 before persisting', async () => {
    stubAnthropicProvider()
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
      DOCX_KEY,
      docxRow({ textStatus: 'failed', textBytes: null }),
    ]]))

    await expect(runHandler(createBody([{
      url: `/files/${DOCX_KEY}`,
      mediaType: OFFICE_MEDIA_TYPES.docx,
      filename: 'plan.docx',
    }]))).rejects.toMatchObject({
      status: 400,
      message: 'plan.docx cannot be sent to Claude Sonnet.',
      why: expect.stringMatching(/No text could be read/),
      fix: expect.stringMatching(/\.docx, \.xlsx or \.pptx/),
    })

    expect(mocks.insert).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
  })

  it('rejects a legacy Office file with the save-as reason', async () => {
    stubAnthropicProvider()
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
      'old.doc',
      docxRow({
        storageKey: 'old.doc',
        type: 'application/msword',
        textStatus: null,
      }),
    ]]))

    await expect(runHandler(createBody([{
      url: '/files/old.doc',
      mediaType: 'application/msword',
      filename: 'old.doc',
    }]))).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/Legacy/),
    })
  })

  it('reads a file stored before extraction existed, once, on the first send', async () => {
    stubAnthropicProvider()
    storedObjects.set(DOCX_KEY, new Uint8Array([0x50, 0x4b, 3, 4]))
    storedObjects.delete(`${DOCX_KEY}.text.md`)
    mocks.extractOfficeText.mockResolvedValue({
      status: 'ready',
      text: 'Backfilled text',
      truncated: false,
      stats: { inputBytes: 4, entries: 1, textBytes: 15, truncations: [] },
    })
    const staleRow = docxRow({
      textStatus: null,
      textBytes: null,
      textVersion: null,
    })
    const readyRow = docxRow({ textBytes: 15 })

    mocks.getOwnedFilesByStorageKeys
      .mockResolvedValueOnce(new Map([[DOCX_KEY, staleRow]]))
      .mockResolvedValue(new Map([[DOCX_KEY, readyRow]]))

    await runHandler(createBody([{
      url: `/files/${DOCX_KEY}`,
      mediaType: OFFICE_MEDIA_TYPES.docx,
      filename: 'plan.docx',
    }]))

    expect(mocks.extractOfficeText).toHaveBeenCalledTimes(1)
    expect(getModelMessageParts().filter((part) => {
      return part.type === 'file'
    })).toEqual([])
    expect(JSON.stringify(getModelMessageParts())).toContain('Backfilled text')
  })

  it('sends a ready DOCX through a gateway as text too', async () => {
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

    await runHandler(createBody([{
      url: `/files/${DOCX_KEY}`,
      mediaType: OFFICE_MEDIA_TYPES.docx,
      filename: 'plan.docx',
    }], { model: 'anthropic/claude-sonnet-4.5', gateway: 'openrouter' }))

    const parts = getModelMessageParts()

    expect(parts.filter(part => part.type === 'file')).toEqual([])
    expect(JSON.stringify(parts)).toContain('Launch in March.')
  })

  it('carries an earlier Office file as text, within the carry-over window', async () => {
    stubAnthropicProvider()
    mocks.previousMessages = [{
      id: 1,
      publicId: 'user-public-0',
      role: 'user',
      parts: [
        { type: 'text', text: 'Here are my notes' },
        {
          type: 'file',
          mediaType: OFFICE_MEDIA_TYPES.docx,
          filename: 'earlier.docx',
          url: `/files/${EARLIER_DOCX_KEY}`,
        },
      ],
      tools: [],
      reasoning: 'off',
      createdAt: new Date(),
    }]

    await runHandler(createBody([]))

    const parts = getModelMessageParts()

    expect(parts.filter(part => part.type === 'file')).toEqual([])
    expect(JSON.stringify(parts)).toContain('Earlier notes.')
  })

  it('omits an earlier Office file whose text is not ready instead of failing', async () => {
    stubAnthropicProvider()
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
      EARLIER_DOCX_KEY,
      docxRow({
        storageKey: EARLIER_DOCX_KEY,
        textStatus: 'failed',
        textBytes: null,
      }),
    ]]))
    mocks.previousMessages = [{
      id: 1,
      publicId: 'user-public-0',
      role: 'user',
      parts: [
        { type: 'text', text: 'Here are my notes' },
        {
          type: 'file',
          mediaType: OFFICE_MEDIA_TYPES.docx,
          filename: 'earlier.docx',
          url: `/files/${EARLIER_DOCX_KEY}`,
        },
      ],
      tools: [],
      reasoning: 'off',
      createdAt: new Date(),
    }]

    await runHandler(createBody([]))

    const parts = getModelMessageParts()

    expect(parts.filter(part => part.type === 'file')).toEqual([])
    expect(JSON.stringify(parts)).toContain(
      'Previously attached file omitted from model context: earlier.docx.',
    )
  })

  it('stops a raw Office file part before the provider call', async () => {
    stubAnthropicProvider()
    vi.stubGlobal('convertFilesForAI', vi.fn(async (messages: unknown) => ({
      messages: (messages as Array<Record<string, any>>).map((message) => {
        return {
          ...message,
          parts: [...message.parts, {
            type: 'file',
            mediaType: OFFICE_MEDIA_TYPES.docx,
            filename: 'leaked.docx',
            url: 'data:application/octet-stream;base64,AAAA',
          }],
        }
      }),
      missingFiles: [],
      unsupportedFiles: [],
    })))

    await expect(runHandler(createBody([]))).rejects.toMatchObject({
      status: 400,
      message: 'leaked.docx cannot be sent to the model.',
    })
    expect(streamText).not.toHaveBeenCalled()
  })
})
