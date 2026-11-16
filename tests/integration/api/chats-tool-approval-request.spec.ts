import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
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
  artifactExecute: null as null | ReturnType<typeof vi.fn>,
  connectorUrls: {} as Record<string, string>,
  holdsSkillText: false,
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
  const updateSet = vi.fn(() => ({ where: updateWhere }))

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
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
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

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.writers = []
    mocks.flags = new Set(['connectors', 'tool-approvals'])
    mocks.holdsSkillText = false
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
    expect(pending?.snapshot.toolNames).toContain('mcp__linear__create_issue')
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

  it('asks Allow once only before an Always allow write to a second '
    + 'connector after the first one was read', async () => {
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
    const pendingPart = parts.find((part: any) => {
      return part.type === 'dynamic-tool' && part.state === 'approval-requested'
    })

    expect(linear.callCount('tools/call')).toBe(1)
    expect(notion.callCount('tools/call')).toBe(0)
    expect(pendingPart).toMatchObject({ toolName: 'mcp__notion__create_page' })
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
      data: { reason: 'untrusted-output', rememberOptions: ['once'] },
    })

    const pending = readKvJson(`tool-approval:${pendingPart.approval.id}`)
    const turn = readKvJson(`tool-approval:turn:${pending?.messagePublicId}`)

    expect(turn?.state).toMatchObject({
      taint: ['connector'],
      readSources: ['connector:conn-linear'],
      counters: { connectorCalls: 1 },
    })
  })

  it('asks before an Auto connector read that follows another '
    + 'connector\'s output, with no chat selection', async () => {
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
    const pendingPart = parts.find((part: any) => {
      return part.type === 'dynamic-tool' && part.state === 'approval-requested'
    })

    expect(notion.callCount('tools/call')).toBe(1)
    expect(linear.callCount('tools/call')).toBe(0)
    expect(findPart(parts, 'tool-use_connector')).toMatchObject({
      state: 'output-available',
    })
    expect(pendingPart).toMatchObject({ toolName: 'mcp__linear__list_issues' })
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
      data: { reason: 'untrusted-output' },
    })

    const pending = readKvJson(`tool-approval:${pendingPart.approval.id}`)

    expect(pending).toMatchObject({
      family: 'connector',
      connectorId: 'conn-linear',
      access: 'read',
    })
  })

  it('asks before the first use of an Auto connector read in a message '
    + 'that requested web search', async () => {
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
    const pendingPart = parts.find((part: any) => {
      return part.type === 'dynamic-tool' && part.state === 'approval-requested'
    })

    expect(linear.callCount('tools/call')).toBe(0)
    expect(pendingPart).toMatchObject({ toolName: 'mcp__linear__list_issues' })
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
      data: { reason: 'untrusted-output' },
    })
  })

  it('asks before another connector\'s read once an Auto connector was '
    + 'opened, because its tool list is remote text', async () => {
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
    const pendingPart = parts.find((part: any) => {
      return part.type === 'dynamic-tool' && part.state === 'approval-requested'
    })

    expect(notion.callCount('tools/call')).toBe(0)
    expect(linear.callCount('tools/call')).toBe(0)
    expect(pendingPart).toMatchObject({ toolName: 'mcp__notion__list_pages' })
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

  it('asks before an Auto connector read in a send that holds imported '
    + 'skill text, whatever opened it', async () => {
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

    expect(linear.callCount('tools/call')).toBe(0)
    expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
      data: { reason: 'untrusted-output' },
    })
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
