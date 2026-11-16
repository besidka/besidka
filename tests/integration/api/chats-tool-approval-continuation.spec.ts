import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'
import {
  createMockMcpFetch,
  createMockMcpServer,
} from '../../setup/helpers/mock-mcp-server'
import type { MockMcpServer } from '../../setup/helpers/mock-mcp-server'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const MODEL_ID = 'gpt-5-mini'
const HEADER_SECRET = 'header-api-key-secret-9999'
const LINEAR_URL = 'https://mcp.linear.example.com/mcp'
const CHAT_PUBLIC_ID = 'chat-1'
const USER_MESSAGE_ID = 'user-public-1'

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  writers: [] as Array<{ write: ReturnType<typeof vi.fn> }>,
  flags: new Set<string>(),
  kv: new Map<string, string>(),
  chatMessages: [] as Array<Record<string, any>>,
  capabilityTools: {} as Record<string, unknown>,
  artifactExecute: null as null | ReturnType<typeof vi.fn>,
  connectorUrls: {} as Record<string, string>,
  holdsSkillText: false,
  providerTools: {} as Record<string, unknown>,
  failRateLimitRead: false,
  memoryToolsEnabled: false,
  memoryWrites: [] as Array<Record<string, any>>,
  claims: new Map<string, Record<string, any>>(),
  updates: [] as Array<Record<string, any>>,
  besidkaModes: new Map<string, string>(),
  listMcpProjects: null as null | ((...args: unknown[]) => unknown),
  grantCalls: [] as Array<unknown[]>,
  scriptsRun: null as null | Record<string, any>,
  store: {
    connectors: [] as Array<Record<string, any>>,
    credentials: null as Record<string, any> | null,
    toolSettings: [] as Array<Record<string, any>>,
    chatSettings: [] as Array<Record<string, any>>,
    audit: [] as Array<Record<string, any>>,
    settlements: [] as Array<Record<string, any>>,
  },
}))

vi.mock('~~/server/utils/besidka-tools/chat-settings', () => ({
  readBesidkaChatSettings: async () => {
    return { enabled: true, alwaysAllowTools: {} }
  },
  setBesidkaChatEnabled: async () => ({ enabled: true, alwaysAllowTools: {} }),
  addBesidkaChatGrant: async (...args: unknown[]) => {
    mocks.grantCalls.push(args)
  },
}))

vi.mock('~~/server/utils/skills/send-container-options', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/skills/send-container-options')
  >()

  return {
    ...actual,
    prepareSkillScriptsForSend: async () => mocks.scriptsRun ?? {
      gate: {
        isActive: false,
        isGrantMatched: false,
        skillNames: [],
        definitionHash: null,
        tools: {},
        approvalEntries: new Map(),
      },
      eligibleSkills: [],
      attach: async () => ({
        container: null,
        attachedCount: 0,
        failed: false,
      }),
    },
  }
})

vi.mock('~~/server/utils/besidka-tools/permissions', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/besidka-tools/permissions')
  >()

  return {
    ...actual,
    resolveBesidkaPermissionModes: async (
      _userId: number,
      toolNames: readonly string[],
    ) => {
      return new Map(toolNames.map((toolName) => {
        const name = actual.toBesidkaRegistryName(toolName)

        return [toolName, mocks.besidkaModes.get(name) ?? 'blocked']
      }))
    },
  }
})

vi.mock('~~/server/utils/mcp/private/projects', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/mcp/private/projects')
  >()

  return {
    ...actual,
    listMcpProjects: (...args: unknown[]) => mocks.listMcpProjects?.(...args),
  }
})

vi.mock('~~/server/utils/tool-approval/claims', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/claims')
  >()

  return {
    ...actual,
    claimApproval: async (
      _db: unknown,
      approvalId: string,
      owner: Record<string, any>,
    ) => {
      if (mocks.claims.has(approvalId)) {
        return false
      }

      const now = new Date()

      mocks.claims.set(approvalId, {
        approvalId,
        ...owner,
        status: 'claimed',
        createdAt: now,
        updatedAt: now,
      })

      return true
    },
    findClaim: async (_db: unknown, approvalId: string, userId: number) => {
      const claim = mocks.claims.get(approvalId)

      return claim && claim.userId === userId ? claim : null
    },
    markClaimDone: async (_db: unknown, approvalId: string) => {
      const claim = mocks.claims.get(approvalId)

      if (!claim || claim.status !== 'claimed') {
        return false
      }

      claim.status = 'done'

      return true
    },
    markClaimFailed: async (_db: unknown, approvalId: string) => {
      const claim = mocks.claims.get(approvalId)

      if (!claim || claim.status !== 'claimed') {
        return false
      }

      claim.status = 'failed'

      return true
    },
    touchClaim: async () => true,
  }
})

vi.mock('~~/server/utils/tool-approval/secret', () => ({
  useToolApprovalSecret: async () => 'test-tool-approval-secret',
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
  persistGatewayGeneratedImageParts: vi.fn(
    async (input: { parts: unknown }) => ({
      parts: input.parts,
      fileIds: [],
    }),
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/memory/tools/enabled', () => ({
  isChatSearchToolEnabled: () => false,
  isMemoryToolsEnabled: () => mocks.memoryToolsEnabled,
}))

vi.mock('~~/server/utils/memory/tools/memory-tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')

  return {
    getMemoryTools: (input: Record<string, any>) => {
      return {
        tools: {
          memory_write: withFollowUpTurn(tool({
            description: 'Stub memory_write.',
            inputSchema: z.object({ body: z.string() }),
            async execute(
              writeInput: { body: string },
              options: { toolCallId?: string },
            ) {
              const isApproved = input.isApprovedByUser?.({
                toolCallId: options.toolCallId,
                toolName: 'memory_write',
                input: writeInput,
              }) === true

              if (input.budget?.untrustedResultSeen && !isApproved) {
                throw Object.assign(new Error('Memory is locked.'), {
                  status: 403,
                })
              }

              if (/\d{4} \d{4} \d{4} \d{4}/.test(writeInput.body)) {
                throw Object.assign(new Error('Never stored.'), {
                  status: 422,
                })
              }

              mocks.memoryWrites.push({ ...writeInput, isApproved })

              return { action: 'created' }
            },
          })),
        },
      }
    },
  }
})

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: async () => ({
    isFeatureActive: (flag: string) => mocks.flags.has(flag),
  }),
}))

vi.mock('~~/server/utils/skills/runtime/send', () => ({
  prepareSkillsForSend: async () => ({
    tools: {},
    toolsRegistered: false,
    instructionBlock: null,
    activeSkillsBlock: null,
    invocationBlock: null,
    holdsSkillText: mocks.holdsSkillText,
    streamActivations: [],
    getToolActivations: () => [],
  }),
}))

vi.mock('~~/server/capabilities/index', () => ({
  getCapabilityTools: async () => mocks.capabilityTools,
}))

vi.mock('~~/server/capabilities/documents', () => ({
  buildDocumentsContextLine: async () => '',
}))

vi.mock('~~/server/utils/artifacts/blob-store', () => ({
  useArtifactBlobStore: () => ({}),
}))

vi.mock('~~/server/utils/artifacts/context', () => ({
  buildArtifactContextBlock: async () => null,
}))

vi.mock('~~/server/utils/connectors/store', () => {
  const { store } = mocks

  return {
    listConnectors: async () => store.connectors,
    readConnectorCredentials: async () => store.credentials,
    readConnectorUrl: async (
      _db: unknown,
      _userId: number,
      connectorId: string,
    ) => mocks.connectorUrls[connectorId] ?? null,
    CONNECTOR_BASELINE_MARKER_SETTING: {
      toolName: '',
      definitionHash: '',
      serverReadOnly: false,
      enabled: false,
      approval: 'ask',
    },
    listConnectorToolSettings: async () => [],
    readConnectorToolBaseline: async (
      _db: unknown,
      _userId: number,
      connectorId: string,
    ) => {
      const settings = store.toolSettings.filter((setting) => {
        return setting.connectorId === connectorId
      })

      return {
        isBaselined: settings.length > 0,
        settings: settings.filter(setting => setting.toolName !== ''),
      }
    },
    upsertConnectorToolSettings: async (
      _db: unknown,
      _userId: number,
      connectorId: string,
      tools: Array<Record<string, any>>,
    ) => {
      store.toolSettings.push(...tools.map((setting) => {
        return { ...setting, connectorId }
      }))
    },
    updateConnector: async () => null,
    recordConnectorToolCall: async (
      _db: unknown,
      input: Record<string, any>,
    ) => {
      store.audit.push(input)

      return store.audit.length
    },
    settleConnectorToolCall: async (
      _db: unknown,
      _userId: number,
      callId: number,
      settlement: Record<string, any>,
    ) => {
      store.settlements.push({ callId, ...settlement })
    },
    listConnectorChatSettings: async () => store.chatSettings,
    upsertConnectorChatSettings: async (
      _db: unknown,
      input: Record<string, any>,
    ) => {
      store.chatSettings.push({ ...input })
    },
    compareAndDeleteConnectorCredentials: async () => false,
    compareAndSetConnectorTokens: async () => false,
  }
})

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

function toolCallChunks(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
) {
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: 'finish' as const,
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function textChunks(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function createScriptedModel(steps: Array<Array<Record<string, unknown>>>) {
  let callCount = 0
  const doStream = vi.fn(async () => {
    const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

    callCount += 1

    return { stream: simulateReadableStream({ chunks: chunks as any }) }
  })

  return { model: new MockLanguageModelV4({ doStream }), doStream }
}

function createDb() {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateSet = vi.fn((values: Record<string, any>) => {
    const result = Promise.resolve(undefined)

    return {
      where: () => Object.assign(result, {
        returning: async () => {
          mocks.updates.push(values)

          return [{ id: 'message-db-id', publicId: 'updated' }]
        },
      }),
    }
  })

  insertValues.mockImplementation(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({ returning: () => ({ get: insertGet }) }),
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
            id: CHAT_PUBLIC_ID,
            projectId: null,
            project: null,
            branchedFromShareSlug: null,
            messages: mocks.chatMessages,
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
        },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
  }
}

function createKv() {
  return {
    get: vi.fn(async (key: string) => {
      if (mocks.failRateLimitRead && key.startsWith('tool-approval-rate:')) {
        throw new Error('KV unavailable')
      }

      return mocks.kv.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      mocks.kv.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      mocks.kv.delete(key)
    }),
  }
}

function readKvJson(key: string): Record<string, any> | null {
  const value = mocks.kv.get(key)

  return value ? JSON.parse(value) : null
}

function seedConnector(input: {
  id: string
  slug: string
  title: string
  url: string
}) {
  const now = new Date()
  const origin = new URL(input.url).origin

  mocks.connectorUrls[input.id] = input.url
  mocks.store.connectors.push({
    id: input.id,
    userId: 1,
    slug: input.slug,
    title: input.title,
    origin,
    transport: 'streamable-http',
    authType: 'header',
    status: 'ready',
    enabled: true,
    createdVia: 'app',
    consentOrigin: origin,
    consentIssuer: null,
    consentVersion: CONNECTOR_CONSENT_VERSION,
    consentedAt: now,
    consentWithdrawnAt: null,
    toolMode: 'always-on',
    updatedAt: now,
  })
  mocks.store.credentials = {
    connectorId: input.id,
    issuer: '',
    clientRegistration: null,
    accessToken: null,
    refreshToken: null,
    headerName: 'X-Api-Key',
    headerValue: HEADER_SECRET,
    scope: null,
    expiresAt: null,
    updatedAt: now,
    generation: 'g1',
  }
}

interface RequestResult {
  doStream: ReturnType<typeof vi.fn>
  model: MockLanguageModelV4
  inserts: Array<Record<string, any>>
}

async function request(input: {
  body: Record<string, unknown>
  steps?: Array<Array<Record<string, unknown>>>
  servers: MockMcpServer[]
}): Promise<RequestResult> {
  const { model, doStream } = createScriptedModel(
    input.steps ?? [textChunks('Unused.')],
  )

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: mocks.providerTools,
    providerOptions: {},
  })))
  vi.stubGlobal('fetch', createMockMcpFetch(input.servers))

  const handler = (await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )).default
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: input.body,
    res: { headers: new Headers() },
  } as any)

  await result.ready

  return {
    doStream,
    model,
    inserts: created.insertValues.mock.calls.map(([value]) => value),
  }
}

interface PausedTurn {
  messagePublicId: string
  approvalIds: string[]
  assistantParts: Array<Record<string, any>>
}

async function pauseTurn(input: {
  steps: Array<Array<Record<string, unknown>>>
  servers: MockMcpServer[]
  tools?: string[]
  connectorIds?: string[]
}): Promise<PausedTurn> {
  const first = await request({
    servers: input.servers,
    steps: input.steps,
    body: {
      model: MODEL_ID,
      tools: input.tools ?? [],
      reasoning: 'off',
      connectorIds: input.connectorIds ?? ['conn-linear'],
      messages: [{
        id: USER_MESSAGE_ID,
        role: 'user',
        parts: [{ type: 'text', text: 'Do the thing' }],
      }],
    },
  })
  const userInsert = first.inserts.find(value => value.role === 'user')
  const assistantInsert = first.inserts.find((value) => {
    return value.role === 'assistant'
  })

  mocks.chatMessages.push(
    {
      id: 'row-user',
      publicId: userInsert?.publicId ?? USER_MESSAGE_ID,
      role: 'user',
      parts: userInsert?.parts ?? [{ type: 'text', text: 'Do the thing' }],
      tools: userInsert?.tools ?? input.tools ?? [],
      reasoning: 'off',
      usage: null,
      createdAt: new Date(),
    },
    {
      id: 'row-assistant',
      publicId: assistantInsert.publicId,
      role: 'assistant',
      parts: assistantInsert.parts,
      tools: [],
      reasoning: 'off',
      usage: assistantInsert.usage,
      createdAt: new Date(),
    },
  )
  mocks.mergedStreams = []
  mocks.writers = []

  const approvalIds = assistantInsert.parts
    .filter((part: any) => part.state === 'approval-requested')
    .map((part: any) => part.approval.id)

  return {
    messagePublicId: assistantInsert.publicId,
    approvalIds,
    assistantParts: assistantInsert.parts,
  }
}

function answerBody(
  messageId: string,
  responses: Array<Record<string, unknown>>,
) {
  return { approval: { messageId, responses } }
}

function storeUpdatedAssistant() {
  const assistant = mocks.chatMessages.find((message) => {
    return message.id === 'row-assistant'
  })
  const latest = mocks.updates.at(-1)

  if (assistant && latest) {
    assistant.parts = latest.parts
    assistant.usage = latest.usage
  }
}

function lastToolMessage(doStream: ReturnType<typeof vi.fn>) {
  const prompt = (doStream.mock.calls[0]?.[0] as any)?.prompt ?? []

  return prompt.filter((message: any) => message.role === 'tool').at(-1)
}

async function readClientChunks(): Promise<Array<Record<string, any>>> {
  const chunks: Array<Record<string, any>> = []

  for (const stream of mocks.mergedStreams) {
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
    }
  }

  return chunks
}

function writtenChunks(): Array<Record<string, any>> {
  return mocks.writers.flatMap(writer => writer.write.mock.calls)
    .map(([chunk]) => chunk)
}

function findPart(parts: Array<Record<string, any>>, type: string) {
  return parts.find(part => part.type === type)
}

describe('tool approval continuation', () => {
  let linear: MockMcpServer

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.writers = []
    mocks.flags = new Set(['connectors', 'tool-approvals'])
    mocks.holdsSkillText = false
    mocks.memoryToolsEnabled = false
    mocks.providerTools = {}
    mocks.failRateLimitRead = false
    mocks.memoryWrites = []
    mocks.claims = new Map()
    mocks.updates = []
    mocks.besidkaModes = new Map()
    mocks.grantCalls = []
    mocks.scriptsRun = null
    mocks.listMcpProjects = vi.fn(async () => ({
      projects: [{ id: 'prj_1', name: 'Launch' }],
      nextCursor: null,
    }))
    mocks.kv = new Map()
    mocks.chatMessages = []
    mocks.capabilityTools = {}
    mocks.artifactExecute = null
    mocks.connectorUrls = {}
    Object.assign(mocks.store, {
      connectors: [],
      credentials: null,
      toolSettings: [],
      chatSettings: [],
      audit: [],
      settlements: [],
    })
    linear = createMockMcpServer({
      url: LINEAR_URL,
      tools: [
        {
          name: 'list_issues',
          description: 'List issues.',
          annotations: { readOnlyHint: true },
        },
        { name: 'create_issue', description: 'Create an issue.' },
      ],
      respond: name => ({ text: `${name} result` }),
    })
    seedConnector({
      id: 'conn-linear',
      slug: 'linear',
      title: 'Linear',
      url: LINEAR_URL,
    })

    const kv = createKv()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      status?: number
      message?: string
    }) => {
      const exception = new Error(input.message || 'Error')

      Object.assign(exception, {
        statusCode: input.statusCode ?? input.status,
        ...input,
      })

      return exception
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => parser(event.body))
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
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('useRuntimeConfig', () => ({
      encryptionKey: 'test-encryption-key',
      public: {},
    }))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: {
        id: MODEL_ID,
        name: 'GPT-5 mini',
        tools: ['web_search'],
        toolCall: true,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
  })

  const CREATE_ISSUE = 'mcp__linear__create_issue'

  async function pauseCreateIssue(calls: string[] = ['call-1']) {
    return await pauseTurn({
      servers: [linear],
      steps: [[
        ...calls.flatMap((toolCallId) => {
          return toolCallChunks(toolCallId, CREATE_ISSUE, { title: toolCallId })
            .slice(0, 1)
        }),
        toolCallChunks('unused', CREATE_ISSUE, {}).at(-1)!,
      ]],
    })
  }

  async function answer(
    paused: PausedTurn,
    responses: Array<Record<string, unknown>>,
    steps: Array<Array<Record<string, unknown>>> = [textChunks('Done.')],
  ) {
    return await request({
      servers: [linear],
      steps,
      body: answerBody(paused.messagePublicId, responses),
    })
  }

  describe('the skill scripts consent', () => {
    const GATE = 'run_skill_scripts'
    const GATE_HASH = 'c'.repeat(64)
    const CONTAINER = {
      skills: [{
        type: 'custom',
        providerReference: { anthropic: 'skill_01' },
        version: '1759178010',
      }],
    }

    function installGate(hash = GATE_HASH) {
      const execute = vi.fn(async () => 'Allowed.')
      const attach = vi.fn(async (input: { isApproved: boolean }) => {
        return input.isApproved
          ? { container: CONTAINER, attachedCount: 1, failed: false }
          : { container: null, attachedCount: 0, failed: false }
      })

      mocks.scriptsRun = {
        gate: {
          isActive: true,
          isGrantMatched: false,
          skillNames: ['data-report'],
          definitionHash: hash,
          tools: {
            [GATE]: tool({
              description: 'Ask for the scripts consent.',
              inputSchema: z.object({}),
              execute,
            }),
          },
          approvalEntries: new Map([[GATE, {
            descriptor: {
              family: 'native',
              access: 'write',
              toolName: GATE,
              destructiveHint: false,
              consentGate: true,
              definitionHash: hash,
            },
            summary:
              'Run scripts from data-report in Anthropic\'s container on '
              + 'your key?',
            taint: null,
            readSource: null,
            connector: null,
          }]]),
        },
        eligibleSkills: [],
        attach,
      }

      return { execute, attach }
    }

    async function pauseGate() {
      const [toolCall, finish] = toolCallChunks('call-gate', GATE, {})

      return await pauseTurn({
        servers: [linear],
        steps: [[toolCall!, finish!]],
      })
    }

    it('pauses the first run with a consent request and uploads nothing', async () => {
      const { execute, attach } = installGate()
      const paused = await pauseGate()
      const approvalPart = findPart(
        paused.assistantParts,
        'data-tool-approval',
      )

      expect(paused.approvalIds).toHaveLength(1)
      expect(approvalPart?.data).toMatchObject({
        toolName: GATE,
        reason: 'consent',
        rememberOptions: ['once', 'chat'],
        summary:
          'Run scripts from data-report in Anthropic\'s container on your key?',
      })
      expect(execute).not.toHaveBeenCalled()
      expect(attach).not.toHaveBeenCalledWith({ isApproved: true })
    })

    it('uploads and sends container.skills once the answer is approved', async () => {
      const { execute, attach } = installGate()
      const paused = await pauseGate()
      const [approvalId] = paused.approvalIds
      const { doStream } = await answer(paused, [
        { approvalId, approved: true, remember: 'once' },
      ], [textChunks('Ran it.')])
      const options = doStream.mock.calls[0]![0] as any

      expect(attach).toHaveBeenCalledWith({ isApproved: true })
      expect(execute).toHaveBeenCalledTimes(1)
      expect(options.providerOptions.anthropic.container).toEqual(CONTAINER)
      expect(mocks.grantCalls).toEqual([])
    })

    it('stores the chat grant for the exact set on Allow in this chat', async () => {
      installGate()

      const paused = await pauseGate()
      const [approvalId] = paused.approvalIds

      await answer(paused, [
        { approvalId, approved: true, remember: 'chat' },
      ], [textChunks('Ran it.')])

      expect(mocks.grantCalls).toHaveLength(1)
      expect(mocks.grantCalls[0]!.slice(2)).toEqual([
        CHAT_PUBLIC_ID,
        { toolName: GATE, definitionHash: GATE_HASH },
      ])
    })

    it('never stores a grant for Always, which the request did not offer', async () => {
      installGate()

      const paused = await pauseGate()
      const [approvalId] = paused.approvalIds

      await answer(paused, [
        { approvalId, approved: true, remember: 'always' },
      ], [textChunks('Ran it.')])

      expect(mocks.grantCalls).toEqual([])
    })

    it.each([
      ['a version of the skill was edited', 'd'.repeat(64)],
      ['another skill was enabled for scripts', 'e'.repeat(64)],
    ])('asks again instead of uploading when %s after the request', async (
      _label,
      newHash,
    ) => {
      installGate()

      const paused = await pauseGate()
      const [approvalId] = paused.approvalIds
      const drifted = installGate(newHash)
      const { doStream } = await answer(paused, [
        { approvalId, approved: true, remember: 'chat' },
      ], [textChunks('Asking again.')])
      const options = doStream.mock.calls[0]![0] as any

      expect(drifted.execute).not.toHaveBeenCalled()
      expect(drifted.attach).not.toHaveBeenCalledWith({ isApproved: true })
      expect(options.providerOptions.anthropic?.container).toBeUndefined()
      expect(mocks.grantCalls).toEqual([])
      expect(JSON.stringify(lastToolMessage(doStream))).toContain(
        'changed',
      )
    })

    it('uploads nothing and sends no container when the user denies', async () => {
      const { execute, attach } = installGate()
      const paused = await pauseGate()
      const [approvalId] = paused.approvalIds
      const { doStream } = await answer(paused, [
        { approvalId, approved: false },
      ], [textChunks('Continuing without scripts.')])
      const options = doStream.mock.calls[0]![0] as any

      expect(execute).not.toHaveBeenCalled()
      expect(attach).not.toHaveBeenCalledWith({ isApproved: true })
      expect(options.providerOptions.anthropic?.container).toBeUndefined()
      expect(lastToolMessage(doStream)).toBeDefined()
    })
  })

  it('runs an approved call once and resumes the same message', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const { doStream, inserts } = await answer(paused, [
      { approvalId, approved: true },
    ], [textChunks('Created the issue.')])
    const clientChunks = await readClientChunks()
    const update = mocks.updates.at(-1)!
    const toolPart = findPart(update.parts, 'dynamic-tool')

    expect(linear.callCount('tools/call')).toBe(1)
    expect(doStream).toHaveBeenCalledTimes(1)
    expect(inserts.some(value => value.role === 'assistant')).toBe(false)
    expect(clientChunks[0]).toMatchObject({
      type: 'start',
      messageId: paused.messagePublicId,
    })
    expect(clientChunks.some((chunk) => {
      return chunk.type === 'tool-output-available'
        && chunk.toolCallId === 'call-1'
    })).toBe(true)
    expect(toolPart).toMatchObject({
      toolCallId: 'call-1',
      state: 'output-available',
    })
    expect(toolPart.approval.signature).toBeUndefined()
    expect(update.parts.some((part: any) => {
      return part.type === 'text' && part.text === 'Created the issue.'
    })).toBe(true)
    expect(update.parts.length).toBeGreaterThan(paused.assistantParts.length)
    expect(update.usage).toMatchObject({ inputTokens: 20, outputTokens: 40 })
    expect(mocks.kv.has(`tool-approval:${approvalId}`)).toBe(false)
    expect(mocks.kv.has(`tool-approval:turn:${paused.messagePublicId}`))
      .toBe(false)
    expect(mocks.kv.has(`tool-approval:result:${approvalId}`)).toBe(false)
    expect(mocks.claims.get(approvalId)?.status).toBe('done')
    expect(mocks.store.audit).toHaveLength(1)
    expect(mocks.store.settlements).toEqual([
      expect.objectContaining({ callId: 1, outcome: 'ok', approval: 'once' }),
    ])
  })

  it('keeps a tool loaded before the pause offered after the approval',
    async () => {
      mocks.store.connectors[0]!.toolMode = 'manual'

      const paused = await pauseTurn({
        servers: [linear],
        steps: [
          toolCallChunks('call-load', 'tool_index__load', {
            names: [CREATE_ISSUE],
          }),
          toolCallChunks('call-1', CREATE_ISSUE, { title: 'x' }),
        ],
      })
      const [approvalId] = paused.approvalIds

      expect(approvalId).toBeDefined()
      expect(linear.callCount('tools/call')).toBe(0)

      const { doStream } = await answer(paused, [
        { approvalId, approved: true },
      ], [textChunks('Created the issue.')])
      const toolNames = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((tool: { name: string }) => tool.name)

      expect(linear.callCount('tools/call')).toBe(1)
      expect(toolNames).toContain('tool_index__load')
      expect(toolNames).toContain(CREATE_ISSUE)
      expect(mocks.store.settlements).toEqual([
        expect.objectContaining({ outcome: 'ok', approval: 'once' }),
      ])
    })

  it('keeps an Auto connector opened before the pause open after the '
    + 'approval, from its snapshot', async () => {
    mocks.store.connectors[0]!.toolMode = 'auto'
    mocks.store.chatSettings = []

    const paused = await pauseTurn({
      servers: [linear],
      connectorIds: [],
      steps: [
        toolCallChunks('call-open', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-1', CREATE_ISSUE, { title: 'x' }),
      ],
    })
    const [approvalId] = paused.approvalIds

    expect(approvalId).toBeDefined()
    expect(linear.callCount('tools/call')).toBe(0)
    expect(readKvJson('connectors:catalog:conn-linear')).toBeTruthy()

    const listsBeforeResume = linear.callCount('tools/list')
    const { doStream } = await answer(paused, [
      { approvalId, approved: true },
    ], [textChunks('Created the issue.')])
    const toolNames = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
      .map((tool: { name: string }) => tool.name)

    expect(linear.callCount('tools/call')).toBe(1)
    expect(linear.callCount('tools/list')).toBe(listsBeforeResume + 1)
    expect(toolNames).toContain('use_connector')
    expect(toolNames).toContain(CREATE_ISSUE)
    expect(mocks.store.settlements).toEqual([
      expect.objectContaining({ outcome: 'ok', approval: 'once' }),
    ])
  })

  it('stores the call provider metadata and replays it to the model',
    async () => {
      const [toolCall, finish] = toolCallChunks('call-1', CREATE_ISSUE, {
        title: 'x',
      })
      const paused = await pauseTurn({
        servers: [linear],
        steps: [[{
          ...toolCall!,
          providerMetadata: { google: { thoughtSignature: 'thought-sig' } },
        }, finish!]],
      })
      const [approvalId] = paused.approvalIds

      expect(readKvJson(`tool-approval:${approvalId}`)?.callProviderMetadata)
        .toEqual({ google: { thoughtSignature: 'thought-sig' } })

      const { doStream } = await answer(paused, [
        { approvalId, approved: true },
      ])
      const prompt = (doStream.mock.calls[0]?.[0] as any).prompt
      const replayedCall = prompt
        .flatMap((message: any) => {
          return Array.isArray(message.content) ? message.content : []
        })
        .find((part: any) => part.type === 'tool-call')

      expect(replayedCall.providerOptions)
        .toEqual({ google: { thoughtSignature: 'thought-sig' } })
    })

  it('lets the model see a denial and never runs the call', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const { doStream } = await answer(paused, [
      { approvalId, approved: false, reason: 'Not‮ now' },
    ])
    const toolMessage = lastToolMessage(doStream)

    expect(linear.callCount('tools/call')).toBe(0)
    expect(toolMessage.content).toEqual([
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'call-1',
        output: {
          type: 'execution-denied',
          reason: 'The user declined this action. Their note: Not now',
        },
      }),
    ])
    expect(findPart(mocks.updates.at(-1)!.parts, 'dynamic-tool'))
      .toMatchObject({ state: 'output-denied' })
    expect(mocks.claims.get(approvalId)?.status).toBe('done')
    expect(mocks.store.settlements).toEqual([
      expect.objectContaining({ outcome: 'denied', approval: 'denied' }),
    ])
  })

  it('refuses an answer once a newer message follows the reply', async () => {
    const paused = await pauseCreateIssue()

    mocks.chatMessages.push({
      id: 'row-later',
      publicId: 'user-public-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Never mind' }],
      tools: [],
      reasoning: 'off',
      usage: null,
      createdAt: new Date(),
    })

    await expect(answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ])).rejects.toMatchObject({ status: 409, code: 'TOOL_APPROVAL_STALE' })
    expect(linear.callCount('tools/call')).toBe(0)
  })

  it('answers 404 for a message or record of another chat', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds

    await expect(request({
      servers: [linear],
      body: answerBody('someone-elses-message', [
        { approvalId, approved: true },
      ]),
    })).rejects.toMatchObject({ status: 404 })

    const pendingKey = `tool-approval:${approvalId}`

    mocks.kv.set(pendingKey, JSON.stringify({
      ...readKvJson(pendingKey),
      chatPublicId: 'other-chat',
    }))

    await expect(answer(paused, [{ approvalId, approved: true }]))
      .rejects.toMatchObject({ status: 404 })
    expect(linear.callCount('tools/call')).toBe(0)
    expect(mocks.claims.size).toBe(0)
  })

  it('rejects a forged approval id or signature before any model call',
    async () => {
      const paused = await pauseCreateIssue()
      const [approvalId] = paused.approvalIds

      await expect(answer(paused, [
        { approvalId: 'forged-approval-id', approved: true },
      ])).rejects.toMatchObject({ status: 400 })

      const pendingKey = `tool-approval:${approvalId}`

      mocks.kv.set(pendingKey, JSON.stringify({
        ...readKvJson(pendingKey),
        input: { title: 'tampered' },
      }))

      const { doStream } = await answer(paused, [
        { approvalId, approved: true },
      ])

      expect(doStream).not.toHaveBeenCalled()
      expect(linear.callCount('tools/call')).toBe(0)
    })

  it('refuses a partial answer with 400', async () => {
    const paused = await pauseCreateIssue(['call-1', 'call-2'])

    expect(paused.approvalIds).toHaveLength(2)
    await expect(answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ])).rejects.toMatchObject({ status: 400 })
    expect(linear.callCount('tools/call')).toBe(0)
    expect(mocks.claims.size).toBe(0)
  })

  it('runs a double submit once and replays the stored reply', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds

    await answer(paused, [{ approvalId, approved: true }], [
      textChunks('Created the issue.'),
    ])
    storeUpdatedAssistant()
    mocks.writers = []
    mocks.mergedStreams = []

    const second = await answer(paused, [{ approvalId, approved: true }])
    const chunks = writtenChunks()

    expect(linear.callCount('tools/call')).toBe(1)
    expect(second.doStream).not.toHaveBeenCalled()
    expect(chunks[0]).toEqual({
      type: 'start',
      messageId: paused.messagePublicId,
    })
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'tool-output-available',
      toolCallId: 'call-1',
    }))
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'text-delta',
      delta: 'Created the issue.',
    }))
  })

  it('waits while the first answer still streams, and reports a claimed '
    + 'answer whose reply never landed', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const now = new Date()
    const leaseKey = `chat-generating:${CHAT_PUBLIC_ID}:${paused.messagePublicId}`

    mocks.claims.set(approvalId, {
      approvalId,
      userId: 1,
      chatPublicId: CHAT_PUBLIC_ID,
      messagePublicId: paused.messagePublicId,
      status: 'done',
      createdAt: now,
      updatedAt: now,
    })
    mocks.kv.set(leaseKey, '1')

    const waiting = await answer(paused, [{ approvalId, approved: true }])

    expect(waiting.doStream).not.toHaveBeenCalled()
    expect(writtenChunks()).toContainEqual(expect.objectContaining({
      type: 'data-generation-pending',
    }))

    mocks.kv.delete(leaseKey)

    await expect(answer(paused, [{ approvalId, approved: true }]))
      .rejects.toMatchObject({ status: 409, code: 'TOOL_APPROVAL_INTERRUPTED' })
    expect(linear.callCount('tools/call')).toBe(0)
  })

  it('answers a second round in the same message', async () => {
    const paused = await pauseCreateIssue()

    await answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ], [toolCallChunks('call-2', CREATE_ISSUE, { title: 'call-2' })])

    const firstUpdate = mocks.updates.at(-1)!
    const secondPending = firstUpdate.parts.find((part: any) => {
      return part.state === 'approval-requested'
    })
    const turn = readKvJson(`tool-approval:turn:${paused.messagePublicId}`)

    expect(secondPending).toMatchObject({ toolCallId: 'call-2' })
    expect(turn).toMatchObject({
      pendingApprovalIds: [secondPending.approval.id],
      state: { counters: { rounds: 2, connectorCalls: 1 } },
    })

    storeUpdatedAssistant()

    const { doStream } = await answer(paused, [
      { approvalId: secondPending.approval.id, approved: true },
    ], [textChunks('Both issues exist now.')])
    const finalParts = mocks.updates.at(-1)!.parts

    expect(doStream).toHaveBeenCalledTimes(1)
    expect(linear.callCount('tools/call')).toBe(2)
    expect(finalParts.filter((part: any) => {
      return part.type === 'dynamic-tool' && part.state === 'output-available'
    }).map((part: any) => part.toolCallId)).toEqual(['call-1', 'call-2'])
    expect(finalParts.some((part: any) => {
      return part.type === 'text' && part.text === 'Both issues exist now.'
    })).toBe(true)
    expect(mocks.updates.at(-1)!.usage)
      .toMatchObject({ inputTokens: 30, outputTokens: 60 })
    expect(mocks.kv.has(`tool-approval:turn:${paused.messagePublicId}`))
      .toBe(false)
  })

  it('waits for a running claim and reports one past its lease', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const now = new Date()

    mocks.claims.set(approvalId, {
      approvalId,
      userId: 1,
      chatPublicId: CHAT_PUBLIC_ID,
      messagePublicId: paused.messagePublicId,
      status: 'claimed',
      createdAt: now,
      updatedAt: now,
    })

    const waiting = await answer(paused, [{ approvalId, approved: true }])

    expect(waiting.doStream).not.toHaveBeenCalled()
    expect(writtenChunks()).toContainEqual(expect.objectContaining({
      type: 'data-generation-pending',
    }))

    mocks.claims.get(approvalId)!.updatedAt = new Date(now.getTime() - 300_000)

    await expect(answer(paused, [{ approvalId, approved: true }]))
      .rejects.toMatchObject({ status: 409, code: 'TOOL_APPROVAL_INTERRUPTED' })
    expect(linear.callCount('tools/call')).toBe(0)
  })

  it('answers 409 when the pending record expired', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds

    mocks.kv.delete(`tool-approval:${approvalId}`)

    await expect(answer(paused, [{ approvalId, approved: true }]))
      .rejects.toMatchObject({ status: 409, code: 'TOOL_APPROVAL_EXPIRED' })
  })

  it('denies an approved call whose tool definition drifted', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const createIssue = linear.tools.find(tool => tool.name === 'create_issue')!

    createIssue.description = 'Create an issue and email everyone.'

    for (const key of [...mocks.kv.keys()]) {
      if (!key.startsWith('tool-approval')) {
        mocks.kv.delete(key)
      }
    }

    const { doStream } = await answer(paused, [{ approvalId, approved: true }])
    const denial = lastToolMessage(doStream).content[0]

    expect(linear.callCount('tools/call')).toBe(0)
    expect(denial.output).toEqual({
      type: 'execution-denied',
      reason: 'This tool is no longer available, so the action did not run.',
    })
    expect(writtenChunks().some(chunk => chunk.type === 'error')).toBe(false)
  })

  it('turns a missing tool into a denial instead of a stream error',
    async () => {
      const paused = await pauseCreateIssue()
      const [approvalId] = paused.approvalIds

      linear.tools.splice(linear.tools.findIndex((tool) => {
        return tool.name === 'create_issue'
      }), 1)

      for (const key of [...mocks.kv.keys()]) {
        if (!key.startsWith('tool-approval')) {
          mocks.kv.delete(key)
        }
      }

      const { doStream } = await answer(paused, [
        { approvalId, approved: true },
      ])
      const clientChunks = await readClientChunks()

      expect(doStream).toHaveBeenCalledTimes(1)
      expect(lastToolMessage(doStream).content[0].output).toEqual({
        type: 'execution-denied',
        reason: 'This tool is no longer available, so the action did not run.',
      })
      expect(clientChunks.some(chunk => chunk.type === 'error')).toBe(false)
      expect(linear.callCount('tools/call')).toBe(0)
    })

  it('runs the answer to the fifth round and denies a later one', async () => {
    const fifth = await pauseCreateIssue()
    const fifthTurnKey = `tool-approval:turn:${fifth.messagePublicId}`
    const fifthTurn = readKvJson(fifthTurnKey)!

    fifthTurn.state.counters.rounds = 5
    mocks.kv.set(fifthTurnKey, JSON.stringify(fifthTurn))

    await answer(fifth, [{ approvalId: fifth.approvalIds[0], approved: true }])

    expect(linear.callCount('tools/call')).toBe(1)

    mocks.chatMessages = []

    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const turnKey = `tool-approval:turn:${paused.messagePublicId}`
    const turn = readKvJson(turnKey)!

    turn.state.counters.rounds = 6
    mocks.kv.set(turnKey, JSON.stringify(turn))

    const { doStream } = await answer(paused, [{ approvalId, approved: true }])

    expect(linear.callCount('tools/call')).toBe(1)
    expect(lastToolMessage(doStream).content[0].output).toEqual({
      type: 'execution-denied',
      reason: 'This turn reached its limit of approved actions, so the action '
        + 'did not run.',
    })
  })

  it('limits approval answers to 30 a minute per user', async () => {
    const paused = await pauseCreateIssue()

    mocks.kv.set('tool-approval-rate:1', JSON.stringify({
      windowStart: Date.now(),
      count: 30,
    }))

    await expect(answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ])).rejects.toMatchObject({ status: 429 })
    expect(mocks.claims.size).toBe(0)
  })

  it('lets an approved memory write past the lock, never past never-store',
    async () => {
      mocks.memoryToolsEnabled = true

      const allowed = await pauseTurn({
        servers: [linear],
        tools: ['web_search'],
        steps: [toolCallChunks('call-m', 'memory_write', {
          body: 'Likes green tea',
        })],
      })

      expect(allowed.approvalIds).toHaveLength(1)

      await request({
        servers: [linear],
        steps: [textChunks('Saved.')],
        body: answerBody(allowed.messagePublicId, [
          { approvalId: allowed.approvalIds[0], approved: true },
        ]),
      })

      expect(mocks.memoryWrites).toEqual([
        { body: 'Likes green tea', isApproved: true },
      ])

      mocks.chatMessages = []
      mocks.updates = []

      const blocked = await pauseTurn({
        servers: [linear],
        tools: ['web_search'],
        steps: [toolCallChunks('call-card', 'memory_write', {
          body: 'Card 4111 1111 1111 1111',
        })],
      })

      await request({
        servers: [linear],
        steps: [textChunks('Not saved.')],
        body: answerBody(blocked.messagePublicId, [
          { approvalId: blocked.approvalIds[0], approved: true },
        ]),
      })

      expect(mocks.memoryWrites).toHaveLength(1)
      expect(mocks.updates.at(-1)!.parts.find((part: any) => {
        return part.toolCallId === 'call-card'
      })).toMatchObject({ state: 'output-error' })
    })

  it('answers 404 when the stored call names another tool', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const pendingKey = `tool-approval:${approvalId}`

    mocks.kv.set(pendingKey, JSON.stringify({
      ...readKvJson(pendingKey),
      toolName: 'mcp__linear__delete_everything',
    }))

    await expect(answer(paused, [{ approvalId, approved: true }]))
      .rejects.toMatchObject({ status: 404 })
    expect(mocks.claims.size).toBe(0)
  })

  it('refuses answers when the rate limit cannot be read', async () => {
    const paused = await pauseCreateIssue()

    mocks.failRateLimitRead = true

    await expect(answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ])).rejects.toMatchObject({ status: 503 })
    expect(mocks.claims.size).toBe(0)
  })

  it('asks an Always allow connector read after a requested web search, '
    + 'then withholds web search once the approved read ran', async () => {
    mocks.providerTools = {
      tools: { web_search: openai.tools.webSearch() },
    }

    await request({
      servers: [linear],
      steps: [textChunks('Ready.')],
      body: {
        model: MODEL_ID,
        tools: [],
        reasoning: 'off',
        connectorIds: ['conn-linear'],
        messages: [{
          id: 'user-baseline',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }],
      },
    })

    for (const setting of mocks.store.toolSettings) {
      if (setting.toolName === 'list_issues') {
        setting.approval = 'always'
        setting.approvedDefinitionHash = setting.definitionHash
      }
    }

    const paused = await pauseTurn({
      servers: [linear],
      tools: ['web_search'],
      steps: [toolCallChunks('call-read', 'mcp__linear__list_issues', {})],
    })
    const [approvalId] = paused.approvalIds
    const pending = readKvJson(`tool-approval:${approvalId}`)

    expect(linear.callCount('tools/call')).toBe(0)
    expect(pending).toMatchObject({
      reason: 'untrusted-output',
      rememberOptions: ['once', 'chat', 'always'],
    })

    const { doStream } = await answer(paused, [
      { approvalId, approved: true },
    ], [textChunks('Here are the issues.')])
    const options = doStream.mock.calls[0]?.[0] as any
    const toolNames = (options?.tools ?? []).map((tool: any) => tool.name)

    expect(linear.callCount('tools/call')).toBe(1)
    expect(toolNames).not.toContain('web_search')
  })

  describe('Besidka tools', () => {
    beforeEach(() => {
      mocks.flags = new Set(['connectors', 'tool-approvals', 'besidka-tools'])
      mocks.besidkaModes = new Map([['list_projects', 'ask']])
    })

    async function pauseListProjects() {
      return await pauseTurn({
        servers: [linear],
        steps: [toolCallChunks('call-b', 'besidka__list_projects', {})],
      })
    }

    it('runs an approved Besidka call once and frames its result',
      async () => {
        const paused = await pauseListProjects()
        const [approvalId] = paused.approvalIds

        expect(mocks.listMcpProjects).not.toHaveBeenCalled()
        expect(readKvJson(`tool-approval:${approvalId}`))
          .toMatchObject({ family: 'besidka' })

        await answer(paused, [{ approvalId, approved: true }])

        const toolPart = findPart(
          mocks.updates.at(-1)!.parts,
          'tool-besidka__list_projects',
        )

        expect(mocks.listMcpProjects).toHaveBeenCalledTimes(1)
        expect(toolPart).toMatchObject({
          state: 'output-available',
          output: expect.stringContaining(
            '<untrusted_tool_result connector="besidka"',
          ),
        })
        expect(mocks.claims.get(approvalId)?.status).toBe('done')
      })

    it('denies an approved Besidka call the user has since blocked',
      async () => {
        const paused = await pauseListProjects()
        const [approvalId] = paused.approvalIds

        mocks.besidkaModes = new Map([['list_projects', 'blocked']])

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ])

        expect(mocks.listMcpProjects).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: 'This tool is blocked in the user\'s settings, so the '
            + 'action did not run.',
        })
        expect(writtenChunks().some(chunk => chunk.type === 'error'))
          .toBe(false)
      })
  })

  it('answers 404 when the tool-approvals flag is off', async () => {
    const paused = await pauseCreateIssue()

    mocks.flags = new Set(['connectors'])

    await expect(answer(paused, [
      { approvalId: paused.approvalIds[0], approved: true },
    ])).rejects.toMatchObject({ status: 404 })
    expect(mocks.claims.size).toBe(0)
  })
})
