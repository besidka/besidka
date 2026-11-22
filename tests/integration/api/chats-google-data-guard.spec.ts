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
  listChatConnectorStates: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  googleCandidates: null as null | {
    tools: Record<string, unknown>
    entries: Map<string, unknown>
  },
}))

vi.mock('~~/server/utils/tool-approval/google-send-candidates', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/google-send-candidates')
  >()

  return {
    ...actual,
    buildGoogleSendToolCandidates: async () => {
      return mocks.googleCandidates ?? actual.noGoogleSendTools()
    },
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

vi.mock('~~/server/utils/connectors/chat-selection', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/connectors/chat-selection')
  >()

  return {
    ...actual,
    listChatConnectorStates: mocks.listChatConnectorStates,
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

function createTextModel(streamError?: unknown) {
  const doStream = vi.fn(async () => {
    if (streamError) {
      throw streamError
    }

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
  storedMessages?: unknown[]
  markedArtifactIds?: number[]
  holdsMarkedOrigin?: boolean
}) {
  const updateSets: unknown[] = []
  const batch = createBatch()
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
  const chatsFindFirst = vi.fn(async () => ({
    id: 'chat-1',
    projectId: null,
    project: null,
    branchedFromShareSlug: null,
    googleDataAt: input.googleDataAt,
    holdsMarkedOrigin: input.holdsMarkedOrigin ? 1 : 0,
    messages: input.storedMessages ?? [],
  }))
  const select = vi.fn(() => ({
    from: () => ({
      where: async () => {
        return (input.markedArtifactIds ?? []).map((id) => {
          return { id }
        })
      },
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
          })),
        },
        chats: { findFirst: chatsFindFirst },
        keys: { findFirst: keysFindFirst },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn((values: unknown) => {
          updateSets.push(values)

          return { where: updateWhere }
        }),
      })),
      batch: batch.run,
      select,
    },
    insertValues,
    keysFindFirst,
    chatsFindFirst,
    updateSets,
    batches: batch.calls,
  }
}

function createBatch() {
  const calls: unknown[][] = []

  return {
    calls,
    run: vi.fn(async (statements: unknown[]) => {
      calls.push(statements)

      return await Promise.all(statements)
    }),
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
  gatewayProviderOptions?: Record<string, unknown>
  storedMessages?: unknown[]
  newMessageParts?: unknown[]
  markedArtifactIds?: number[]
  holdsMarkedOrigin?: boolean
  streamError?: unknown
  inlinesTextFiles?: boolean
}) {
  const directModel = input.directModel ?? OPENAI_MODEL
  const { model, doStream } = createTextModel(input.streamError)

  stubSendGlobals(directModel)
  stubProviderBuilders(model)

  if (input.inlinesTextFiles) {
    vi.stubGlobal('convertFilesForAI', vi.fn(async (
      messages: Array<{ parts: Array<{ type: string }> }>,
    ) => ({
      messages: messages.map((message) => {
        return {
          ...message,
          parts: message.parts.filter(part => part.type !== 'file'),
        }
      }),
      missingFiles: [],
    })))
  }

  const useGatewayMock = vi.fn(async () => ({
    instance: model,
    generateChatTitle: vi.fn(),
    tools: {},
    providerOptions: input.gatewayProviderOptions ?? {},
    toolCall: true,
  }))

  vi.stubGlobal('useGateway', useGatewayMock)

  const created = createDb({
    googleDataAt: input.googleDataAt,
    paidTierConfirmedAt: input.paidTierConfirmedAt,
    storedMessages: input.storedMessages,
    markedArtifactIds: input.markedArtifactIds,
    holdsMarkedOrigin: input.holdsMarkedOrigin,
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
          parts: input.newMessageParts
            ?? [{ type: 'text', text: 'Summarize the plan.' }],
        }],
      },
    } as any)

    await result.ready
  } catch (exception) {
    error = exception
  }

  const streamCalls = doStream.mock.calls as unknown as Array<[{
    tools?: Array<{ name: string }>
    providerOptions?: Record<string, unknown>
  }]>
  const firstCallOptions = streamCalls[0]?.[0]

  return {
    error,
    doStream,
    useGatewayMock,
    keysFindFirst: created.keysFindFirst,
    chatsFindFirst: created.chatsFindFirst,
    insertValues: created.insertValues,
    updateSets: created.updateSets,
    batches: created.batches,
    firstCallProviderOptions: firstCallOptions?.providerOptions,
    offeredToolNames: (firstCallOptions?.tools ?? []).map((tool) => {
      return tool.name
    }),
  }
}

function textFilePart(storageKey: string) {
  return {
    type: 'file',
    mediaType: 'text/plain',
    filename: storageKey,
    url: `/files/${storageKey}`,
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
    mocks.listChatConnectorStates.mockRejectedValue(
      new Error('stop after the connector gate'),
    )
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())
    mocks.googleCandidates = null
  })

  describe('connectors', () => {
    it('offers no connector in a flagged chat without tool approvals',
      async () => {
        mocks.flags.add('connectors')

        await runSend({ googleDataAt: GOOGLE_DATA_AT })

        expect(mocks.listChatConnectorStates).not.toHaveBeenCalled()
      })

    it('loads connectors in a flagged chat under tool approvals', async () => {
      mocks.flags.add('connectors')
      mocks.flags.add('tool-approvals')

      await runSend({ googleDataAt: GOOGLE_DATA_AT })

      expect(mocks.listChatConnectorStates).toHaveBeenCalled()
    })

    it('loads connectors in an ordinary chat without approvals', async () => {
      mocks.flags.add('connectors')

      await runSend({ googleDataAt: null })

      expect(mocks.listChatConnectorStates).toHaveBeenCalled()
    })
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

    it('passes the gateway zero-data-retention option to the model call',
      async () => {
        const result = await runSend({
          googleDataAt: GOOGLE_DATA_AT,
          gateway: { id: 'vercel', modelId: 'anthropic/claude-opus-5' },
          gatewayProviderOptions: {
            gateway: { caching: 'auto', zeroDataRetention: true },
          },
        })

        expect(result.firstCallProviderOptions).toMatchObject({
          gateway: { zeroDataRetention: true },
        })
      })

    it('stores the flag for a chat found only by its Google parts',
      async () => {
        const result = await runSend({
          googleDataAt: null,
          storedMessages: [{
            id: 'assistant-1',
            publicId: 'assistant-public-1',
            role: 'assistant',
            parts: [{
              type: 'tool-google__drive_read',
              toolCallId: 'call-1',
              state: 'output-available',
              input: {},
              output: { references: [], bodyRemoved: true, note: 'x' },
            }],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(1_000),
          }],
          directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        })

        expect(result.error).toMatchObject({ status: 403 })
        expect(result.updateSets).toContainEqual({
          googleDataAt: expect.anything(),
        })
        expect(result.batches).toHaveLength(1)
      })

    it('flags the chat before the guard for an attached Google copy',
      async () => {
        mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
          'drive-copy.txt',
          {
            id: 'file-1',
            storageKey: 'drive-copy.txt',
            size: 10,
            externalSource: 'google',
          },
        ]]))

        const result = await runSend({
          googleDataAt: null,
          directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          newMessageParts: [
            { type: 'text', text: 'Summarize this.' },
            textFilePart('drive-copy.txt'),
          ],
        })

        expect(result.error).toMatchObject({ status: 403 })
        expect(result.doStream).not.toHaveBeenCalled()
        expect(result.updateSets).toContainEqual({
          googleDataAt: expect.anything(),
        })
        expect(result.batches).toHaveLength(1)
        expect(result.batches[0]).toHaveLength(2)
      })

    describe('a Google Drive copy attached from the Picker', () => {
      const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
      const DRIVE_COPY = new Map([[
        'drive-copy.md',
        {
          id: 'file-9',
          storageKey: 'drive-copy.md',
          size: 10,
          name: 'Plan.md',
          type: 'text/markdown',
          externalSource: 'google',
          externalId: DRIVE_ID,
        },
      ]])
      const parts = [
        { type: 'text', text: 'Summarize this.' },
        {
          type: 'file',
          mediaType: 'text/markdown',
          filename: 'Plan.md',
          url: '/files/drive-copy.md',
        },
        {
          type: 'data-drive-file',
          data: {
            driveFileId: '1ForgedForgedForgedForged01',
            name: 'Forged',
            mimeType: 'x',
            link: 'https://evil.example/x',
          },
        },
      ]

      function persistedParts(
        insertValues: ReturnType<typeof vi.fn>,
      ): Array<{ type: string, data?: Record<string, string> }> {
        const [call] = insertValues.mock.calls.filter(([values]) => {
          return Array.isArray((values as { parts?: unknown })?.parts)
        }) as unknown as Array<[{ parts: Array<{ type: string }> }]>

        return (call?.[0].parts ?? []) as never
      }

      it('is refused on a model that may not see Google data before a '
        + 'byte of the file is read or sent', async () => {
        mocks.getOwnedFilesByStorageKeys.mockResolvedValue(DRIVE_COPY)

        const result = await runSend({
          googleDataAt: null,
          directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          newMessageParts: parts,
        })

        expect(result.error).toMatchObject({
          status: 403,
          why: 'This provider may train on your Google data.',
        })
        expect(result.doStream).not.toHaveBeenCalled()
        expect(result.insertValues).not.toHaveBeenCalled()
        expect((globalThis as any).convertFilesForAI).not.toHaveBeenCalled()
        expect(result.updateSets).toContainEqual({
          googleDataAt: expect.anything(),
        })
      })

      it('flags the chat on an allowed model and stores one canonical '
        + 'reference right after the file', async () => {
        mocks.getOwnedFilesByStorageKeys.mockResolvedValue(DRIVE_COPY)

        const result = await runSend({
          googleDataAt: null,
          newMessageParts: parts,
          inlinesTextFiles: true,
        })
        const stored = persistedParts(result.insertValues)
        const types = stored.map(part => part.type)

        expect(result.error).toBeNull()
        expect(result.updateSets).toContainEqual({
          googleDataAt: expect.anything(),
        })
        expect(types).toEqual(['text', 'file', 'data-drive-file'])
        expect(stored[2]!.data).toEqual({
          driveFileId: DRIVE_ID,
          name: 'Plan.md',
          mimeType: 'text/markdown',
          link: `https://drive.google.com/open?id=${DRIVE_ID}`,
        })
        expect(JSON.stringify(stored)).not.toContain('evil.example')
      })
    })

    it('flags the chat for a marked file, and not for an ordinary one',
      async () => {
        mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
          'plain.txt',
          { id: 'file-2', storageKey: 'plain.txt', size: 10 },
        ]]))

        const plain = await runSend({
          googleDataAt: null,
          directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          newMessageParts: [
            { type: 'text', text: 'Read it.' },
            textFilePart('plain.txt'),
          ],
        })

        expect(plain.updateSets).not.toContainEqual({
          googleDataAt: expect.anything(),
        })

        mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([[
          'plain.txt',
          {
            id: 'file-2',
            storageKey: 'plain.txt',
            size: 10,
            googleDerivedAt: new Date(1_000),
          },
        ]]))

        const marked = await runSend({
          googleDataAt: null,
          directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          newMessageParts: [
            { type: 'text', text: 'Read it.' },
            textFilePart('plain.txt'),
          ],
        })

        expect(marked.error).toMatchObject({ status: 403 })
        expect(marked.doStream).not.toHaveBeenCalled()
      })

    it('flags the chat before the guard for a marked artifact in the '
      + 'artifact context, without pausing the share', async () => {
      const { encodeArtifactId } = await import(
        '~~/server/utils/artifacts/store'
      )
      const result = await runSend({
        googleDataAt: null,
        directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        markedArtifactIds: [11],
        storedMessages: [{
          id: 'user-0',
          publicId: 'user-public-0',
          role: 'user',
          parts: [
            { type: 'text', text: 'Improve this page.' },
            {
              type: 'data-artifact-attachment',
              data: {
                artifactId: encodeArtifactId(11),
                version: 1,
                kind: 'html',
                title: 'Plan',
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(1_000),
        }],
      })

      expect(result.error).toMatchObject({ status: 403 })
      expect(result.doStream).not.toHaveBeenCalled()
      expect(result.updateSets).toContainEqual({
        googleDataAt: expect.anything(),
      })
      expect(result.batches).toHaveLength(1)
      expect(result.batches[0]).toHaveLength(1)
    })

    it('refuses a model that may not see Google data when a killed send '
      + 'left a marked artifact or document and no reply', async () => {
      const result = await runSend({
        googleDataAt: null,
        holdsMarkedOrigin: true,
        directModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      })

      expect(result.error).toMatchObject({ status: 403 })
      expect(result.doStream).not.toHaveBeenCalled()
      expect(result.insertValues).not.toHaveBeenCalled()
      expect(result.updateSets).toContainEqual({
        googleDataAt: expect.anything(),
      })
      expect(result.batches).toHaveLength(1)
      expect(result.batches[0]).toHaveLength(1)
    })

    it('flags the chat and answers on an allowed model after a killed send',
      async () => {
        const result = await runSend({
          googleDataAt: null,
          holdsMarkedOrigin: true,
        })

        expect(result.error).toBeNull()
        expect(result.doStream).toHaveBeenCalled()
        expect(result.updateSets).toContainEqual({
          googleDataAt: expect.anything(),
        })
      })

    it('adds no query for the marked origin: it rides on the chat query',
      async () => {
        const ordinary = await runSend({ googleDataAt: null })
        const flagged = await runSend({ googleDataAt: GOOGLE_DATA_AT })

        for (const result of [ordinary, flagged]) {
          expect(result.chatsFindFirst).toHaveBeenCalledTimes(1)
          expect(result.chatsFindFirst).toHaveBeenCalledWith(
            expect.objectContaining({ extras: expect.any(Object) }),
          )
          expect(result.batches).toHaveLength(0)
        }
      })

    function gatewayOptionsOf(result: Awaited<ReturnType<typeof runSend>>) {
      return (result.useGatewayMock.mock.calls[0] as unknown[] | undefined)
        ?.at(-1)
    }

    it('sends no gateway safeguards in a chat without Google data while no '
      + 'Google tool is registered, even with google.drive on', async () => {
      mocks.flags.add('tool-approvals')
      mocks.flags.add('google.drive')

      const result = await runSend({
        googleDataAt: null,
        gateway: { id: 'openrouter', modelId: 'openai/gpt-5' },
      })

      expect(gatewayOptionsOf(result)).toEqual({ googleDataSafeguards: false })
      expect(result.firstCallProviderOptions ?? {})
        .not.toHaveProperty('gateway')
    })

    it('sends the gateway safeguards once the send registers a Google tool',
      async () => {
        mocks.flags.add('tool-approvals')
        mocks.flags.add('google.drive')
        mocks.googleCandidates = {
          tools: { google__drive_search: { execute: vi.fn() } },
          entries: new Map([['google__drive_search', {}]]),
        }

        const result = await runSend({
          googleDataAt: null,
          gateway: { id: 'openrouter', modelId: 'openai/gpt-5' },
        })

        expect(gatewayOptionsOf(result)).toEqual({ googleDataSafeguards: true })
      })

    it('shows the Google reason when Vercel refuses zero data retention on '
      + 'a flagged send', async () => {
      const refusal = Object.assign(
        new Error('Forbidden: {"error":"team plan"}'),
        { statusCode: 403, responseBody: '{"error":"team plan"}' },
      )

      await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        gateway: { id: 'vercel', modelId: 'openai/gpt-5' },
        streamError: refusal,
      })

      const chunks: Array<Record<string, any>> = []

      for await (const chunk of mocks.mergedStreams[0] as any) {
        chunks.push(chunk)
      }

      const errorChunk = chunks.find(chunk => chunk.type === 'error')
      const payload = JSON.parse(errorChunk?.errorText ?? '{}')

      expect(payload).toMatchObject({
        status: 403,
        message: expect.stringContaining('zero data retention'),
        why: expect.stringContaining('Hobby'),
      })
      expect(errorChunk?.errorText).not.toContain('team plan')
    })

    it('always sends the gateway safeguards in a flagged chat', async () => {
      const result = await runSend({
        googleDataAt: GOOGLE_DATA_AT,
        gateway: { id: 'openrouter', modelId: 'openai/gpt-5' },
      })

      expect(gatewayOptionsOf(result)).toEqual({ googleDataSafeguards: true })
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
