import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

/**
 * Drives the real send route for a chat that holds Google data
 * (`chats.google_data_at` set) and for an ordinary chat, to prove each
 * enforcement point of the data guard: the recipient check before any
 * content leaves, the gateway safeguards, and the skipped web search and
 * TypeSafe AI roles, with tool approvals on and off.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  flags: new Set<string>(),
  resolveJevRoleModel: vi.fn(),
  resolveJevRoleApiKey: vi.fn(),
}))

vi.mock('~~/server/utils/jev/roles', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/jev/roles')
  >()

  return {
    ...actual,
    resolveJevRoleModel: mocks.resolveJevRoleModel,
    resolveJevRoleApiKey: mocks.resolveJevRoleApiKey,
  }
})

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: async () => ({
    isFeatureActive: (flag: string) => mocks.flags.has(flag),
  }),
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
    return Object.assign(new Error(input.message || 'Error'), input)
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

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const GOOGLE_DATA_AT = new Date(1_700_000_000_000)

interface DirectModel {
  providerId: string
  modelId: string
}

const OPENAI_MODEL: DirectModel = { providerId: 'openai', modelId: 'gpt-5-mini' }

function createUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  }
}

function createTextModel() {
  const doStream = vi.fn(async () => {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Done.' },
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

function createDb(input: {
  googleDataAt: Date | null
  paidTierConfirmedAt?: Date | null
}) {
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const insertValues = vi.fn(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({ returning: () => ({ get: insertGet }) }),
  }))
  const updateWhere = vi.fn(async () => undefined)
  const keysFindFirst = vi.fn(async () => ({
    apiKey: 'encrypted-key',
    paidTierConfirmedAt: input.paidTierConfirmedAt ?? null,
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
          })),
        },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            branchedFromShareSlug: null,
            googleDataAt: input.googleDataAt,
            messages: [],
          })),
        },
        keys: { findFirst: keysFindFirst },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    },
    insertValues,
    keysFindFirst,
  }
}

function stubSendGlobals(directModel: DirectModel) {
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
  vi.stubGlobal('useKV', () => ({
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }))
  vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: directModel.providerId },
    model: {
      id: directModel.modelId,
      name: directModel.modelId,
      tools: ['web_search'],
      toolCall: true,
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
  vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
  vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
  vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
  vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
  vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
  vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
  vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
  vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
}

function stubProviderBuilders(model: MockLanguageModelV4) {
  const builder = vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  }))

  for (const name of ['useOpenAI', 'useGoogle', 'useAnthropic']) {
    vi.stubGlobal(name, builder)
  }

  return builder
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

async function runSend(input: {
  googleDataAt: Date | null
  directModel?: DirectModel
  gateway?: { id: string, modelId: string }
  paidTierConfirmedAt?: Date | null
  tools?: string[]
  webSearchMode?: 'auto' | 'always'
}) {
  const directModel = input.directModel ?? OPENAI_MODEL
  const { model, doStream } = createTextModel()

  stubSendGlobals(directModel)
  stubProviderBuilders(model)

  const useGatewayMock = vi.fn(async () => ({
    instance: model,
    generateChatTitle: vi.fn(),
    tools: {},
    providerOptions: {},
    toolCall: true,
  }))

  vi.stubGlobal('useGateway', useGatewayMock)

  const created = createDb({
    googleDataAt: input.googleDataAt,
    paidTierConfirmedAt: input.paidTierConfirmedAt,
  })

  vi.stubGlobal('useDb', () => created.db)

  const handler = await getHandler()
  let error: unknown = null

  try {
    const result = await handler({
      params: { slug: CHAT_SLUG },
      body: {
        model: input.gateway?.modelId ?? directModel.modelId,
        ...(input.gateway ? { gateway: input.gateway.id } : {}),
        tools: input.tools ?? [],
        reasoning: 'off',
        ...(input.webSearchMode ? { webSearchMode: input.webSearchMode } : {}),
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Summarize the plan.' }],
        }],
      },
    } as any)

    await result.ready
  } catch (exception) {
    error = exception
  }

  const streamCalls = doStream.mock.calls as unknown as Array<[{
    tools?: Array<{ name: string }>
  }]>
  const firstCallOptions = streamCalls[0]?.[0]

  return {
    error,
    doStream,
    useGatewayMock,
    keysFindFirst: created.keysFindFirst,
    insertValues: created.insertValues,
    offeredToolNames: (firstCallOptions?.tools ?? []).map((tool) => {
      return tool.name
    }),
  }
}

function keyLookupsFor(
  keysFindFirst: ReturnType<typeof vi.fn>,
  provider: string,
) {
  return keysFindFirst.mock.calls.filter(([query]) => {
    return (query as { where?: { provider?: string } })?.where?.provider
      === provider
  })
}

describe('chat send data guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.mergedStreams = []
    mocks.flags = new Set()
    mocks.resolveJevRoleModel.mockResolvedValue(null)
    mocks.resolveJevRoleApiKey.mockResolvedValue(null)
  })

  describe('recipient check', () => {
    it('stops a refused provider before any content leaves', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      })

      expect(result.error).toMatchObject({
        status: 403,
        why: 'This provider may train on your Google data.',
      })
      expect(result.doStream).not.toHaveBeenCalled()
      expect(result.insertValues).not.toHaveBeenCalled()
    })

    it('sends to the same provider in a chat without Google data',
      async () => {
        const result = await runSend({
          googleDataAt: null,
          directModel: { providerId: 'openai', modelId: 'gpt-5-mini' },
        })

        expect(result.error).toBeNull()
        expect(result.doStream).toHaveBeenCalled()
        expect(keyLookupsFor(result.keysFindFirst, 'google')).toHaveLength(0)
      })

    it('sends to an allowed provider in a flagged chat', async () => {
      const result = await runSend({ googleDataAt: GOOGLE_DATA_AT })

      expect(result.error).toBeNull()
      expect(result.doStream).toHaveBeenCalled()
    })

    it('stops Gemini until the paid tier is confirmed', async () => {
      const gemini = { providerId: 'google', modelId: 'gemini-3-pro' }
      const unconfirmed = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        directModel: gemini,
      })

      expect(unconfirmed.error).toMatchObject({
        status: 403,
        fix: expect.stringContaining('Confirm the paid tier'),
      })
      expect(unconfirmed.doStream).not.toHaveBeenCalled()

      const confirmed = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        directModel: gemini,
        paidTierConfirmedAt: new Date(1_000),
      })

      expect(confirmed.error).toBeNull()
      expect(confirmed.doStream).toHaveBeenCalled()
    })

    it('sends a gateway route with its safeguard in a flagged chat',
      async () => {
        const result = await runSend({
          googleDataAt: GOOGLE_DATA_AT,
          gateway: { id: 'openrouter', modelId: 'anthropic/claude-opus-5' },
        })

        expect(result.doStream).toHaveBeenCalled()
        expect(result.useGatewayMock).toHaveBeenCalledWith(
          'openrouter',
          '1',
          'anthropic/claude-opus-5',
          [],
          'off',
          expect.anything(),
          { googleDataSafeguards: true },
        )
      })

    it('stops a refused upstream behind a gateway', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        gateway: { id: 'openrouter', modelId: 'deepseek/deepseek-chat' },
      })

      expect(result.error).toMatchObject({ status: 403 })
      expect(result.useGatewayMock).not.toHaveBeenCalled()
    })
  })

  describe.each([
    ['on', true],
    ['off', false],
  ])('search and TypeSafe AI with tool approvals %s', (_label, approvals) => {
    beforeEach(() => {
      if (approvals) {
        mocks.flags.add('tool-approvals')
      }
    })

    it('skips Brave in a flagged chat and never reads its key', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        tools: ['web_search_brave'],
      })

      expect(result.error).toBeNull()
      expect(keyLookupsFor(result.keysFindFirst, 'brave')).toHaveLength(0)
      expect(result.offeredToolNames).not.toContain('web_search_brave')
    })

    it('skips Exa in a flagged chat and never reads its key', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        tools: ['web_search_exa'],
      })

      expect(result.error).toBeNull()
      expect(keyLookupsFor(result.keysFindFirst, 'exa')).toHaveLength(0)
      expect(result.offeredToolNames).not.toContain('web_search_exa')
    })

    it('reads the Brave key in a chat without Google data', async () => {
      const result = await runSend({
        googleDataAt: null,
        tools: ['web_search_brave'],
      })

      expect(keyLookupsFor(result.keysFindFirst, 'brave')).toHaveLength(1)
    })

    it('asks no TypeSafe AI role in a flagged chat', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        tools: ['web_search'],
        webSearchMode: 'auto',
      })

      expect(result.error).toBeNull()
      expect(mocks.resolveJevRoleApiKey).not.toHaveBeenCalled()
      expect(mocks.resolveJevRoleModel).not.toHaveBeenCalled()
    })

    it('asks the auto web search role in a chat without Google data',
      async () => {
        await runSend({
          googleDataAt: null,
          tools: ['web_search'],
          webSearchMode: 'auto',
        })

        expect(mocks.resolveJevRoleApiKey).toHaveBeenCalledWith(
          expect.objectContaining({ role: 'autoWebSearch' }),
        )
      })
  })
})
