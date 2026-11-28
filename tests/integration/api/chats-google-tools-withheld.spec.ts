import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

vi.mock('~~/server/utils/tool-approval/secret', () => ({
  useToolApprovalSecret: async () => 'test-tool-approval-secret',
}))

/**
 * Drives the real send route for a user with an active Google connection
 * whose model may not receive Google data, to prove the chat says why no
 * Google tool was offered: one `data-google-tools-withheld` part on the
 * live stream and on the stored assistant message, and nothing about it in
 * what the model receives.
 */
const mocks = vi.hoisted(() => ({
  writers: [] as Array<{ write: ReturnType<typeof vi.fn> }>,
  flags: new Set<string>(),
  resolveJevRoleModel: vi.fn(),
  resolveJevRoleApiKey: vi.fn(),
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
        merge: vi.fn(),
      }

      mocks.writers.push(writer)

      return { writer, ready: execute({ writer }) }
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

vi.mock('~~/server/utils/files/assistant-files', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/assistant-files')
  >()

  return {
    ...actual,
    getModelContextFileStorageKeys: vi.fn(() => []),
    getGeneratedImageFileIds: vi.fn(() => []),
    isKnownImageGenerationModel: vi.fn(() => false),
    normalizeAssistantMessagePartsForPersistence: vi.fn(
      async (input: { parts: unknown }) => input.parts,
    ),
    isPersistedOversizedResponseFailureText: vi.fn(() => false),
    stripUndeliveredInlineDataParts: vi.fn((parts: unknown) => parts),
  }
})

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const WITHHELD_PART_TYPE = 'data-google-tools-withheld'
const NOTE_TEXTS = [
  'Google tools were not offered',
  'withheld',
  'model_may_not_receive_google_data',
  'provider_tool_not_removable',
]

interface DirectModel {
  providerId: string
  modelId: string
}

const UNCONFIRMED_GEMINI: DirectModel = {
  providerId: 'google',
  modelId: 'gemini-3-pro',
}
const ANTHROPIC_MODEL: DirectModel = {
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-5',
}
const OPENAI_MODEL: DirectModel = {
  providerId: 'openai',
  modelId: 'gpt-5-mini',
}

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
  paidTierConfirmedAt?: Date | null
  storedMessages?: unknown[]
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
            googleDataAt: null,
            holdsMarkedOrigin: 0,
            messages: input.storedMessages ?? [],
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({
            apiKey: 'encrypted-key',
            paidTierConfirmedAt: input.paidTierConfirmedAt ?? null,
          })),
        },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
      batch: vi.fn(async (statements: unknown[]) => {
        return await Promise.all(statements)
      }),
      select: vi.fn(() => ({ from: () => ({ where: async () => [] }) })),
    },
    insertValues,
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

function stubProviderBuilders(
  model: MockLanguageModelV4,
  declaresProviderTool: boolean,
) {
  const builder = vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  }))
  const anthropicBuilder = vi.fn(async () => ({
    instance: model,
    tools: declaresProviderTool
      ? {
        tools: {
          web_search_preview: {
            type: 'provider',
            id: 'anthropic.web_search_20250305',
            args: {},
          },
        },
      }
      : {},
    providerOptions: {},
  }))

  for (const name of ['useOpenAI', 'useGoogle']) {
    vi.stubGlobal(name, builder)
  }

  vi.stubGlobal('useAnthropic', anthropicBuilder)
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

async function runSend(input: {
  directModel?: DirectModel
  paidTierConfirmedAt?: Date | null
  storedMessages?: unknown[]
  declaresProviderTool?: boolean
}) {
  const directModel = input.directModel ?? UNCONFIRMED_GEMINI
  const { model, doStream } = createTextModel()
  const writerIndex = mocks.writers.length

  stubSendGlobals(directModel)
  stubProviderBuilders(model, input.declaresProviderTool === true)
  vi.stubGlobal('useGateway', vi.fn())

  const created = createDb({
    paidTierConfirmedAt: input.paidTierConfirmedAt,
    storedMessages: input.storedMessages,
  })

  vi.stubGlobal('useDb', () => created.db)

  const handler = await getHandler()
  const result = await handler({
    params: { slug: CHAT_SLUG },
    body: {
      model: directModel.modelId,
      tools: [],
      reasoning: 'off',
      messages: [{
        id: 'user-public-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Show tomorrow\'s calendar events.' }],
      }],
    },
  } as any)

  await (result as { ready: Promise<unknown> }).ready

  const writer = mocks.writers[writerIndex]!
  const writtenChunks = writer.write.mock.calls.map(([chunk]) => {
    return chunk as { type: string, data?: unknown }
  })
  const storedAssistantParts = created.insertValues.mock.calls
    .map(([values]) => values as { role?: string, parts?: unknown[] })
    .filter(values => values.role === 'assistant')
    .map(values => values.parts ?? [])
  const modelCalls = doStream.mock.calls as unknown as Array<[{
    tools?: Array<{ name: string }>
  }]>

  return {
    writtenChunks,
    storedAssistantParts,
    modelCalls,
    offeredToolNames: (modelCalls[0]?.[0].tools ?? []).map((tool) => {
      return tool.name
    }),
  }
}

function withheldParts(parts: unknown[]) {
  return parts.filter((part) => {
    return (part as { type?: string }).type === WITHHELD_PART_TYPE
  })
}

describe('chat send: Google tools withheld note', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.writers = []
    mocks.flags = new Set(['tool-approvals', 'google.drive'])
    mocks.resolveJevRoleModel.mockResolvedValue(null)
    mocks.resolveJevRoleApiKey.mockResolvedValue(null)
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())

    const { buildGoogleApprovalEntry } = await import(
      '~~/server/utils/tool-approval/send'
    )

    mocks.googleCandidates = {
      tools: {
        google__drive_search: tool({
          description: 'Search Drive.',
          inputSchema: z.object({ query: z.string() }),
          execute: vi.fn(async () => ({ references: [] })),
        }),
      },
      entries: new Map([['google__drive_search', buildGoogleApprovalEntry({
        toolName: 'google__drive_search',
        kind: 'read',
        definitionHash: 'g'.repeat(64),
        summary: 'Search Google Drive',
        toolApprovalsActive: true,
        chatGrantHash: 'g'.repeat(64),
      })]]),
    }
  })

  it('writes one part with the reason code on the stream and stores it '
    + 'first on the assistant message', async () => {
    const result = await runSend({})
    const written = result.writtenChunks.filter((chunk) => {
      return chunk.type === WITHHELD_PART_TYPE
    })

    expect(written).toEqual([{
      type: WITHHELD_PART_TYPE,
      data: { reason: 'model_may_not_receive_google_data' },
    }])
    expect(result.storedAssistantParts).toHaveLength(1)
    expect(result.storedAssistantParts[0]![0]).toEqual({
      type: WITHHELD_PART_TYPE,
      data: { reason: 'model_may_not_receive_google_data' },
    })
    expect(withheldParts(result.storedAssistantParts[0]!)).toHaveLength(1)
    expect(result.storedAssistantParts[0]!.at(-1)).toMatchObject({
      type: 'text',
      text: 'Done.',
    })
  })

  it('offers no Google tool and tells the model nothing about the note',
    async () => {
      const result = await runSend({})

      expect(result.modelCalls).toHaveLength(1)
      expect(result.offeredToolNames).not.toContain('google__drive_search')

      const sentToModel = JSON.stringify(result.modelCalls)

      for (const text of NOTE_TEXTS) {
        expect(sentToModel).not.toContain(text)
      }
    })

  it('keeps a note stored on an earlier assistant message out of the '
    + 'history the model receives', async () => {
    const result = await runSend({
      storedMessages: [
        {
          id: 'stored-user-1',
          publicId: 'stored-user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'What is on my calendar?' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(1_000),
        },
        {
          id: 'stored-assistant-1',
          publicId: 'stored-assistant-public-1',
          role: 'assistant',
          parts: [
            {
              type: WITHHELD_PART_TYPE,
              data: { reason: 'model_may_not_receive_google_data' },
            },
            { type: 'text', text: 'I have no calendar tool here.' },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(2_000),
        },
      ],
    })
    const sentToModel = JSON.stringify(result.modelCalls)

    expect(result.modelCalls).toHaveLength(1)
    expect(sentToModel).toContain('I have no calendar tool here.')
    expect(sentToModel).not.toContain(WITHHELD_PART_TYPE)

    for (const text of NOTE_TEXTS) {
      expect(sentToModel).not.toContain(text)
    }
  })

  it('writes and stores one part for each of two independent sends',
    async () => {
      const first = await runSend({})
      const second = await runSend({})

      expect(first.storedAssistantParts).toHaveLength(1)
      expect(second.storedAssistantParts).toHaveLength(1)
      expect(withheldParts(first.storedAssistantParts[0]!)).toHaveLength(1)
      expect(withheldParts(second.storedAssistantParts[0]!)).toHaveLength(1)
      expect(second.writtenChunks.filter((chunk) => {
        return chunk.type === WITHHELD_PART_TYPE
      })).toHaveLength(1)
    })

  it('writes the provider tool reason when a provider tool stays callable',
    async () => {
      const result = await runSend({
        directModel: ANTHROPIC_MODEL,
        declaresProviderTool: true,
      })

      expect(result.offeredToolNames).not.toContain('google__drive_search')
      expect(result.writtenChunks.filter((chunk) => {
        return chunk.type === WITHHELD_PART_TYPE
      })).toEqual([{
        type: WITHHELD_PART_TYPE,
        data: { reason: 'provider_tool_not_removable' },
      }])
      expect(result.storedAssistantParts).toHaveLength(1)
      expect(result.storedAssistantParts[0]![0]).toEqual({
        type: WITHHELD_PART_TYPE,
        data: { reason: 'provider_tool_not_removable' },
      })
      expect(withheldParts(result.storedAssistantParts[0]!)).toHaveLength(1)
    })

  it('writes no part when the model may receive Google data', async () => {
    const confirmed = await runSend({
      paidTierConfirmedAt: new Date(1_000),
    })

    expect(confirmed.offeredToolNames).toContain('google__drive_search')
    expect(confirmed.writtenChunks.some((chunk) => {
      return chunk.type === WITHHELD_PART_TYPE
    })).toBe(false)
    expect(withheldParts(confirmed.storedAssistantParts[0]!)).toHaveLength(0)

    const direct = await runSend({ directModel: OPENAI_MODEL })

    expect(direct.offeredToolNames).toContain('google__drive_search')
    expect(withheldParts(direct.storedAssistantParts[0]!)).toHaveLength(0)
  })

  describe('the model-refused sentence in the system prompt', () => {
    const SENTENCE = 'The user has Google services connected in Besidka '
      + '(Drive, Gmail, Calendar), but they are not available to this '
      + 'model. If the request needs them, say so and suggest switching to '
      + 'another model; do not suggest connecting a service.'

    function systemTextOf(result: { modelCalls: unknown[] }): string {
      const [call] = result.modelCalls as Array<[{
        prompt: Array<{ role: string, content: unknown }>
      }]>

      return call![0].prompt
        .filter(message => message.role === 'system')
        .map(message => String(message.content))
        .join('\n\n')
    }

    it('reaches the model exactly once when the recipient was refused',
      async () => {
        const systemText = systemTextOf(await runSend({}))

        expect(systemText.split(SENTENCE)).toHaveLength(2)
      })

    it('is absent for the provider tool reason', async () => {
      const result = await runSend({
        directModel: ANTHROPIC_MODEL,
        declaresProviderTool: true,
      })

      expect(systemTextOf(result)).not.toContain('Google services connected')
    })

    it('is absent when the model may receive Google data', async () => {
      const result = await runSend({ paidTierConfirmedAt: new Date(1_000) })

      expect(systemTextOf(result)).not.toContain('Google services connected')
    })

    it('is absent for a user without Google candidates', async () => {
      mocks.googleCandidates = null

      const result = await runSend({})

      expect(systemTextOf(result)).not.toContain('Google services connected')
    })
  })

  it('writes no part for a user without Google candidates', async () => {
    mocks.googleCandidates = null

    const result = await runSend({})

    expect(result.writtenChunks.some((chunk) => {
      return chunk.type === WITHHELD_PART_TYPE
    })).toBe(false)
    expect(withheldParts(result.storedAssistantParts[0]!)).toHaveLength(0)
  })
})
