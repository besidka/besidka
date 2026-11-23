import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import { CONNECTOR_APPROVAL_DENIAL_TEXT } from '#shared/utils/connectors-parts'
import { TOOL_APPROVAL_DATA_PART_TYPE } from '#shared/utils/tool-approval-parts'
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
const NOTION_URL = 'https://mcp.notion.example.com/mcp'
const CHAT_PUBLIC_ID = 'chat-1'
const USER_MESSAGE_ID = 'user-public-1'

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  writers: [] as Array<{ write: ReturnType<typeof vi.fn> }>,
  flags: new Set<string>(),
  kv: new Map<string, string>(),
  chatMessages: [] as Array<Record<string, any>>,
  capabilityTools: {} as Record<string, unknown>,
  capabilityInputs: [] as Array<{ isGoogleDerived?: () => boolean }>,
  artifactExecute: null as null | ReturnType<typeof vi.fn>,
  connectorUrls: {} as Record<string, string>,
  holdsSkillText: false,
  skillsInstructionBlock: null as string | null,
  chatGoogleDataAt: null as Date | null,
  chatUpdates: [] as Array<Record<string, unknown>>,
  batches: [] as unknown[][],
  failBatch: false,
  failChatFlag: false,
  googleSend: null as null | {
    tools: Record<string, unknown>
    entries: Map<string, unknown>
  },
  googleBlockedNames: [] as string[],
  googleAllowedNames: [] as string[],
  googleClaims: new Set<string>(),
  googleRunOwners: [] as Array<Record<string, unknown>>,
  googleRunRefusal: null as string | null,
  googleServicesOff: [] as string[],
  candidateServicesOff: [] as Array<readonly string[] | undefined>,
  requestedServicesOff: [] as Array<readonly string[] | undefined>,
  store: {
    connectors: [] as Array<Record<string, any>>,
    credentials: null as Record<string, any> | null,
    toolSettings: [] as Array<Record<string, any>>,
    chatSettings: [] as Array<Record<string, any>>,
    audit: [] as Array<Record<string, any>>,
  },
}))

vi.mock('~~/server/utils/tool-approval/secret', () => ({
  useToolApprovalSecret: async () => 'test-tool-approval-secret',
}))

vi.mock('~~/server/utils/tool-approval/google-send-candidates', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/google-send-candidates')
  >()

  return {
    ...actual,
    buildGoogleSendToolCandidates: async (input: {
      servicesOff?: readonly string[]
    }) => {
      const built = (mocks.googleSend ?? actual.noGoogleSendTools()) as never
      const servicesOff = input.servicesOff ?? mocks.googleServicesOff

      mocks.candidateServicesOff.push(input.servicesOff)

      return mocks.googleBlockedNames.length
        || mocks.googleAllowedNames.length
        || servicesOff.length
        ? actual.dropBlockedGoogleTools(
          built,
          actual.withGoogleServicesOffBlocked(
            new Map([
              ...mocks.googleAllowedNames.map((toolName) => {
                return [toolName, 'allow' as const]
              }),
              ...mocks.googleBlockedNames.map((toolName) => {
                return [toolName, 'blocked' as const]
              }),
            ]),
            servicesOff as never,
            (built as { entries: Map<string, unknown> }).entries.keys(),
          ),
        )
        : built
    },
  }
})

vi.mock('~~/server/utils/tool-approval/google-run-gate', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/google-run-gate')
  >()

  return {
    ...actual,
    createGoogleRunGate: (input: {
      owner: { userId: number, chatPublicId: string, messagePublicId: string }
    }) => ({
      begin: async (toolCallId: string) => {
        const executionId = await actual.buildGoogleExecutionId(
          input.owner,
          toolCallId,
        )

        mocks.googleRunOwners.push(input.owner)

        if (mocks.googleRunRefusal) {
          throw new Error(mocks.googleRunRefusal)
        }

        if (mocks.googleClaims.has(executionId)) {
          throw new Error(actual.GOOGLE_RUN_ALREADY_CLAIMED_TEXT)
        }

        mocks.googleClaims.add(executionId)

        return { executionId, settle: async () => undefined }
      },
    }),
  }
})

vi.mock('~~/server/utils/besidka-tools/chat-settings', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/besidka-tools/chat-settings')
  >()

  return {
    ...actual,
    applyRequestedGoogleServicesOff: async (
      _db: unknown,
      _userId: number,
      _chatPublicId: string,
      requested: readonly string[] | undefined,
    ) => {
      mocks.requestedServicesOff.push(requested)

      return requested
    },
  }
})

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
  isMemoryToolsEnabled: () => false,
}))

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: async () => ({
    isFeatureActive: (flag: string) => mocks.flags.has(flag),
  }),
}))

vi.mock('~~/server/utils/skills/runtime/send', () => ({
  prepareSkillsForSend: async () => ({
    tools: {},
    toolsRegistered: false,
    instructionBlock: mocks.skillsInstructionBlock,
    activeSkillsBlock: null,
    invocationBlock: null,
    holdsSkillText: mocks.holdsSkillText,
    streamActivations: [],
    getToolActivations: () => [],
  }),
}))

vi.mock('~~/server/capabilities/index', () => ({
  getCapabilityTools: async (input: { isGoogleDerived?: () => boolean }) => {
    mocks.capabilityInputs.push(input)

    return mocks.capabilityTools
  },
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
    settleConnectorToolCall: async () => undefined,
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
  const updateWhere = vi.fn(async () => undefined)
  const failingUpdateWhere = vi.fn(async () => {
    throw new Error('D1 flag write failed')
  })
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    mocks.chatUpdates.push(values)

    const isFlagWrite = values.googleDataAt instanceof Date

    return {
      where: mocks.failChatFlag && isFlagWrite
        ? failingUpdateWhere
        : updateWhere,
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
            googleDataAt: mocks.chatGoogleDataAt,
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
      batch: vi.fn(async (statements: unknown[]) => {
        mocks.batches.push(statements)

        if (mocks.failBatch) {
          throw new Error('D1 batch failed')
        }

        return await Promise.all(statements.map(async (statement) => {
          const withGet = statement as { get?: () => Promise<unknown> }

          return typeof withGet.get === 'function'
            ? [await withGet.get()]
            : await statement
        }))
      }),
    },
    insertValues,
  }
}

function createKv() {
  return {
    get: vi.fn(async (key: string) => mocks.kv.get(key) ?? null),
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

function createArtifactTool() {
  const execute = vi.fn(async () => ({
    artifactId: 'art-1',
    version: 1,
    kind: 'html',
    title: 'Plan',
  }))

  mocks.artifactExecute = execute
  mocks.capabilityTools = {
    create_artifact: tool({
      description: 'Create an artifact.',
      inputSchema: z.object({
        kind: z.string(),
        title: z.string(),
        content: z.string(),
      }),
      execute,
    }),
  }
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  connectorIds?: string[]
  servers: MockMcpServer[]
  messageId?: string
  tools?: string[]
  providerTools?: Record<string, unknown>
  googleServicesOff?: string[]
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: input.providerTools ?? {},
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
    body: {
      model: MODEL_ID,
      tools: input.tools ?? [],
      reasoning: 'off',
      ...(input.connectorIds ? { connectorIds: input.connectorIds } : {}),
      ...(input.googleServicesOff
        ? { googleServicesOff: input.googleServicesOff }
        : {}),
      messages: [{
        id: input.messageId ?? USER_MESSAGE_ID,
        role: 'user',
        parts: [{ type: 'text', text: 'Do the thing' }],
      }],
    },
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]

  return { doStream, assistantInsert }
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

async function setAlwaysAllow(input: {
  servers: MockMcpServer[]
  connectorIds: string[]
  toolNames: string[]
}) {
  await runSend({
    servers: input.servers,
    connectorIds: input.connectorIds,
    steps: [textChunks('Ready.')],
    messageId: 'user-baseline',
  })

  for (const setting of mocks.store.toolSettings) {
    if (input.toolNames.includes(setting.toolName)) {
      setting.approval = 'always'
      setting.approvedDefinitionHash = setting.definitionHash
    }
  }

  mocks.store.audit = []
  mocks.mergedStreams = []
  mocks.writers = []
}

function findPart(parts: Array<Record<string, any>>, type: string) {
  return parts.find(part => part.type === type)
}

describe('tool approval requests in the chat send', () => {
  let linear: MockMcpServer
  let notion: MockMcpServer

  beforeAll(async () => {
    await import('../../../server/api/v1/chats/[slug]/index.post')
  }, 60_000)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.writers = []
    mocks.flags = new Set(['connectors', 'tool-approvals', 'google.drive'])
    mocks.holdsSkillText = false
    mocks.skillsInstructionBlock = null
    mocks.kv = new Map()
    mocks.chatMessages = []
    mocks.capabilityTools = {}
    mocks.capabilityInputs = []
    mocks.artifactExecute = null
    mocks.connectorUrls = {}
    mocks.chatGoogleDataAt = null
    mocks.chatUpdates = []
    mocks.batches = []
    mocks.failBatch = false
    mocks.failChatFlag = false
    mocks.googleSend = null
    mocks.googleBlockedNames = []
    mocks.googleAllowedNames = []
    mocks.googleClaims = new Set()
    mocks.googleRunOwners = []
    mocks.googleRunRefusal = null
    mocks.googleServicesOff = []
    mocks.candidateServicesOff = []
    mocks.requestedServicesOff = []
    Object.assign(mocks.store, {
      connectors: [],
      credentials: null,
      toolSettings: [],
      chatSettings: [],
      audit: [],
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
    notion = createMockMcpServer({
      url: NOTION_URL,
      tools: [
        {
          name: 'list_pages',
          description: 'List pages.',
          annotations: { readOnlyHint: true },
        },
        { name: 'create_page', description: 'Create a page.' },
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

  it('pauses a connector write with a signed request, never calls the '
    + 'server and stores the pending records', async () => {
    const { doStream, assistantInsert } = await runSend({
      servers: [linear],
      connectorIds: ['conn-linear'],
      steps: [
        toolCallChunks('call-1', 'mcp__linear__create_issue', { title: 'x' }),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const toolPart = findPart(parts, 'dynamic-tool')
    const dataPart = findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)

    expect(doStream).toHaveBeenCalledTimes(1)
    expect(linear.callCount('tools/call')).toBe(0)
    expect(toolPart).toMatchObject({
      toolName: 'mcp__linear__create_issue',
      toolCallId: 'call-1',
      state: 'approval-requested',
      input: { title: 'x' },
    })
    expect(toolPart.approval.id).toEqual(expect.any(String))
    expect(toolPart.approval.signature).toBeUndefined()
    expect(dataPart).toMatchObject({
      id: 'call-1',
      data: {
        approvalId: toolPart.approval.id,
        toolCallId: 'call-1',
        toolName: 'mcp__linear__create_issue',
        reason: 'default',
        summary: 'Linear wants to run mcp__linear__create_issue',
        rememberOptions: ['once', 'chat', 'always'],
      },
    })
    expect(parts.some((part: any) => {
      return part.type === 'text' && part.text.length > 0
    })).toBe(false)
    expect(writtenChunks().some(chunk => chunk.type === 'error')).toBe(false)

    const approvalId = toolPart.approval.id
    const pending = readKvJson(`tool-approval:${approvalId}`)
    const messagePublicId = pending?.messagePublicId

    expect(pending).toMatchObject({
      userId: 1,
      chatPublicId: CHAT_PUBLIC_ID,
      toolCallId: 'call-1',
      family: 'connector',
      access: 'write',
      toolName: 'mcp__linear__create_issue',
      connectorId: 'conn-linear',
      input: { title: 'x' },
      reason: 'default',
      rememberOptions: ['once', 'chat', 'always'],
      summary: 'Linear wants to run mcp__linear__create_issue',
      auditCallId: 1,
      snapshot: {
        model: MODEL_ID,
        gateway: null,
        reasoning: 'off',
        connectorIds: ['conn-linear'],
      },
    })
    expect(pending?.signature).toEqual(expect.any(String))
    expect(pending?.definitionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(pending?.snapshot).not.toHaveProperty('toolNames')
    expect(readKvJson(`tool-approval:turn:${messagePublicId}`)).toMatchObject({
      userId: 1,
      chatPublicId: CHAT_PUBLIC_ID,
      messagePublicId,
      pendingApprovalIds: [approvalId],
      state: {
        taint: [],
        readSources: [],
        counters: { rounds: 1, steps: 1, connectorCalls: 0 },
      },
    })
    expect(readKvJson(`tool-approval:chat:${CHAT_PUBLIC_ID}`)).toMatchObject({
      approvalIds: [approvalId],
      messageIds: [messagePublicId],
    })
    expect(mocks.store.audit).toEqual([
      expect.objectContaining({
        toolName: 'create_issue',
        outcome: 'pending',
        approval: 'pending',
        chatPublicId: CHAT_PUBLIC_ID,
      }),
    ])
    expect(JSON.stringify(mocks.store.audit)).not.toContain('"title"')

    const clientChunks = await readClientChunks()
    const requestChunk = clientChunks.find((chunk) => {
      return chunk.type === 'tool-approval-request'
    })

    expect(requestChunk).toMatchObject({ approvalId, toolCallId: 'call-1' })
    expect(requestChunk?.signature).toBeUndefined()
    expect(clientChunks).toContainEqual(expect.objectContaining({
      type: TOOL_APPROVAL_DATA_PART_TYPE,
      id: 'call-1',
    }))
  })

  it('runs a plain read-only connector tool by default, as before',
    async () => {
      const { assistantInsert } = await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          textChunks('One open issue.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(linear.callCount('tools/call')).toBe(1)
      expect(findPart(parts, 'dynamic-tool'))
        .toMatchObject({ state: 'output-available' })
      expect(findPart(parts, 'data-tool-grant')).toBeUndefined()
    })

  it('asks before a read-only connector tool set to Needs approval',
    async () => {
      await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [textChunks('Ready.')],
        messageId: 'user-baseline',
      })

      for (const setting of mocks.store.toolSettings) {
        if (setting.toolName === 'list_issues') {
          setting.approval = 'needs-approval'
        }
      }

      mocks.mergedStreams = []
      mocks.writers = []

      const { assistantInsert } = await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          textChunks('Never reached.'),
        ],
      })

      expect(linear.callCount('tools/call')).toBe(0)
      expect(findPart(
        assistantInsert?.parts ?? [],
        TOOL_APPROVAL_DATA_PART_TYPE,
      )).toMatchObject({
        data: {
          toolCallId: 'call-1',
          reason: 'default',
          rememberOptions: ['once', 'chat', 'always'],
        },
      })
    })

  it('runs a read-only connector tool set to Always allow without a request',
    async () => {
      await setAlwaysAllow({
        servers: [linear],
        connectorIds: ['conn-linear'],
        toolNames: ['list_issues'],
      })

      const { assistantInsert } = await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          textChunks('One open issue.'),
        ],
      })

      expect(linear.callCount('tools/call')).toBe(1)
      expect(findPart(assistantInsert?.parts ?? [], 'dynamic-tool'))
        .toMatchObject({ state: 'output-available' })
      expect([...mocks.kv.keys()].some((key) => {
        return key.startsWith('tool-approval:') && !key.includes(':chat:')
      })).toBe(false)
    })

  it('runs every Always allow read of one step and of later steps',
    async () => {
      await setAlwaysAllow({
        servers: [linear],
        connectorIds: ['conn-linear'],
        toolNames: ['list_issues'],
      })

      await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          [
            ...toolCallChunks('call-1', 'mcp__linear__list_issues', {})
              .filter(chunk => chunk.type !== 'finish'),
            ...toolCallChunks('call-2', 'mcp__linear__list_issues', {
              page: 2,
            }),
          ],
          toolCallChunks('call-3', 'mcp__linear__list_issues', { page: 3 }),
          textChunks('Three pages.'),
        ],
      })

      expect(linear.callCount('tools/call')).toBe(3)
    })

  it('runs an Always allow write to a second connector after the first '
    + 'one was read (owner decision, 2026-11-20)', async () => {
    seedConnector({
      id: 'conn-notion',
      slug: 'notion',
      title: 'Notion',
      url: NOTION_URL,
    })
    await setAlwaysAllow({
      servers: [linear, notion],
      connectorIds: ['conn-linear', 'conn-notion'],
      toolNames: ['list_issues', 'create_page'],
    })

    const { assistantInsert } = await runSend({
      servers: [linear, notion],
      connectorIds: ['conn-linear', 'conn-notion'],
      steps: [
        toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
        toolCallChunks('call-2', 'mcp__notion__create_page', {}),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(linear.callCount('tools/call')).toBe(1)
    expect(notion.callCount('tools/call')).toBe(1)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs an Auto connector read that follows another connector\'s '
    + 'output on its default Always allow (owner decision, 2026-11-20)',
  async () => {
    seedConnector({
      id: 'conn-notion',
      slug: 'notion',
      title: 'Notion',
      url: NOTION_URL,
    })

    const autoLinear = mocks.store.connectors.find((connector) => {
      return connector.id === 'conn-linear'
    })!

    autoLinear.toolMode = 'auto'

    const { assistantInsert } = await runSend({
      servers: [linear, notion],
      steps: [
        toolCallChunks('call-1', 'mcp__notion__list_pages', {}),
        toolCallChunks('call-2', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-3', 'mcp__linear__list_issues', {}),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(notion.callCount('tools/call')).toBe(1)
    expect(linear.callCount('tools/call')).toBe(1)
    expect(findPart(parts, 'tool-use_connector')).toMatchObject({
      state: 'output-available',
    })
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs the first use of an Auto connector read in a message that '
    + 'requested web search (owner decision, 2026-11-20)', async () => {
    const autoLinear = mocks.store.connectors.find((connector) => {
      return connector.id === 'conn-linear'
    })!

    autoLinear.toolMode = 'auto'

    const { assistantInsert } = await runSend({
      servers: [linear],
      tools: ['web_search'],
      steps: [
        toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-2', 'mcp__linear__list_issues', {}),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(linear.callCount('tools/call')).toBe(1)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs another connector\'s read once an Auto connector was opened, on '
    + 'its default Always allow (owner decision, 2026-11-20)', async () => {
    seedConnector({
      id: 'conn-notion',
      slug: 'notion',
      title: 'Notion',
      url: NOTION_URL,
    })

    for (const connector of mocks.store.connectors) {
      connector.toolMode = connector.id === 'conn-linear'
        ? 'auto'
        : 'always-on'
    }

    const { assistantInsert } = await runSend({
      servers: [linear, notion],
      steps: [
        toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-2', 'mcp__notion__list_pages', {}),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(notion.callCount('tools/call')).toBe(1)
    expect(linear.callCount('tools/call')).toBe(0)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs an Auto connector read opened and then loaded by name without '
    + 'a card, because its own taint is the only one', async () => {
    const autoLinear = mocks.store.connectors.find((connector) => {
      return connector.id === 'conn-linear'
    })!

    autoLinear.toolMode = 'auto'

    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-2', 'tool_index__load', {
          names: ['mcp__linear__list_issues'],
        }),
        toolCallChunks('call-3', 'mcp__linear__list_issues', {}),
        textChunks('One open issue.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(linear.callCount('tools/call')).toBe(1)
    expect(findPart(parts, 'dynamic-tool'))
      .toMatchObject({ state: 'output-available' })
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs an Auto connector read in a send whose skills catalog lists an '
    + 'imported skill, because a catalog alone does not taint', async () => {
    const autoLinear = mocks.store.connectors.find((connector) => {
      return connector.id === 'conn-linear'
    })!

    autoLinear.toolMode = 'auto'
    mocks.skillsInstructionBlock = '<skills_catalog>\n'
      + '- release-notes: Writes release notes (imported)\n</skills_catalog>'

    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-2', 'mcp__linear__list_issues', {}),
        textChunks('One open issue.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(linear.callCount('tools/call')).toBe(1)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs an Auto connector read on its default Always allow in a send '
    + 'that holds an activated imported skill\'s body', async () => {
    const autoLinear = mocks.store.connectors.find((connector) => {
      return connector.id === 'conn-linear'
    })!

    autoLinear.toolMode = 'auto'
    mocks.holdsSkillText = true

    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
        toolCallChunks('call-2', 'mcp__linear__list_issues', {}),
        textChunks('Never reached.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(linear.callCount('tools/call')).toBe(1)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
  })

  it('runs an Auto connector read opened first, with nothing read before',
    async () => {
      const autoLinear = mocks.store.connectors.find((connector) => {
        return connector.id === 'conn-linear'
      })!

      autoLinear.toolMode = 'auto'

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-1', 'use_connector', { connector: 'linear' }),
          toolCallChunks('call-2', 'mcp__linear__list_issues', {}),
          textChunks('One open issue.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(linear.callCount('tools/call')).toBe(1)
      expect(findPart(parts, 'dynamic-tool'))
        .toMatchObject({ state: 'output-available' })
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
    })

  it('asks before an artifact write that follows connector output',
    async () => {
      mocks.flags.add('artifacts')
      createArtifactTool()
      await setAlwaysAllow({
        servers: [linear],
        connectorIds: ['conn-linear'],
        toolNames: ['list_issues'],
      })

      const { assistantInsert } = await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          toolCallChunks('call-2', 'create_artifact', {
            kind: 'html',
            title: 'Plan',
            content: '<p>exfiltrate</p>',
          }),
          textChunks('Never reached.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(mocks.artifactExecute).not.toHaveBeenCalled()
      expect(findPart(parts, 'tool-create_artifact')).toMatchObject({
        state: 'approval-requested',
        input: { kind: 'html', title: 'Plan' },
      })
      expect(JSON.stringify(parts)).not.toContain('exfiltrate')
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
        data: {
          toolName: 'create_artifact',
          reason: 'untrusted-output',
          summary: 'Besidka wants to create an artifact',
        },
      })

      const pendingId = findPart(parts, 'tool-create_artifact').approval.id

      expect(readKvJson(`tool-approval:${pendingId}`)).toMatchObject({
        family: 'native',
        access: 'write',
        input: { content: '<p>exfiltrate</p>' },
        auditCallId: null,
      })
    })

  it('runs a native write when nothing untrusted came before it',
    async () => {
      mocks.flags.add('artifacts')
      createArtifactTool()

      await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-1', 'create_artifact', {
            kind: 'html',
            title: 'Plan',
            content: '<p>hi</p>',
          }),
          textChunks('Done.'),
        ],
      })

      expect(mocks.artifactExecute).toHaveBeenCalledTimes(1)
      expect([...mocks.kv.keys()].some((key) => {
        return key.startsWith('tool-approval:')
      })).toBe(false)
    })

  it('replays a stored approval-only reply on a retry of the same message',
    async () => {
      mocks.chatMessages = [
        {
          id: 'row-user',
          publicId: USER_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Do the thing' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
        {
          id: 'row-assistant',
          publicId: 'assistant-public-1',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            {
              type: 'dynamic-tool',
              toolName: 'mcp__linear__create_issue',
              toolCallId: 'call-1',
              state: 'approval-requested',
              input: { title: 'x' },
              approval: { id: 'approval-0001' },
            },
            {
              type: TOOL_APPROVAL_DATA_PART_TYPE,
              id: 'call-1',
              data: {
                approvalId: 'approval-0001',
                toolCallId: 'call-1',
                toolName: 'mcp__linear__create_issue',
                reason: 'always-ask',
                summary: 'Linear wants to run mcp__linear__create_issue',
                rememberOptions: ['once'],
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
      ]

      const { doStream } = await runSend({
        servers: [linear],
        steps: [textChunks('Never reached.')],
      })
      const chunks = writtenChunks()

      expect(doStream).not.toHaveBeenCalled()
      expect(chunks).toContainEqual({
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'mcp__linear__create_issue',
        input: { title: 'x' },
        dynamic: true,
      })
      expect(chunks).toContainEqual({
        type: 'tool-approval-request',
        approvalId: 'approval-0001',
        toolCallId: 'call-1',
      })
      expect(chunks).toContainEqual(expect.objectContaining({
        type: TOOL_APPROVAL_DATA_PART_TYPE,
        id: 'call-1',
      }))
    })

  it('expires the pending records of the chat when a new user message '
    + 'arrives', async () => {
    const index = {
      version: 1,
      approvalIds: ['approval-0001'],
      messageIds: ['assistant-public-1'],
    }

    mocks.kv.set('tool-approval:approval-0001', '{"stale":true}')
    mocks.kv.set('tool-approval:turn:assistant-public-1', '{"stale":true}')
    mocks.kv.set(`tool-approval:chat:${CHAT_PUBLIC_ID}`, JSON.stringify(index))
    mocks.chatMessages = [
      {
        id: 'row-user',
        publicId: 'user-public-0',
        role: 'user',
        parts: [{ type: 'text', text: 'Create it' }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
      {
        id: 'row-assistant',
        publicId: 'assistant-public-1',
        role: 'assistant',
        parts: [{
          type: 'dynamic-tool',
          toolName: 'mcp__linear__create_issue',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { title: 'x' },
          approval: { id: 'approval-0001' },
        }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
    ]

    const { doStream } = await runSend({
      servers: [linear],
      messageId: 'user-public-2',
      steps: [textChunks('Fresh answer.')],
    })

    expect(doStream).toHaveBeenCalledTimes(1)
    expect(mocks.kv.has('tool-approval:approval-0001')).toBe(false)
    expect(mocks.kv.has('tool-approval:turn:assistant-public-1')).toBe(false)
    expect(mocks.kv.has(`tool-approval:chat:${CHAT_PUBLIC_ID}`)).toBe(false)
  })

  it('asks before an artifact write in a send with active skill text',
    async () => {
      mocks.flags.add('artifacts')
      mocks.holdsSkillText = true
      createArtifactTool()

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-1', 'create_artifact', {
            kind: 'html',
            title: 'Plan',
            content: '<p>hi</p>',
          }),
          textChunks('Never reached.'),
        ],
      })

      expect(mocks.artifactExecute).not.toHaveBeenCalled()
      expect(findPart(assistantInsert?.parts ?? [], 'tool-create_artifact'))
        .toMatchObject({ state: 'approval-requested' })
    })

  it('asks for the Google egress grant before a default-allowed connector '
    + 'read in a chat that holds Google content', async () => {
    mocks.chatMessages = [
      {
        id: 'row-user-google',
        publicId: 'user-public-0',
        role: 'user',
        parts: [{ type: 'text', text: 'Find my budget file' }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
      {
        id: 'row-assistant-google',
        publicId: 'assistant-public-0',
        role: 'assistant',
        parts: [{
          type: 'tool-google__drive_search',
          toolCallId: 'call-google-0',
          state: 'output-available',
          input: { query: 'budget' },
          output: { references: [{ id: 'file-1' }], bodyRemoved: true },
        }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
    ]

    const { assistantInsert } = await runSend({
      servers: [linear],
      connectorIds: ['conn-linear'],
      steps: [
        toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
        textChunks('Never reached.'),
      ],
    })

    expect(linear.callCount('tools/call')).toBe(0)
    expect(findPart(
      assistantInsert?.parts ?? [],
      TOOL_APPROVAL_DATA_PART_TYPE,
    )).toMatchObject({
      data: {
        toolCallId: 'call-1',
        reason: 'google-egress',
        rememberOptions: ['once', 'chat'],
      },
    })
  })

  it('never offers a google__ tool that did not come from the Google tool '
    + 'assembly', async () => {
    const execute = vi.fn(async () => ({ references: [] }))

    mocks.flags.add('artifacts')
    createArtifactTool()
    mocks.capabilityTools = {
      ...mocks.capabilityTools,
      Google__Gmail_Create_Draft: tool({
        description: 'Create a Gmail draft.',
        inputSchema: z.object({ subject: z.string() }),
        execute,
      }),
    }

    const { doStream } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-1', 'Google__Gmail_Create_Draft', {
          subject: 'Hello',
        }),
        textChunks('Never reached.'),
      ],
    })
    const offered = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
      .map((offeredTool: { name: string }) => offeredTool.name)

    expect(execute).not.toHaveBeenCalled()
    expect(offered).toContain('create_artifact')
    expect(offered).not.toContain('Google__Gmail_Create_Draft')
  })

  it('offers no Google tool when tool approvals are off', async () => {
    const { buildGoogleApprovalEntry } = await import(
      '~~/server/utils/tool-approval/send'
    )
    const execute = vi.fn(async () => ({ references: [{ id: 'f1' }] }))

    mocks.flags.delete('tool-approvals')
    mocks.googleSend = {
      tools: {
        google__drive_search: tool({
          description: 'Search Drive.',
          inputSchema: z.object({ query: z.string() }),
          execute,
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

    const { doStream } = await runSend({
      servers: [linear],
      steps: [textChunks('Plain answer.')],
    })
    const offered = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
      .map((offeredTool: { name: string }) => offeredTool.name)

    expect(offered).not.toContain('google__drive_search')
  })

  describe('a Google tool the user set to Blocked', () => {
    async function offerGmailTools() {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )
      const names = ['google__gmail_search', 'google__gmail_read_thread']

      mocks.googleSend = {
        tools: Object.fromEntries(names.map((name) => {
          return [name, tool({
            description: 'A Gmail tool.',
            inputSchema: z.object({ query: z.string().optional() }),
            execute: vi.fn(async () => ({ references: [] })),
          })]
        })),
        entries: new Map(names.map((name) => {
          return [name, buildGoogleApprovalEntry({
            toolName: name,
            kind: 'read',
            definitionHash: 'g'.repeat(64),
            summary: 'A Gmail tool',
            toolApprovalsActive: true,
          })]
        })),
      }
    }

    async function offeredNames() {
      const { doStream } = await runSend({
        servers: [linear],
        steps: [textChunks('Plain answer.')],
      })

      return ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)
    }

    it('offers every Gmail tool when nothing is Blocked', async () => {
      await offerGmailTools()

      expect(await offeredNames()).toEqual(expect.arrayContaining([
        'google__gmail_search',
        'google__gmail_read_thread',
      ]))
    })

    it('does not offer a Blocked Gmail search and keeps the other tool',
      async () => {
        await offerGmailTools()

        mocks.googleBlockedNames = ['google__gmail_search']

        const offered = await offeredNames()

        expect(offered).not.toContain('google__gmail_search')
        expect(offered).toContain('google__gmail_read_thread')
      })

    it('offers no Google tool when every one is Blocked', async () => {
      await offerGmailTools()

      mocks.googleBlockedNames = [
        'google__gmail_search',
        'google__gmail_read_thread',
      ]

      expect((await offeredNames())
        .filter((name: string) => name.startsWith('google__'))).toEqual([])
    })
  })

  describe('a Google tool the user set to Always allow', () => {
    const READ = 'google__gmail_search'
    const THREAD = 'google__gmail_read_thread'
    const WRITE = 'google__drive_create_folder'
    const executes = {} as Record<string, ReturnType<typeof vi.fn>>

    async function offerTools(names: string[] = [READ, THREAD, WRITE]) {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )

      for (const name of names) {
        executes[name] = vi.fn(async () => ({
          references: [{ id: `${name}-ref`, title: 'Item' }],
        }))
      }

      mocks.googleSend = {
        tools: Object.fromEntries(names.map((name) => {
          return [name, tool({
            description: 'A Google tool.',
            inputSchema: z.object({ query: z.string().optional() }),
            execute: executes[name]!,
          })]
        })),
        entries: new Map(names.map((name) => {
          return [name, buildGoogleApprovalEntry({
            toolName: name,
            kind: name === WRITE ? 'write' : 'read',
            definitionHash: 'g'.repeat(64),
            summary: 'A Google tool',
            toolApprovalsActive: true,
          })]
        })),
      }
    }

    it('runs a read without asking and marks it as always allowed',
      async () => {
        await offerTools()

        mocks.googleAllowedNames = [READ]

        const { assistantInsert } = await runSend({
          servers: [linear],
          steps: [
            toolCallChunks('call-r', READ, { query: 'invoices' }),
            textChunks('Found them.'),
          ],
        })
        const parts = assistantInsert?.parts ?? []

        expect(executes[READ]).toHaveBeenCalledTimes(1)
        expect(executes[READ]!.mock.calls[0]![1]).not.toHaveProperty(
          'executionId',
        )
        expect(findPart(parts, `tool-${READ}`)).toMatchObject({
          state: 'output-available',
        })
        expect(findPart(parts, 'data-tool-grant')).toMatchObject({
          data: { toolCallId: 'call-r', toolName: READ, scope: 'always' },
        })
        expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
        expect(mocks.googleRunOwners).toHaveLength(0)
        expect(mocks.chatUpdates).toContainEqual({
          googleDataAt: expect.anything(),
        })
      })

    it('runs a write without asking, passes it a server-derived execution '
      + 'id and marks it as always allowed', async () => {
      await offerTools()

      mocks.googleAllowedNames = [WRITE]

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-w', WRITE, { query: 'Reports' }),
          textChunks('Created.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []
      const options = executes[WRITE]!.mock.calls[0]![1] as {
        toolCallId: string
        executionId: string
        approvalId?: string
      }

      expect(executes[WRITE]).toHaveBeenCalledTimes(1)
      expect(options.toolCallId).toBe('call-w')
      expect(options.executionId).toMatch(/^exec_[A-Za-z0-9_-]{43}$/)
      expect(options.approvalId).toBeUndefined()
      expect(mocks.googleRunOwners).toEqual([expect.objectContaining({
        chatPublicId: CHAT_PUBLIC_ID,
        messagePublicId: assistantInsert?.publicId
          ?? expect.stringMatching(/^[0-9A-Z]{26}$/),
      })])
      expect(findPart(parts, 'data-tool-grant')).toMatchObject({
        data: { toolCallId: 'call-w', toolName: WRITE, scope: 'always' },
      })
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
    })

    it('never gives the model a way to set the execution id', async () => {
      await offerTools()

      mocks.googleAllowedNames = [WRITE]

      await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-w', WRITE, { executionId: 'exec_from_model' }),
          textChunks('Done.'),
        ],
      })

      const options = executes[WRITE]!.mock.calls[0]?.[1] as
        | { executionId?: string }
        | undefined

      expect(options?.executionId).not.toBe('exec_from_model')
    })

    it('creates once when the model repeats one tool call id', async () => {
      await offerTools()

      mocks.googleAllowedNames = [WRITE]

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-w', WRITE, { query: 'Reports' }),
          toolCallChunks('call-w', WRITE, { query: 'Reports' }),
          textChunks('Done.'),
        ],
      })

      expect(executes[WRITE]).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(assistantInsert?.parts ?? [])).not.toContain(
        'tool-input-error',
      )
    })

    it('refuses the write and shows no marker when the run gate refuses',
      async () => {
        await offerTools()

        mocks.googleAllowedNames = [WRITE]
        mocks.googleRunRefusal = 'Always allow has reached its limit.'

        const { assistantInsert, doStream } = await runSend({
          servers: [linear],
          steps: [
            toolCallChunks('call-w', WRITE, { query: 'Reports' }),
            textChunks('Stopped.'),
          ],
        })
        const parts = assistantInsert?.parts ?? []
        const secondPrompt = JSON.stringify(
          (doStream.mock.calls[1]?.[0] as { prompt?: unknown })?.prompt,
        )

        expect(executes[WRITE]).not.toHaveBeenCalled()
        expect(findPart(parts, `tool-${WRITE}`)).toMatchObject({
          state: 'output-error',
        })
        expect(secondPrompt).toContain('reached its limit')
        expect(findPart(parts, 'data-tool-grant')).toBeUndefined()
      })

    it('still asks for a once-only read set to Needs approval and runs it '
      + 'when set to Always allow', async () => {
      await offerTools()

      const asked = await runSend({
        servers: [linear],
        steps: [toolCallChunks('call-t1', THREAD, {}), textChunks('Never.')],
      })

      expect(executes[THREAD]).not.toHaveBeenCalled()
      expect(findPart(asked.assistantInsert?.parts ?? [],
        TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
        data: { toolCallId: 'call-t1', rememberOptions: ['once'] },
      })

      mocks.googleAllowedNames = [THREAD]

      const allowed = await runSend({
        servers: [linear],
        messageId: 'user-public-2',
        steps: [toolCallChunks('call-t2', THREAD, {}), textChunks('Read.')],
      })

      expect(executes[THREAD]).toHaveBeenCalledTimes(1)
      expect(findPart(allowed.assistantInsert?.parts ?? [],
        'data-tool-grant')).toMatchObject({
        data: { toolCallId: 'call-t2', scope: 'always' },
      })
    })

    it('asks again past the cap of reads in one message', async () => {
      await offerTools()

      mocks.googleAllowedNames = [READ]

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          ...Array.from({ length: 6 }, (_value, index) => {
            return toolCallChunks(`call-${index}`, READ, { query: `q${index}` })
          }),
          textChunks('Done.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(executes[READ]).toHaveBeenCalledTimes(5)
      expect(parts.filter(part => part.type === 'data-tool-grant'))
        .toHaveLength(5)
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
        data: { toolCallId: 'call-5', rememberOptions: ['once', 'chat'] },
      })
    })

    it('does not let a stored Always allow cover a tool of Besidka\'s '
      + 'client', async () => {
      await offerTools(['google__drive_read_file'])

      mocks.googleAllowedNames = ['google__drive_read_file']

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-f', 'google__drive_read_file', {}),
          textChunks('Never.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(executes.google__drive_read_file).not.toHaveBeenCalled()
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE))
        .toMatchObject({ data: { toolCallId: 'call-f' } })
      expect(findPart(parts, 'data-tool-grant')).toBeUndefined()
    })

    it('lets a switch that is off in the chat win over Always allow',
      async () => {
        await offerTools()

        mocks.googleAllowedNames = [READ]
        mocks.googleServicesOff = ['gmail']

        const { doStream } = await runSend({
          servers: [linear],
          steps: [textChunks('Plain answer.')],
        })
        const offered = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
          .map((offeredTool: { name: string }) => offeredTool.name)

        expect(offered).not.toContain(READ)
        expect(offered).toContain(WRITE)
      })

    it('lets Blocked win over Always allow', async () => {
      await offerTools()

      mocks.googleAllowedNames = [READ]
      mocks.googleBlockedNames = [READ]

      const { doStream } = await runSend({
        servers: [linear],
        steps: [textChunks('Plain answer.')],
      })
      const offered = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)

      expect(offered).not.toContain(READ)
    })
  })

  describe('a Google service switched off in the chat', () => {
    const SERVICE_TOOLS = {
      gmail: ['google__gmail_search', 'google__gmail_read_thread'],
      calendar: ['google__calendar_list_events'],
    }

    async function offerGmailAndCalendarTools() {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )
      const names = [
        ...SERVICE_TOOLS.gmail,
        ...SERVICE_TOOLS.calendar,
      ]

      mocks.googleSend = {
        tools: Object.fromEntries(names.map((name) => {
          return [name, tool({
            description: 'A Google tool.',
            inputSchema: z.object({ query: z.string().optional() }),
            execute: vi.fn(async () => ({ references: [] })),
          })]
        })),
        entries: new Map(names.map((name) => {
          return [name, buildGoogleApprovalEntry({
            toolName: name,
            kind: 'read',
            definitionHash: 'g'.repeat(64),
            summary: 'A Google tool',
            toolApprovalsActive: true,
          })]
        })),
      }
    }

    async function offeredNames(
      overrides: { googleServicesOff?: string[] } = {},
    ) {
      const { doStream } = await runSend({
        servers: [linear],
        steps: [textChunks('Plain answer.')],
        ...overrides,
      })

      return ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)
    }

    it('offers every service\'s tools when none is off', async () => {
      await offerGmailAndCalendarTools()

      expect(await offeredNames()).toEqual(expect.arrayContaining([
        ...SERVICE_TOOLS.gmail,
        ...SERVICE_TOOLS.calendar,
      ]))
    })

    it('offers no Calendar tool when Calendar is off and keeps Gmail',
      async () => {
        await offerGmailAndCalendarTools()

        mocks.googleServicesOff = ['calendar']

        const offered = await offeredNames()

        expect(offered).not.toContain('google__calendar_list_events')
        expect(offered).toEqual(expect.arrayContaining(SERVICE_TOOLS.gmail))
      })

    it('offers no Google tool when every service is off', async () => {
      await offerGmailAndCalendarTools()

      mocks.googleServicesOff = ['drive', 'gmail', 'calendar']

      expect((await offeredNames())
        .filter((name: string) => name.startsWith('google__'))).toEqual([])
    })

    it('stores the choice a new chat\'s first send carries and runs with it',
      async () => {
        await offerGmailAndCalendarTools()

        const offered = await offeredNames({ googleServicesOff: ['gmail'] })

        expect(mocks.requestedServicesOff).toEqual([['gmail']])
        expect(mocks.candidateServicesOff).toEqual([['gmail']])
        expect(offered).not.toContain('google__gmail_search')
        expect(offered).toContain('google__calendar_list_events')
      })

    it('asks nothing of the settings when the send carries no choice',
      async () => {
        await offerGmailAndCalendarTools()
        await offeredNames()

        expect(mocks.requestedServicesOff).toEqual([])
        expect(mocks.candidateServicesOff).toEqual([undefined])
      })

    it.each([
      ['a duplicate', ['gmail', 'gmail']],
      ['an unknown service', ['photos']],
      ['too many entries', ['drive', 'gmail', 'calendar', 'drive']],
    ])('rejects %s in the choice', async (_label, googleServicesOff) => {
      await offerGmailAndCalendarTools()

      await expect(offeredNames({ googleServicesOff })).rejects.toBeDefined()
      expect(mocks.requestedServicesOff).toEqual([])
    })

    it('ignores the choice when the Google flags are off', async () => {
      await offerGmailAndCalendarTools()

      mocks.flags.delete('google.drive')

      await offeredNames({ googleServicesOff: ['gmail'] })

      expect(mocks.requestedServicesOff).toEqual([])
    })
  })

  describe('the Drive folder tools', () => {
    const FOLDER_TOOLS = [
      'google__drive_list_folder',
      'google__drive_create_folder',
      'google__drive_rename',
      'google__drive_move',
    ]

    async function offerFolderTools() {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )

      mocks.googleSend = {
        tools: Object.fromEntries(FOLDER_TOOLS.map((name) => {
          return [name, tool({
            description: 'A Drive folder tool.',
            inputSchema: z.object({ name: z.string().optional() }),
            execute: vi.fn(async () => ({ references: [] })),
          })]
        })),
        entries: new Map(FOLDER_TOOLS.map((name) => {
          return [name, buildGoogleApprovalEntry({
            toolName: name,
            kind: name.endsWith('list_folder') ? 'read' : 'write',
            definitionHash: 'g'.repeat(64),
            summary: 'A Drive folder tool',
            toolApprovalsActive: true,
          })]
        })),
      }
    }

    async function offeredNames() {
      const { doStream } = await runSend({
        servers: [linear],
        steps: [textChunks('Plain answer.')],
      })

      return ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)
    }

    it('offers both when nothing is Blocked or switched off', async () => {
      await offerFolderTools()

      expect(await offeredNames()).toEqual(expect.arrayContaining(FOLDER_TOOLS))
    })

    it('offers neither when Drive is switched off in the chat', async () => {
      await offerFolderTools()

      mocks.googleServicesOff = ['drive']

      const offered = await offeredNames()

      for (const name of FOLDER_TOOLS) {
        expect(offered).not.toContain(name)
      }
    })

    it('keeps both when only another service is switched off', async () => {
      await offerFolderTools()

      mocks.googleServicesOff = ['gmail', 'calendar']

      expect(await offeredNames()).toEqual(expect.arrayContaining(FOLDER_TOOLS))
    })

    it('does not offer a Blocked create and keeps the list', async () => {
      await offerFolderTools()

      mocks.googleBlockedNames = ['google__drive_create_folder']

      const offered = await offeredNames()

      expect(offered).not.toContain('google__drive_create_folder')
      expect(offered).toContain('google__drive_list_folder')
    })

    it.each([
      'google__drive_rename',
      'google__drive_move',
    ])('does not offer a Blocked %s and keeps the others', async (blocked) => {
      await offerFolderTools()

      mocks.googleBlockedNames = [blocked]

      const offered = await offeredNames()

      expect(offered).not.toContain(blocked)

      for (const name of FOLDER_TOOLS.filter(other => other !== blocked)) {
        expect(offered).toContain(name)
      }
    })
  })

  it('runs a granted Google read, stores references only and sets the chat '
    + 'flag', async () => {
    const { buildGoogleApprovalEntry } = await import(
      '~~/server/utils/tool-approval/send'
    )
    const execute = vi.fn(async () => ({
      references: [{ id: 'file-1', title: 'Budget' }],
      text: 'SECRET GOOGLE BODY',
    }))

    mocks.googleSend = {
      tools: {
        google__drive_search: tool({
          description: 'Search Drive.',
          inputSchema: z.object({ query: z.string() }),
          execute,
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

    mocks.flags.add('artifacts')

    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-g', 'google__drive_search', { query: 'budget' }),
        textChunks('Found the budget file.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(mocks.capabilityInputs).toHaveLength(1)
    expect(mocks.capabilityInputs[0]!.isGoogleDerived?.()).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(findPart(parts, 'tool-google__drive_search')).toMatchObject({
      state: 'output-available',
      output: {
        references: [{ id: 'file-1', title: 'Budget' }],
        bodyRemoved: true,
      },
    })
    expect(JSON.stringify(parts)).not.toContain('SECRET GOOGLE BODY')
    expect(mocks.chatUpdates).toContainEqual({
      googleDataAt: expect.anything(),
    })
    expect(mocks.chatUpdates).toContainEqual({
      googleOptInAt: null,
      indexable: false,
    })
    expect(mocks.batches).toHaveLength(1)
    expect(mocks.batches[0]).toHaveLength(3)
    expect(writtenChunks().filter((chunk) => {
      return chunk.type === 'data-google-data'
    })).toEqual([{
      type: 'data-google-data',
      data: { holdsGoogleData: true },
      transient: true,
    }])
  })

  describe('provider-run tools that cannot be removed between steps', () => {
    const ANTHROPIC_MODEL_ID = 'claude-haiku-4-5'
    const providerWebSearch = anthropic.tools.webSearch_20250305()

    async function useRealDriveTools() {
      const { buildGoogleDriveTools } = await import(
        '~~/server/utils/google/drive-tools'
      )

      mocks.googleSend = await buildGoogleDriveTools({
        db: {} as never,
        kv: {} as never,
        event: { context: {} } as never,
        userId: 1,
        chatGrantHashes: {},
        logger: { set: vi.fn() },
      })
    }

    async function offeredOnAnthropic(input: {
      tools: string[]
      providerTools: Record<string, unknown>
      toolCall?: boolean
      qwen?: boolean
    }): Promise<string[]> {
      mocks.mergedStreams = []
      mocks.writers = []

      const { model, doStream } = createScriptedModel([
        textChunks('Answer.'),
      ])
      const modelId = input.qwen ? 'qwen3-max' : ANTHROPIC_MODEL_ID

      vi.stubGlobal('useChatProvider', vi.fn(() => ({
        provider: { id: input.qwen ? 'qwen' : 'anthropic' },
        model: {
          id: modelId,
          name: 'Test model',
          tools: ['web_search'],
          toolCall: input.toolCall ?? true,
          modalities: { input: ['text'], output: ['text'] },
        },
      })))
      vi.stubGlobal('useAnthropic', vi.fn(async () => ({
        instance: model,
        tools: input.providerTools,
        providerOptions: {},
        reasoning: undefined,
        thinkingBinding: undefined,
      })))
      vi.stubGlobal('useQwen', vi.fn(async () => ({
        instance: model,
        tools: input.providerTools,
        providerOptions: input.tools.includes('web_search')
          ? { enable_search: true }
          : {},
        reasoning: undefined,
      })))
      vi.stubGlobal('fetch', createMockMcpFetch([linear]))

      const handler = (await import(
        '../../../server/api/v1/chats/[slug]/index.post'
      )).default
      const created = createDb()

      vi.stubGlobal('useDb', () => created.db)

      const result = await handler({
        params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        body: {
          model: modelId,
          tools: input.tools,
          reasoning: 'off',
          messages: [{
            id: USER_MESSAGE_ID,
            role: 'user',
            parts: [{ type: 'text', text: 'Search and read my Drive file' }],
          }],
        },
      } as any)

      await result.ready

      return ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)
    }

    it('offers no Google tool on direct Anthropic while web search is '
      + 'declared and the chat holds no Google data, so no search can '
      + 'follow a Drive read', async () => {
      await useRealDriveTools()

      const offered = await offeredOnAnthropic({
        tools: ['web_search'],
        providerTools: { tools: { web_search: providerWebSearch } },
      })

      expect(offered).toContain('web_search')
      expect(offered.filter(name => name.startsWith('google__')))
        .toEqual([])
    })

    it('offers no Google tool on Qwen while enable_search is on and the '
      + 'chat holds no Google data, and offers them when it is off',
    async () => {
      await useRealDriveTools()

      const withSearch = await offeredOnAnthropic({
        qwen: true,
        tools: ['web_search'],
        providerTools: {},
      })

      expect(withSearch.filter(name => name.startsWith('google__')))
        .toEqual([])

      const withoutSearch = await offeredOnAnthropic({
        qwen: true,
        tools: [],
        providerTools: {},
      })

      expect(withoutSearch).toEqual(expect.arrayContaining([
        'google__drive_list_picked',
      ]))
    })

    it('offers no Google tool to a model without tool calling, like every '
      + 'other function tool', async () => {
      await useRealDriveTools()

      const offered = await offeredOnAnthropic({
        tools: [],
        providerTools: {},
        toolCall: false,
      })

      expect(offered.filter(name => name.startsWith('google__')))
        .toEqual([])
      expect(offered.filter(name => name.startsWith('mcp__'))).toEqual([])
    })

    it('offers the Drive tools on direct Anthropic when no provider tool '
      + 'is declared', async () => {
      await useRealDriveTools()

      const offered = await offeredOnAnthropic({
        tools: [],
        providerTools: {},
      })

      expect(offered).toEqual(expect.arrayContaining([
        'google__drive_list_picked',
        'google__drive_read_file',
        'google__drive_save_file',
      ]))
    })

    it('offers the Drive tools in a chat that already holds Google data and '
      + 'carries no search tool into any call of it', async () => {
      await useRealDriveTools()

      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

      const offered = await offeredOnAnthropic({
        tools: ['web_search'],
        providerTools: { tools: { web_search: providerWebSearch } },
      })

      expect(offered).toEqual(expect.arrayContaining([
        'google__drive_list_picked',
        'google__drive_read_file',
      ]))
      expect(offered).not.toContain('web_search')
      expect(offered).not.toContain('code_execution')
    })
  })

  it('runs the real Drive list tool once the user allowed it in this chat, '
    + 'stores references only and sets the chat flag', async () => {
    const { buildGoogleDriveTools } = await import(
      '~~/server/utils/google/drive-tools'
    )
    const rows = [{
      id: 'file-1',
      name: 'Budget.md',
      type: 'text/markdown',
      size: 12,
      storageKey: 'key-1',
      externalId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      externalModifiedAt: new Date('2026-11-20T09:00:00.000Z'),
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
    }]
    const listQuery = {
      from: () => listQuery,
      where: () => listQuery,
      orderBy: () => listQuery,
      limit: async () => rows,
    }
    const build = (grants: Record<string, string> = {}) => {
      return buildGoogleDriveTools({
        db: { select: () => listQuery } as never,
        kv: {} as never,
        event: { context: {} } as never,
        userId: 1,
        chatGrantHashes: grants,
        logger: { set: vi.fn() },
      })
    }
    const hash = (await build()).entries.get('google__drive_list_picked')!
      .descriptor.definitionHash!

    mocks.googleSend = await build({ google__drive_list_picked: hash })

    const { assistantInsert, doStream } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-d', 'google__drive_list_picked', {}),
        textChunks('You picked Budget.md.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const offered = ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
      .map((offeredTool: { name: string }) => offeredTool.name)

    expect(offered).toEqual(expect.arrayContaining([
      'google__drive_list_picked',
      'google__drive_read_file',
      'google__drive_save_file',
    ]))
    expect(findPart(parts, 'tool-google__drive_list_picked'))
      .toMatchObject({
        state: 'output-available',
        output: {
          bodyRemoved: true,
          references: [expect.objectContaining({
            id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
            title: 'Budget.md',
          })],
        },
      })
    expect(JSON.stringify(parts)).not.toContain('untrusted_tool_result')
    expect(mocks.chatUpdates).toContainEqual({
      googleDataAt: expect.anything(),
    })
  })

  it('hands the writers a mark that is off in an ordinary send and on in a '
    + 'flagged chat', async () => {
    mocks.flags.add('artifacts')

    await runSend({ servers: [linear], steps: [textChunks('Hello.')] })

    expect(mocks.capabilityInputs[0]!.isGoogleDerived?.()).toBe(false)

    mocks.capabilityInputs = []
    mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

    await runSend({ servers: [linear], steps: [textChunks('Hello.')] })

    expect(mocks.capabilityInputs[0]!.isGoogleDerived?.()).toBe(true)
  })

  function registerGoogleSearch() {
    return import('~~/server/utils/tool-approval/send').then((module) => {
      const execute = vi.fn(async () => ({
        references: [{ id: 'file-1', title: 'Budget' }],
        text: 'SECRET GOOGLE BODY',
      }))

      mocks.googleSend = {
        tools: {
          google__drive_search: tool({
            description: 'Search Drive.',
            inputSchema: z.object({ query: z.string() }),
            execute,
          }),
        },
        entries: new Map([[
          'google__drive_search',
          module.buildGoogleApprovalEntry({
            toolName: 'google__drive_search',
            kind: 'read',
            definitionHash: 'g'.repeat(64),
            summary: 'Search Google Drive',
            toolApprovalsActive: true,
            chatGrantHash: 'g'.repeat(64),
          }),
        ]]),
      }

      return execute
    })
  }

  it('flags the chat as soon as the Google read returned, even when the '
    + 'reply is never stored', async () => {
    mocks.failBatch = true

    await registerGoogleSearch()

    await expect(runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-g', 'google__drive_search', { query: 'budget' }),
        textChunks('Found the budget file.'),
      ],
    })).rejects.toMatchObject({
      message: 'The response could not be saved.',
    })
    expect(mocks.chatUpdates.filter((values) => {
      return values.googleDataAt instanceof Date
    })).toHaveLength(1)
  })

  it('fails the Google read when the chat flag cannot be written and drops '
    + 'its result', async () => {
    mocks.failChatFlag = true

    const execute = await registerGoogleSearch()
    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-g', 'google__drive_search', { query: 'budget' }),
        textChunks('Could not read it.'),
      ],
    })
    const readPart = findPart(
      assistantInsert?.parts ?? [],
      'tool-google__drive_search',
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(readPart).toMatchObject({ state: 'output-error' })
    expect(JSON.stringify(assistantInsert?.parts))
      .not.toContain('SECRET GOOGLE BODY')
    expect(mocks.batches).toHaveLength(0)
  })

  it('leaves the chat unflagged after an approved read that failed',
    async () => {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )

      mocks.googleSend = {
        tools: {
          google__drive_search: tool({
            description: 'Search Drive.',
            inputSchema: z.object({ query: z.string() }),
            execute: async () => {
              throw new Error('That file id is not one of the picked files.')
            },
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

      const { assistantInsert } = await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-g', 'google__drive_search', { query: 'x' }),
          textChunks('That did not work.'),
        ],
      })

      expect(findPart(
        assistantInsert?.parts ?? [],
        'tool-google__drive_search',
      )).toMatchObject({ state: 'output-error' })
      expect(mocks.chatUpdates.filter((values) => {
        return values.googleDataAt instanceof Date
      })).toHaveLength(0)
      expect(mocks.batches).toHaveLength(0)
    })

  it('does not taint the send or flag the chat for a Google write that '
    + 'returns no Google content', async () => {
    const { buildGoogleApprovalEntry } = await import(
      '~~/server/utils/tool-approval/send'
    )
    const execute = vi.fn(async () => ({
      references: [{ id: 'saved-1', title: 'Report.md' }],
      saved: true,
    }))

    mocks.googleSend = {
      tools: {
        google__drive_save_file: tool({
          description: 'Save.',
          inputSchema: z.object({ fileId: z.string() }),
          execute,
        }),
      },
      entries: new Map([['google__drive_save_file', buildGoogleApprovalEntry({
        toolName: 'google__drive_save_file',
        kind: 'write',
        definitionHash: 'g'.repeat(64),
        summary: 'Save a file',
        toolApprovalsActive: true,
      })]]),
    }

    mocks.flags.add('artifacts')

    const { assistantInsert } = await runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-s', 'google__drive_save_file', { fileId: 'f1' }),
        textChunks('Saved.'),
      ],
    })

    expect(findPart(
      assistantInsert?.parts ?? [],
      'tool-google__drive_save_file',
    )).toMatchObject({ state: 'approval-requested' })
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.chatUpdates.filter((values) => {
      return values.googleDataAt instanceof Date
    })).toHaveLength(0)
  })

  it('does not write the chat flag in a chat that is already flagged',
    async () => {
      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

      await registerGoogleSearch()
      await runSend({
        servers: [linear],
        steps: [
          toolCallChunks('call-g', 'google__drive_search', { query: 'budget' }),
          textChunks('Found the budget file.'),
        ],
      })

      expect(mocks.chatUpdates.filter((values) => {
        return values.googleDataAt instanceof Date
      })).toHaveLength(0)
    })

  it('fails the persist when the batch with the chat flag fails', async () => {
    const { buildGoogleApprovalEntry } = await import(
      '~~/server/utils/tool-approval/send'
    )

    mocks.failBatch = true
    mocks.googleSend = {
      tools: {
        google__drive_search: tool({
          description: 'Search Drive.',
          inputSchema: z.object({ query: z.string() }),
          execute: vi.fn(async () => ({
            references: [{ id: 'file-1', title: 'Budget' }],
            text: 'SECRET GOOGLE BODY',
          })),
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

    await expect(runSend({
      servers: [linear],
      steps: [
        toolCallChunks('call-g', 'google__drive_search', { query: 'budget' }),
        textChunks('Found the budget file.'),
      ],
    })).rejects.toMatchObject({
      message: 'The response could not be saved.',
    })
    expect(mocks.batches).toHaveLength(1)
  })

  it('keeps the egress ask in a flagged chat whose Google part is gone',
    async () => {
      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

      const { assistantInsert } = await runSend({
        servers: [linear],
        connectorIds: ['conn-linear'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          textChunks('Never reached.'),
        ],
      })

      expect(linear.callCount('tools/call')).toBe(0)
      expect(findPart(
        assistantInsert?.parts ?? [],
        TOOL_APPROVAL_DATA_PART_TYPE,
      )).toMatchObject({ data: { reason: 'google-egress' } })
      expect(mocks.chatUpdates).not.toContainEqual({
        googleDataAt: expect.anything(),
      })
      expect(writtenChunks()).toContainEqual({
        type: 'data-google-data',
        data: { holdsGoogleData: true },
        transient: true,
      })
    })

  it('withholds web search in a later send of a flagged chat', async () => {
    const providerTools = {
      tools: { web_search: openai.tools.webSearch() },
    }
    const offeredIn = async () => {
      mocks.mergedStreams = []
      mocks.writers = []

      const { doStream } = await runSend({
        servers: [linear],
        tools: ['web_search'],
        providerTools,
        steps: [textChunks('Answer.')],
      })

      return ((doStream.mock.calls[0]?.[0] as any)?.tools ?? [])
        .map((offeredTool: { name: string }) => offeredTool.name)
    }

    expect(await offeredIn()).toContain('web_search')

    mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

    expect(await offeredIn()).not.toContain('web_search')
  })

  it('deletes the stashed Google bodies of the chat when a new user message '
    + 'arrives', async () => {
    const resultId = 'result_abcdefgh'

    mocks.kv.set(`tool-approval:result:${resultId}`, '{"stale":true}')
    mocks.kv.set(`tool-approval:chat:${CHAT_PUBLIC_ID}`, JSON.stringify({
      version: 1,
      approvalIds: ['approval-0001'],
      messageIds: ['assistant-public-1'],
      resultIds: [resultId],
    }))
    mocks.chatMessages = [
      {
        id: 'row-user',
        publicId: 'user-public-0',
        role: 'user',
        parts: [{ type: 'text', text: 'Find it' }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
      {
        id: 'row-assistant',
        publicId: 'assistant-public-1',
        role: 'assistant',
        parts: [{
          type: 'dynamic-tool',
          toolName: 'mcp__linear__create_issue',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { title: 'x' },
          approval: { id: 'approval-0001' },
        }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      },
    ]

    await runSend({
      servers: [linear],
      messageId: 'user-public-2',
      steps: [textChunks('Fresh answer.')],
    })

    expect(mocks.kv.has(`tool-approval:result:${resultId}`)).toBe(false)
  })

  describe('with the tool-approvals flag off', () => {
    beforeEach(() => {
      mocks.flags.delete('tool-approvals')
    })

    it('refuses a connector write with the C-5 sentence and stores nothing',
      async () => {
        const { doStream, assistantInsert } = await runSend({
          servers: [linear],
          connectorIds: ['conn-linear'],
          steps: [
            toolCallChunks('call-1', 'mcp__linear__create_issue', {
              title: 'x',
            }),
            textChunks('I could not create it.'),
          ],
        })
        const parts = assistantInsert?.parts ?? []

        expect(doStream).toHaveBeenCalledTimes(2)
        expect(findPart(parts, 'dynamic-tool')?.output)
          .toBe(CONNECTOR_APPROVAL_DENIAL_TEXT)
        expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toBeUndefined()
        expect(linear.callCount('tools/call')).toBe(0)
        expect(mocks.store.audit).toEqual([expect.objectContaining({
          outcome: 'denied',
          approval: 'denied',
        })])
        expect([...mocks.kv.keys()].some((key) => {
          return key.startsWith('tool-approval:')
        })).toBe(false)
        expect((doStream.mock.calls[0]?.[0] as any)?.prompt?.[0]?.content)
          .toContain('tell the user it cannot run yet')
      })

    it('keeps the F2 stopgap for a second connector', async () => {
      seedConnector({
        id: 'conn-notion',
        slug: 'notion',
        title: 'Notion',
        url: NOTION_URL,
      })

      await runSend({
        servers: [linear, notion],
        connectorIds: ['conn-linear', 'conn-notion'],
        steps: [
          toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
          toolCallChunks('call-2', 'mcp__notion__list_pages', {}),
          textChunks('Done.'),
        ],
      })

      expect(linear.callCount('tools/call')).toBe(1)
      expect(notion.callCount('tools/call')).toBe(0)
      expect(mocks.store.audit.at(-1)).toMatchObject({ outcome: 'denied' })
    })

    it('runs an artifact write after connector output or with skill text',
      async () => {
        mocks.flags.add('artifacts')
        mocks.holdsSkillText = true
        createArtifactTool()

        await runSend({
          servers: [linear],
          connectorIds: ['conn-linear'],
          steps: [
            toolCallChunks('call-1', 'mcp__linear__list_issues', {}),
            toolCallChunks('call-2', 'create_artifact', {
              kind: 'html',
              title: 'Plan',
              content: '<p>hi</p>',
            }),
            textChunks('Done.'),
          ],
        })

        expect(mocks.artifactExecute).toHaveBeenCalledTimes(1)
        expect([...mocks.kv.keys()].some((key) => {
          return key.startsWith('tool-approval:')
        })).toBe(false)
      })
  })
})
