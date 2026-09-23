import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End-to-end wiring for gateway-generated images, which
 * `chats-gateway.spec.ts` deliberately cannot cover: that suite stubs the
 * whole `assistant-files` module, so its `persistGatewayGeneratedImageParts`
 * is a pass-through that returns its input unchanged. Nothing there exercises
 * the merge in `persistAssistantMessageFromStream` — `gatewayImageResult`'s
 * rewritten `parts` becoming `partsAfterGatewayImages`, its `fileIds` folding
 * into `generatedFileIds`, and either of those flipping
 * `usedImageGeneration`.
 *
 * This file therefore keeps the REAL `persistGatewayGeneratedImageParts` (and
 * the real `validateGeneratedImage` it calls) and mocks only the storage
 * boundary, so a `data:image/...` URL genuinely has to be decoded, validated,
 * uploaded and rewritten before the assertions can pass. The function itself
 * is unit-covered in `tests/integration/server/assistant-files.spec.ts`; what
 * is pinned here is that the chat route actually reaches it and uses what it
 * returns.
 */
const mocks = vi.hoisted(() => ({
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  } as Record<string, unknown>,
  uiChunks: [] as Array<Record<string, unknown>>,
  persistFile: vi.fn(),
  getGeneratedImageFileIds: vi.fn(() => [] as string[]),
}))

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start', messageId })

      for (const chunk of mocks.uiChunks) {
        controller.enqueue(chunk)
      }

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

// The real persist-file.ts transitively imports a Nitro route file whose
// module body calls defineEventHandler() at the top level, so it has to be
// mocked before assistant-files.ts is imported for real — the same reason
// tests/integration/server/assistant-files.spec.ts mocks it.
vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

vi.mock('~~/server/utils/files/assistant-files', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/assistant-files')
  >()

  return {
    ...actual,
    getGeneratedImageFileIds: mocks.getGeneratedImageFileIds,
    sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
    normalizeAssistantMessagePartsForPersistence: vi.fn(
      async (input: { parts: unknown }) => input.parts,
    ),
  }
})

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

function createWebPBytes(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x12, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c,
    0x06, 0x00, 0x00, 0x00,
    0x2f, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ])
}

function buildImageDataUrl(bytes: Uint8Array, mediaType: string): string {
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')

  return `data:${mediaType};base64,${btoa(binary)}`
}

function generatedImageChunks() {
  return [
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'Here is your image.' },
    { type: 'text-end', id: 'text-1' },
    {
      type: 'file',
      mediaType: 'image/webp',
      url: buildImageDataUrl(createWebPBytes(), 'image/webp'),
    },
  ]
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
    updateSet,
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
      parts: [{ type: 'text', text: 'Draw a quiet forest' }],
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

function getFileParts(parts: Array<Record<string, any>> | undefined) {
  return (parts ?? []).filter(part => part.type === 'file')
}

/**
 * `db.update()` also backs the chat `activityAt` touch, so the file-linking
 * write has to be identified by the column it sets rather than by the update
 * having happened at all.
 */
function getOriginLinkUpdates(updateSet: ReturnType<typeof vi.fn>) {
  return updateSet.mock.calls.filter(([values]) => {
    return values && 'originMessageId' in values
  })
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

describe('gateway-generated image persistence, end to end', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    mocks.uiChunks = generatedImageChunks()
    mocks.getGeneratedImageFileIds.mockReturnValue([])
    mocks.persistFile.mockResolvedValue({
      id: 'file-42',
      storageKey: 'generated-42.webp',
      name: 'generated-image-1.webp',
      size: 26,
      type: 'image/webp',
      source: 'assistant',
      expiresAt: null,
    })

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
    vi.stubGlobal('keyProviderIdForGateway', vi.fn((gatewayId: string) => {
      return gatewayId === 'openrouter' ? 'openrouter' : `${gatewayId}-gateway`
    }))
    vi.stubGlobal('readOpenRouterCost', vi.fn(() => undefined))
    vi.stubGlobal('readVercelGatewayCost', vi.fn(() => undefined))
    vi.stubGlobal('readVercelGenerationId', vi.fn(() => undefined))
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
  })

  it('uploads an inline data: image returned by a gateway and persists the '
    + '/files/ URL, never the base64 blob', async () => {
    const { insertValues } = await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))
    const assistantInsert = getAssistantInsert(insertValues)
    const fileParts = getFileParts(assistantInsert?.parts)

    expect(mocks.persistFile).toHaveBeenCalledTimes(1)
    expect(fileParts).toEqual([{
      type: 'file',
      mediaType: 'image/webp',
      filename: 'generated-image-1.webp',
      url: '/files/generated-42.webp?generated=1',
    }])
    expect(JSON.stringify(assistantInsert?.parts)).not.toContain('data:image')
  })

  it('marks the turn as image generation from the persisted file ids, even '
    + 'though no generate_image tool part exists on a gateway send',
  async () => {
    const { insertValues } = await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))
    const assistantInsert = getAssistantInsert(insertValues)

    expect(assistantInsert?.parts).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ type: 'tool-generate_image' }),
    ]))
    expect(assistantInsert?.tools).toEqual(['image_generation'])
  })

  it('links the persisted file to the assistant message, folding the '
    + 'gateway file ids into generatedFileIds', async () => {
    const { updateSet } = await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))

    expect(getOriginLinkUpdates(updateSet)).toHaveLength(1)
  })

  it('threads the rewritten parts, not the original data: ones, into the '
    + 'rest of the persistence path', async () => {
    await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))

    const [partsArgument] = mocks.getGeneratedImageFileIds.mock.calls[0] ?? []
    const fileParts = getFileParts(partsArgument as any)

    expect(fileParts).toHaveLength(1)
    expect(fileParts[0]?.url).toBe('/files/generated-42.webp?generated=1')
  })

  it('passes the gateway and model through as the file origin, so a '
    + 'gateway-generated file is attributable', async () => {
    await runHandler(baseBody({
      model: 'openai/gpt-5-image',
      gateway: 'openrouter',
      tools: ['image_generation'],
    }))

    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      mediaType: 'image/webp',
      source: 'assistant',
      originProvider: 'openrouter',
      originModel: 'openai/gpt-5-image',
    }))
  })

  it('leaves a gateway send with no inline image untouched and never '
    + 'uploads anything', async () => {
    mocks.uiChunks = [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Just text.' },
      { type: 'text-end', id: 'text-1' },
    ]

    const { insertValues, updateSet } = await runHandler(baseBody({
      model: 'anthropic/claude-opus-5',
      gateway: 'openrouter',
    }))
    const assistantInsert = getAssistantInsert(insertValues)

    expect(mocks.persistFile).not.toHaveBeenCalled()
    expect(getFileParts(assistantInsert?.parts)).toEqual([])
    expect(assistantInsert?.tools).toEqual([])
    expect(getOriginLinkUpdates(updateSet)).toHaveLength(0)
  })

  it('never runs gateway image persistence on a direct-provider send, whose '
    + 'images already arrive as persisted file parts', async () => {
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
    vi.stubGlobal('useGateway', vi.fn(() => {
      throw new Error('useGateway must not run for a direct-provider send')
    }))

    const { insertValues } = await runHandler(baseBody({
      model: 'gpt-5-mini',
      tools: ['image_generation'],
    }))
    const assistantInsert = getAssistantInsert(insertValues)

    expect(mocks.persistFile).not.toHaveBeenCalled()
    expect(getFileParts(assistantInsert?.parts)[0]?.url)
      .toMatch(/^data:image\/webp/)
  })
})
