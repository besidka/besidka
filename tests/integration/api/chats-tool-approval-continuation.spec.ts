import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_APPROVAL_DENIAL_TEXT } from '~~/server/utils/tool-approval/denial-texts'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  CONNECTOR_CONSENT_VERSION,
  CONNECTOR_IMAGE_MAX_BYTES,
} from '#shared/utils/connectors-policy'
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
import { RED_PNG_BASE64 } from '../../setup/helpers/connector-images'
import { CONNECTOR_IMAGE_PART_TYPE } from '#shared/utils/connector-image-parts'
import { buildConnectorImageLine } from '../../../server/utils/connectors/image-placeholders'
import { frameUntrustedResult } from '../../../server/utils/connectors/tool-definitions'

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
  googleSend: null as null | {
    tools: Record<string, unknown>
    entries: Map<string, unknown>
  },
  googleSendFactory: null as null | ((input: {
    priorParts?: readonly unknown[]
  }) => Promise<{
    tools: Record<string, unknown>
    entries: Map<string, unknown>
  }>),
  googleBlockedNames: [] as string[],
  googleAllowedNames: [] as string[],
  googleServicesOff: [] as string[],
  candidateServicesOff: [] as Array<readonly string[] | undefined>,
  requestedServicesOff: [] as Array<readonly string[] | undefined>,
  pickedRead: null as null | Record<string, any>,
  saveFile: null as null | ((...args: unknown[]) => unknown),
  failRateLimitRead: false,
  chatGoogleDataAt: null as Date | null,
  memoryToolsEnabled: false,
  memoryWrites: [] as Array<Record<string, any>>,
  claims: new Map<string, Record<string, any>>(),
  expiredClaimIds: [] as string[][],
  stopMarkerSet: false,
  updates: [] as Array<Record<string, any>>,
  besidkaModes: new Map<string, string>(),
  listMcpProjects: null as null | ((...args: unknown[]) => unknown),
  grantCalls: [] as Array<unknown[]>,
  scriptsRun: null as null | Record<string, any>,
  keptFiles: [] as Array<{ id: string, storageKey: string, size: number }>,
  keptFinderCalls: [] as Array<Record<string, any>>,
  r2Objects: new Map<string, Uint8Array>(),
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
  applyRequestedGoogleServicesOff: async (
    _db: unknown,
    _userId: number,
    _chatPublicId: string,
    requested: readonly string[] | undefined,
  ) => {
    mocks.requestedServicesOff.push(requested)

    return requested
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
    expireUnfinishedClaims: async (
      _db: unknown,
      approvalIds: readonly string[],
    ) => {
      mocks.expiredClaimIds.push([...approvalIds])

      return approvalIds.filter((approvalId) => {
        return mocks.claims.get(approvalId)?.status === 'claimed'
      }).length
    },
  }
})

vi.mock('~~/server/utils/files/connector-images', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/connector-images')
  >()

  return {
    ...actual,
    findChatConnectorImageFilesByIds: async (
      _db: unknown,
      input: { fileIds: readonly string[] },
    ) => {
      mocks.keptFinderCalls.push(input)

      return mocks.keptFiles.filter(file => input.fileIds.includes(file.id))
    },
  }
})

vi.mock('~~/server/utils/tool-approval/google-send-candidates', async (
  importOriginal,
) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/tool-approval/google-send-candidates')
  >()

  return {
    ...actual,
    buildGoogleSendToolCandidates: async (input: {
      priorParts?: readonly unknown[]
      servicesOff?: readonly string[]
    }) => {
      mocks.candidateServicesOff.push(input.servicesOff)

      const built = (
        mocks.googleSendFactory
          ? await mocks.googleSendFactory(input)
          : mocks.googleSend ?? actual.noGoogleSendTools()
      ) as never

      return mocks.googleBlockedNames.length
        || mocks.googleAllowedNames.length
        || mocks.googleServicesOff.length
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
            mocks.googleServicesOff as never,
            built.entries.keys(),
          ),
        )
        : built
    },
  }
})

vi.mock('~~/server/utils/google/drive-picked', async (importOriginal) => {
  return {
    ...await importOriginal<
      typeof import('~~/server/utils/google/drive-picked')
    >(),
    readPickedDriveFile: async () => mocks.pickedRead,
  }
})

vi.mock('~~/server/utils/google/tokens', async (importOriginal) => {
  return {
    ...await importOriginal<typeof import('~~/server/utils/google/tokens')>(),
    getGoogleAccessToken: async () => ({
      status: 'ok',
      accessToken: 'byo-token',
      expiresAt: null,
    }),
  }
})

vi.mock('~~/server/utils/google/drive-save', () => ({
  saveFileToGoogleDrive: (...args: unknown[]) => mocks.saveFile!(...args),
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
            googleDataAt: mocks.chatGoogleDataAt,
            messages: mocks.chatMessages,
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({
            apiKey: 'encrypted-key',
            paidTierConfirmedAt: null,
          })),
        },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
      batch: vi.fn(async (statements: unknown[]) => {
        return await Promise.all(statements.map(async (statement) => {
          const withGet = statement as { get?: () => Promise<unknown> }

          return typeof withGet.get === 'function'
            ? [await withGet.get()]
            : await statement
        }))
      }),
    },
    insertValues,
    updateSet,
  }
}

function createKv() {
  return {
    get: vi.fn(async (key: string) => {
      if (mocks.failRateLimitRead && key.startsWith('tool-approval-rate:')) {
        throw new Error('KV unavailable')
      }

      if (mocks.stopMarkerSet && key.startsWith('chat-generation-stop:')) {
        return '1'
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
  scripted?: ReturnType<typeof createScriptedModel>
}): Promise<RequestResult> {
  const { model, doStream } = input.scripted ?? createScriptedModel(
    input.steps ?? [textChunks('Unused.')],
  )

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: mocks.providerTools,
    providerOptions: {},
  })))
  vi.stubGlobal('useAnthropic', vi.fn(async () => ({
    instance: model,
    tools: mocks.providerTools,
    providerOptions: {},
    reasoning: undefined,
    thinkingBinding: null,
  })))
  vi.stubGlobal('useGoogle', vi.fn(async () => ({
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
    mocks.memoryToolsEnabled = false
    mocks.providerTools = {}
    mocks.googleSend = null
    mocks.googleSendFactory = null
    mocks.googleBlockedNames = []
    mocks.googleAllowedNames = []
    mocks.googleServicesOff = []
    mocks.candidateServicesOff = []
    mocks.requestedServicesOff = []
    mocks.failRateLimitRead = false
    mocks.chatGoogleDataAt = null
    mocks.memoryWrites = []
    mocks.claims = new Map()
    mocks.updates = []
    mocks.expiredClaimIds = []
    mocks.stopMarkerSet = false
    mocks.besidkaModes = new Map()
    mocks.grantCalls = []
    mocks.scriptsRun = null
    mocks.keptFiles = []
    mocks.keptFinderCalls = []
    mocks.r2Objects = new Map()
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

  it('ends the claim lease of a continuation the user stopped, and stores '
    + 'nothing', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds
    const updatesBefore = mocks.updates.length

    mocks.stopMarkerSet = true

    await answer(paused, [{ approvalId, approved: true }], [
      textChunks('Created the issue.'),
    ])

    expect(mocks.expiredClaimIds).toEqual([[approvalId]])
    expect(mocks.updates).toHaveLength(updatesBefore)
  })

  it('keeps the claims of a continuation that was not stopped', async () => {
    const paused = await pauseCreateIssue()
    const [approvalId] = paused.approvalIds

    await answer(paused, [{ approvalId, approved: true }], [
      textChunks('Created the issue.'),
    ])

    expect(mocks.expiredClaimIds).toEqual([])
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
      reason: TOOL_APPROVAL_DENIAL_TEXT['over-cap'],
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

  it('asks a Needs approval connector read after a requested web search, '
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
        setting.approval = 'needs-approval'
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

  describe('kept connector images', () => {
    const LIST_ISSUES = 'mcp__linear__list_issues'
    const PNG_BYTES = Buffer.from(RED_PNG_BASE64, 'base64')
    const KEPT_LINE = buildConnectorImageLine(
      { mediaType: 'image/png', bytes: PNG_BYTES.length },
      'saved',
    )

    beforeEach(() => {
      vi.stubGlobal('useFileStorage', () => ({
        get: async (key: string) => {
          const bytes = mocks.r2Objects.get(key)

          return bytes
            ? { arrayBuffer: async () => bytes.slice().buffer }
            : null
        },
      }))
    })

    function useAnthropicImageModel() {
      vi.stubGlobal('useChatProvider', vi.fn(() => ({
        provider: { id: 'anthropic' },
        model: {
          id: 'claude-opus-5-5',
          name: 'Claude Opus 5.5',
          tools: [],
          toolCall: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
      })))
    }

    function keepImage(fileId: string, size = PNG_BYTES.length) {
      const storageKey = `connector-${fileId}.png`

      mocks.keptFiles.push({ id: fileId, storageKey, size })
      mocks.r2Objects.set(storageKey, new Uint8Array(PNG_BYTES))
    }

    function screenshotParts(toolCallId: string, fileId: string) {
      return [
        { type: 'step-start' },
        {
          type: 'dynamic-tool',
          toolName: LIST_ISSUES,
          toolCallId,
          state: 'output-available',
          input: {},
          output: frameUntrustedResult({
            slug: 'linear',
            toolName: 'list_issues',
            text: `Screenshot\n${KEPT_LINE}`,
          }).text,
        },
        {
          type: CONNECTOR_IMAGE_PART_TYPE,
          id: `connector-image-${toolCallId}-0`,
          data: {
            toolCallId,
            fileId,
            url: `/files/connector-${fileId}.png`,
            mediaType: 'image/png',
            width: 8,
            height: 8,
            size: PNG_BYTES.length,
            name: 'linear-list_issues.png',
          },
        },
      ]
    }

    async function pauseAfterScreenshots(count = 2) {
      const paused = await pauseCreateIssue()
      const assistant = mocks.chatMessages.find((message) => {
        return message.id === 'row-assistant'
      })!

      assistant.parts = [
        ...Array.from({ length: count }, (_value, index) => {
          return screenshotParts(`shot-${index + 1}`, `file-${index + 1}`)
        }).flat(),
        ...assistant.parts,
      ]

      return paused
    }

    function screenshotResults(doStream: ReturnType<typeof vi.fn>) {
      const prompt = (doStream.mock.calls[0]?.[0] as any)?.prompt ?? []

      return prompt
        .filter((message: any) => message.role === 'tool')
        .flatMap((message: any) => message.content)
        .filter((part: any) => {
          return part.type === 'tool-result'
            && String(part.toolCallId).startsWith('shot-')
        })
    }

    it('shows both kept screenshots to Claude again after the approval',
      async () => {
        useAnthropicImageModel()
        keepImage('file-1')
        keepImage('file-2')

        const paused = await pauseAfterScreenshots()
        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('Both frames look right.')])
        const results = screenshotResults(doStream)

        expect(mocks.keptFinderCalls).toEqual([
          expect.objectContaining({
            userId: 1,
            chatPublicId: CHAT_PUBLIC_ID,
            fileIds: ['file-1', 'file-2'],
          }),
        ])
        expect(results.map((result: any) => result.toolCallId))
          .toEqual(['shot-1', 'shot-2'])

        for (const result of results) {
          const output = JSON.stringify(result.output)

          expect(result.output.type).toBe('content')
          expect(output).toContain(RED_PNG_BASE64)
          expect(output).toContain('shown to the model again')
          expect(output).toContain('from the connector \\"Linear\\"')
          expect(output).not.toContain('no longer available')
        }

        const stored = JSON.stringify(mocks.updates.at(-1)!.parts)

        expect(stored).not.toContain('shown to the model again')
        expect(stored).not.toContain(RED_PNG_BASE64)
      })

    it('leaves the screenshots as text when the model cannot see images',
      async () => {
        keepImage('file-1')
        keepImage('file-2')

        const paused = await pauseAfterScreenshots()
        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('Done.')])
        const results = screenshotResults(doStream)

        expect(mocks.keptFinderCalls).toEqual([])
        expect(results).toHaveLength(2)

        for (const result of results) {
          const output = JSON.stringify(result.output)

          expect(result.output.type).toBe('text')
          expect(output).not.toContain(RED_PNG_BASE64)
          expect(output).toContain('kept with this chat, no longer available')
        }
      })

    it('keeps a deleted screenshot as text and shows the other one again',
      async () => {
        useAnthropicImageModel()
        keepImage('file-2')

        const paused = await pauseAfterScreenshots()
        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('Done.')])
        const [first, second] = screenshotResults(doStream)

        expect(first.output.type).toBe('text')
        expect(JSON.stringify(first.output))
          .toContain('kept with this chat, no longer available')
        expect(second.output.type).toBe('content')
        expect(JSON.stringify(second.output)).toContain(RED_PNG_BASE64)
      })

    it('leaves the oldest screenshot as text when the send budget is full',
      async () => {
        useAnthropicImageModel()

        for (let index = 1; index <= 4; index++) {
          keepImage(`file-${index}`, CONNECTOR_IMAGE_MAX_BYTES)
        }

        const paused = await pauseAfterScreenshots(4)
        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('Done.')])
        const results = screenshotResults(doStream)

        expect(results.map((result: any) => result.output.type))
          .toEqual(['text', 'content', 'content', 'content'])
      })
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

    it.each([
      ['Deny', false, 'output-denied'],
      ['Allow once', true, 'output-available'],
    ] as const)('answers %s for a send whose Auto connector has over 200 '
      + 'tools', async (_label, approved, state) => {
      const github = createMockMcpServer({
        url: LINEAR_URL,
        tools: Array.from({ length: 250 }, (_value, index) => {
          return {
            name: `tool_${index}`,
            description: `Tool ${index}.`,
            annotations: { readOnlyHint: true },
          }
        }),
        respond: name => ({ text: `${name} result` }),
      })

      mocks.store.connectors[0]!.toolMode = 'auto'
      mocks.store.chatSettings = []

      const paused = await pauseTurn({
        servers: [github],
        connectorIds: [],
        steps: [toolCallChunks('call-b', 'besidka__list_projects', {})],
      })
      const [approvalId] = paused.approvalIds

      await answer(paused, [{ approvalId, approved }])

      expect(findPart(
        mocks.updates.at(-1)!.parts,
        'tool-besidka__list_projects',
      )).toMatchObject({ state })
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

  describe('Google tools', () => {
    const GOOGLE_HASH = 'g'.repeat(64)
    let readExecute: ReturnType<typeof vi.fn>
    let writeExecute: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const { buildGoogleApprovalEntry } = await import(
        '~~/server/utils/tool-approval/send'
      )

      readExecute = vi.fn(async () => ({
        references: [{ id: 'file-1', title: 'Budget' }],
        text: 'SECRET GOOGLE BODY',
      }))
      writeExecute = vi.fn(async () => ({
        references: [{ id: 'event-1' }],
        text: 'EVENT BODY',
      }))
      mocks.googleSend = {
        tools: {
          google__drive_search: tool({
            description: 'Search Drive.',
            inputSchema: z.object({ query: z.string() }),
            execute: readExecute,
          }),
          google__calendar_create_event: tool({
            description: 'Create an event.',
            inputSchema: z.object({ title: z.string() }),
            execute: writeExecute,
          }),
        },
        entries: new Map([
          ['google__drive_search', buildGoogleApprovalEntry({
            toolName: 'google__drive_search',
            kind: 'read',
            definitionHash: GOOGLE_HASH,
            summary: 'Search Google Drive',
            toolApprovalsActive: true,
            chatGrantHash: GOOGLE_HASH,
          })],
          ['google__calendar_create_event', buildGoogleApprovalEntry({
            toolName: 'google__calendar_create_event',
            kind: 'write',
            definitionHash: GOOGLE_HASH,
            summary: 'Create a calendar event',
            toolApprovalsActive: true,
          })],
        ]),
      }
    })

    async function pauseAfterGoogleRead() {
      return await pauseTurn({
        servers: [linear],
        connectorIds: [],
        steps: [
          toolCallChunks('call-g', 'google__drive_search', {
            query: 'budget',
          }),
          toolCallChunks('call-w', 'google__calendar_create_event', {
            title: 'Budget review',
          }),
        ],
      })
    }

    async function stashKey(messagePublicId: string) {
      const { toolApprovalResultIdOf, toolApprovalResultKey } = await import(
        '~~/server/utils/tool-approval/kv'
      )

      return toolApprovalResultKey(
        await toolApprovalResultIdOf(messagePublicId, 'call-g'),
      )
    }

    it('keeps the body only in KV while paused and gives it back to the '
      + 'model on the answer', async () => {
      const paused = await pauseAfterGoogleRead()
      const key = await stashKey(paused.messagePublicId)
      const [approvalId] = paused.approvalIds
      const readPart = findPart(
        paused.assistantParts,
        'tool-google__drive_search',
      )

      expect(readExecute).toHaveBeenCalledTimes(1)
      expect(writeExecute).not.toHaveBeenCalled()
      expect(readPart).toMatchObject({
        state: 'output-available',
        output: { bodyRemoved: true, references: [{ id: 'file-1' }] },
      })
      expect(JSON.stringify(paused.assistantParts))
        .not.toContain('SECRET GOOGLE BODY')
      expect(mocks.kv.get(key)).toContain('SECRET GOOGLE BODY')
      expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
        family: 'google',
        access: 'write',
        rememberOptions: ['once'],
      })
      expect(readKvJson(`tool-approval:chat:${CHAT_PUBLIC_ID}`))
        .toMatchObject({
          approvalIds: [approvalId],
          messageIds: [paused.messagePublicId],
          resultIds: [key.replace('tool-approval:result:', '')],
        })

      const { doStream } = await answer(paused, [
        { approvalId, approved: true },
      ], [textChunks('Scheduled the review.')])
      const update = mocks.updates.at(-1)!

      expect(writeExecute).toHaveBeenCalledTimes(1)
      expect(JSON.stringify((doStream.mock.calls[0]?.[0] as any)?.prompt))
        .toContain('SECRET GOOGLE BODY')
      expect(JSON.stringify(update.parts)).not.toContain('SECRET GOOGLE BODY')
      expect(JSON.stringify(update.parts)).not.toContain('EVENT BODY')
      expect(update.parts.length)
        .toBeGreaterThanOrEqual(paused.assistantParts.length)
      expect(mocks.kv.has(key)).toBe(false)
    })

    it('runs the always-allowed read of a paused step once, marks it, and '
      + 'gives the approved write its approval id and no execution id',
    async () => {
      mocks.googleAllowedNames = ['google__drive_search']

      const paused = await pauseAfterGoogleRead()
      const [approvalId] = paused.approvalIds

      expect(paused.approvalIds).toHaveLength(1)
      expect(readExecute).toHaveBeenCalledTimes(1)
      expect(writeExecute).not.toHaveBeenCalled()
      expect(findPart(paused.assistantParts, 'data-tool-grant')).toMatchObject({
        data: {
          toolCallId: 'call-g',
          toolName: 'google__drive_search',
          scope: 'always',
        },
      })

      await answer(paused, [
        { approvalId, approved: true },
      ], [textChunks('Scheduled the review.')])

      const options = writeExecute.mock.calls[0]![1] as {
        approvalId?: string
        executionId?: string
      }

      expect(readExecute).toHaveBeenCalledTimes(1)
      expect(writeExecute).toHaveBeenCalledTimes(1)
      expect(options.approvalId).toBe(approvalId)
      expect(options.executionId).toBeUndefined()
    })

    it('tells the model the content is unavailable when the stash is gone',
      async () => {
        const paused = await pauseAfterGoogleRead()
        const [approvalId] = paused.approvalIds

        mocks.kv.delete(await stashKey(paused.messagePublicId))

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ])
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(prompt).not.toContain('SECRET GOOGLE BODY')
        expect(prompt).toContain('could not be kept')
      })

    describe('a tool the user set to Blocked after approving it', () => {
      const BLOCKED_TEXT = 'This tool is blocked in the user\'s settings, so '
        + 'the action did not run.'

      it('denies the approved write with the blocked text and never calls '
        + 'Google', async () => {
        const paused = await pauseAfterGoogleRead()
        const [approvalId] = paused.approvalIds

        expect(writeExecute).not.toHaveBeenCalled()

        mocks.googleBlockedNames = ['google__calendar_create_event']

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(writeExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: BLOCKED_TEXT,
        })
        expect(writtenChunks().some(chunk => chunk.type === 'error'))
          .toBe(false)
      })

      it('gives the earlier read\'s stashed body to the model and removes it '
        + 'once the continuation finished, as for any answer', async () => {
        const paused = await pauseAfterGoogleRead()
        const [approvalId] = paused.approvalIds
        const key = await stashKey(paused.messagePublicId)

        mocks.googleBlockedNames = ['google__calendar_create_event']

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(writeExecute).not.toHaveBeenCalled()
        expect(JSON.stringify((doStream.mock.calls[0]?.[0] as any)?.prompt))
          .toContain('SECRET GOOGLE BODY')
        expect(mocks.kv.has(key)).toBe(false)
      })

      it('still runs the approved call when another tool is the Blocked one',
        async () => {
          const paused = await pauseAfterGoogleRead()
          const [approvalId] = paused.approvalIds

          mocks.googleBlockedNames = ['google__drive_search']

          await answer(paused, [
            { approvalId, approved: true },
          ], [textChunks('Scheduled the review.')])

          expect(writeExecute).toHaveBeenCalledTimes(1)
        })

      describe('a service the user switched off in the chat after '
        + 'approving', () => {
        it('denies the approved write with the blocked text and never calls '
          + 'Google', async () => {
          const paused = await pauseAfterGoogleRead()
          const [approvalId] = paused.approvalIds

          mocks.googleServicesOff = ['calendar']

          const { doStream } = await answer(paused, [
            { approvalId, approved: true },
          ], [textChunks('It did not run.')])

          expect(writeExecute).not.toHaveBeenCalled()
          expect(lastToolMessage(doStream).content[0].output).toEqual({
            type: 'execution-denied',
            reason: BLOCKED_TEXT,
          })
          expect(writtenChunks().some(chunk => chunk.type === 'error'))
            .toBe(false)
        })

        it('ignores a googleServicesOff choice carried by a resume', async () => {
          const paused = await pauseAfterGoogleRead()
          const [approvalId] = paused.approvalIds

          mocks.candidateServicesOff = []

          await request({
            servers: [linear],
            steps: [textChunks('Scheduled the review.')],
            body: {
              ...answerBody(paused.messagePublicId, [
                { approvalId, approved: true },
              ]),
              googleServicesOff: ['calendar', 'gmail', 'drive'],
            },
          })

          expect(mocks.requestedServicesOff).toEqual([])
          expect(mocks.candidateServicesOff).toEqual([undefined])
          expect(writeExecute).toHaveBeenCalledTimes(1)
        })

        it('still runs the approved call when another service is the one '
          + 'switched off', async () => {
          const paused = await pauseAfterGoogleRead()
          const [approvalId] = paused.approvalIds

          mocks.googleServicesOff = ['gmail', 'drive']

          await answer(paused, [
            { approvalId, approved: true },
          ], [textChunks('Scheduled the review.')])

          expect(writeExecute).toHaveBeenCalledTimes(1)
        })

        it('denies an approved Gmail search with the blocked text and '
          + 'never calls Google', async () => {
          const { buildGoogleApprovalEntry } = await import(
            '~~/server/utils/tool-approval/send'
          )
          const searchExecute = vi.fn(async () => ({
            references: [{ id: 'thread-1' }],
            text: 'MAIL BODY',
          }))

          mocks.googleSend = {
            tools: {
              google__gmail_search: tool({
                description: 'Search Gmail.',
                inputSchema: z.object({ query: z.string() }),
                execute: searchExecute,
              }),
            },
            entries: new Map([
              ['google__gmail_search', buildGoogleApprovalEntry({
                toolName: 'google__gmail_search',
                kind: 'read',
                definitionHash: GOOGLE_HASH,
                summary: 'Search Gmail',
                toolApprovalsActive: true,
              })],
            ]),
          }

          const paused = await pauseTurn({
            servers: [linear],
            connectorIds: [],
            steps: [
              toolCallChunks('call-m', 'google__gmail_search', {
                query: 'invoice',
              }),
            ],
          })
          const [approvalId] = paused.approvalIds

          expect(searchExecute).not.toHaveBeenCalled()

          mocks.googleServicesOff = ['gmail']

          const { doStream } = await answer(paused, [
            { approvalId, approved: true },
          ], [textChunks('It did not run.')])

          expect(searchExecute).not.toHaveBeenCalled()
          expect(lastToolMessage(doStream).content[0].output).toEqual({
            type: 'execution-denied',
            reason: BLOCKED_TEXT,
          })
        })
      })

      it('says the tool is no longer available only when it has no entry '
        + 'at all', async () => {
        const paused = await pauseAfterGoogleRead()
        const [approvalId] = paused.approvalIds

        mocks.googleSend = null

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(writeExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toMatchObject({
          type: 'execution-denied',
          reason: expect.stringContaining('no longer available'),
        })
      })
    })

    describe('a Drive folder create the user blocked or switched off after '
      + 'approving it', () => {
      const BLOCKED_TEXT = 'This tool is blocked in the user\'s settings, so '
        + 'the action did not run.'
      let createExecute: ReturnType<typeof vi.fn>

      beforeEach(async () => {
        const { buildGoogleApprovalEntry } = await import(
          '~~/server/utils/tool-approval/send'
        )

        createExecute = vi.fn(async () => ({
          references: [{ id: 'folder-id-0123456789' }],
          created: true,
        }))
        mocks.googleSend = {
          tools: {
            google__drive_create_folder: tool({
              description: 'Create a folder.',
              inputSchema: z.object({ name: z.string() }),
              execute: createExecute,
            }),
          },
          entries: new Map([
            ['google__drive_create_folder', buildGoogleApprovalEntry({
              toolName: 'google__drive_create_folder',
              kind: 'write',
              definitionHash: GOOGLE_HASH,
              summary: 'Create a folder in your Google Drive',
              toolApprovalsActive: true,
            })],
          ]),
        }
      })

      async function pauseOnCreate() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-f', 'google__drive_create_folder', {
              name: 'Reports',
            }),
          ],
        })
      }

      it('runs the approved create when nothing changed', async () => {
        const paused = await pauseOnCreate()
        const [approvalId] = paused.approvalIds

        expect(createExecute).not.toHaveBeenCalled()

        await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Created it.')])

        expect(createExecute).toHaveBeenCalledTimes(1)
      })

      it('denies it with the blocked text and never calls Google once the '
        + 'tool is Blocked', async () => {
        const paused = await pauseOnCreate()
        const [approvalId] = paused.approvalIds

        mocks.googleBlockedNames = ['google__drive_create_folder']

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(createExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: BLOCKED_TEXT,
        })
        expect(writtenChunks().some(chunk => chunk.type === 'error'))
          .toBe(false)
      })

      it('denies it with the blocked text and never calls Google once '
        + 'Drive is switched off in the chat', async () => {
        const paused = await pauseOnCreate()
        const [approvalId] = paused.approvalIds

        mocks.googleServicesOff = ['drive']

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(createExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: BLOCKED_TEXT,
        })
      })

      it('still runs it when only the folder list is Blocked', async () => {
        const paused = await pauseOnCreate()
        const [approvalId] = paused.approvalIds

        mocks.googleBlockedNames = ['google__drive_list_folder']

        await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Created it.')])

        expect(createExecute).toHaveBeenCalledTimes(1)
      })
    })

    describe.each([
      ['google__drive_rename', 'Rename an item', {
        itemId: 'item-id-0123456789',
        newName: 'Plan',
      }],
      ['google__drive_move', 'Move an item', {
        itemId: 'item-id-0123456789',
        fromFolderId: 'root',
        toFolderId: 'folder-id-0123456789',
      }],
    ])('a %s the user blocked or switched off after approving it', (
      toolName,
      summary,
      callInput,
    ) => {
      const BLOCKED_TEXT = 'This tool is blocked in the user\'s settings, so '
        + 'the action did not run.'
      let changeExecute: ReturnType<typeof vi.fn>

      beforeEach(async () => {
        const { buildGoogleApprovalEntry } = await import(
          '~~/server/utils/tool-approval/send'
        )

        changeExecute = vi.fn(async () => ({
          references: [{ id: 'item-id-0123456789' }],
          alreadyDone: false,
        }))
        mocks.googleSend = {
          tools: {
            [toolName]: tool({
              description: 'Change a Drive item.',
              inputSchema: z.record(z.string(), z.string()),
              execute: changeExecute,
            }),
          },
          entries: new Map([
            [toolName, buildGoogleApprovalEntry({
              toolName,
              kind: 'write',
              definitionHash: GOOGLE_HASH,
              summary,
              toolApprovalsActive: true,
            })],
          ]),
        }
      })

      async function pauseOnChange() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [toolCallChunks('call-c', toolName, callInput)],
        })
      }

      it('asks with Allow once only and runs it when nothing changed',
        async () => {
          const paused = await pauseOnChange()
          const [approvalId] = paused.approvalIds

          expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
            family: 'google',
            access: 'write',
            toolName,
            rememberOptions: ['once'],
            input: callInput,
          })
          expect(changeExecute).not.toHaveBeenCalled()

          await answer(paused, [
            { approvalId, approved: true },
          ], [textChunks('Done.')])

          expect(changeExecute).toHaveBeenCalledTimes(1)
          expect(changeExecute.mock.calls[0]![1]).toMatchObject({
            approvalId,
          })
        })

      it('denies it with the blocked text and never calls Google once the '
        + 'tool is Blocked', async () => {
        const paused = await pauseOnChange()
        const [approvalId] = paused.approvalIds

        mocks.googleBlockedNames = [toolName]

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(changeExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: BLOCKED_TEXT,
        })
      })

      it('denies it with the blocked text and never calls Google once '
        + 'Drive is switched off in the chat', async () => {
        const paused = await pauseOnChange()
        const [approvalId] = paused.approvalIds

        mocks.googleServicesOff = ['drive']

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('It did not run.')])

        expect(changeExecute).not.toHaveBeenCalled()
        expect(lastToolMessage(doStream).content[0].output).toEqual({
          type: 'execution-denied',
          reason: BLOCKED_TEXT,
        })
      })

      it('does not run it when the user denies it', async () => {
        const paused = await pauseOnChange()

        await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: false },
        ])

        expect(changeExecute).not.toHaveBeenCalled()
      })
    })

    describe('with the real Drive tools', () => {
      const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

      beforeEach(async () => {
        const { buildGoogleDriveTools } = await import(
          '~~/server/utils/google/drive-tools'
        )
        const nameQuery = {
          from: () => nameQuery,
          where: () => nameQuery,
          limit: async () => [{
            name: 'Report.md',
            size: 2048,
            createdAt: new Date('2026-11-20T10:00:00.000Z'),
            googleDerivedAt: null,
          }],
        }
        const build = (grants: Record<string, string> = {}) => {
          return buildGoogleDriveTools({
            db: { select: () => nameQuery } as never,
            kv: {} as never,
            event: { context: {} } as never,
            userId: 1,
            chatGrantHashes: grants,
            logger: { set: vi.fn() },
          })
        }
        const hash = (await build()).entries
          .get('google__drive_read_file')!.descriptor.definitionHash!

        mocks.googleSend = await build({ google__drive_read_file: hash })
        mocks.pickedRead = {
          status: 'ok',
          isStale: false,
          text: 'SECRET DRIVE BODY',
          file: {
            id: 'file-1',
            driveFileId: DRIVE_ID,
            name: 'Plan.md',
            type: 'text/markdown',
            size: 17,
            copiedAt: new Date('2026-11-20T10:00:00.000Z'),
            modifiedAt: new Date('2026-11-20T09:00:00.000Z'),
          },
        }
        mocks.saveFile = vi.fn(async () => ({
          status: 'saved',
          saved: {
            fileId: 'file-2',
            driveFileId: 'saved-drive-id-0000',
            name: 'Report.md',
            link: 'https://drive.google.com/open?id=saved-drive-id-0000',
            isAlreadySaved: false,
          },
        }))
      })

      async function pauseAfterDriveRead() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-g', 'google__drive_read_file', {
              fileId: 'file-1',
            }),
            toolCallChunks('call-w', 'google__drive_save_file', {
              fileId: 'file-2',
            }),
          ],
        })
      }

      it('stores the file as a reference only, keeps the framed body in KV '
        + 'while the save waits, and runs the save once approved', async () => {
        const paused = await pauseAfterDriveRead()
        const key = await stashKey(paused.messagePublicId)
        const [approvalId] = paused.approvalIds

        expect(findPart(paused.assistantParts, 'tool-google__drive_read_file'))
          .toMatchObject({
            state: 'output-available',
            output: {
              bodyRemoved: true,
              references: [{
                id: DRIVE_ID,
                kind: 'drive-file',
                title: 'Plan.md',
                link: `https://drive.google.com/open?id=${DRIVE_ID}`,
              }],
            },
          })
        expect(JSON.stringify(paused.assistantParts))
          .not.toContain('SECRET DRIVE BODY')
        expect(mocks.kv.get(key)).toContain('SECRET DRIVE BODY')
        expect(mocks.kv.get(key)).toContain('<untrusted_tool_result')
        expect(mocks.saveFile).not.toHaveBeenCalled()
        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          access: 'write',
          toolName: 'google__drive_save_file',
          rememberOptions: ['once'],
          summary: 'Save "Report.md" (2 KB, created 2026-11-20) to your '
            + 'Google Drive',
        })

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Saved it.')])
        const update = mocks.updates.at(-1)!

        expect(mocks.saveFile).toHaveBeenCalledTimes(1)
        expect(mocks.saveFile).toHaveBeenCalledWith(expect.objectContaining({
          target: { fileId: 'file-2' },
        }))
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(prompt).toContain('SECRET DRIVE BODY')
        expect(prompt).not.toContain('"title"')
        expect(prompt).not.toContain(`open?id=${DRIVE_ID}`)
        expect(prompt.match(/Plan\.md/g)?.length).toBe(1)
        expect(JSON.stringify(update.parts))
          .not.toContain('SECRET DRIVE BODY')
        expect(findPart(update.parts, 'tool-google__drive_save_file'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{ id: 'saved-drive-id-0000' }],
            },
          })
        expect(mocks.kv.has(key)).toBe(false)
      })

      it('does not run the save when the user denies it', async () => {
        const paused = await pauseAfterDriveRead()
        const [approvalId] = paused.approvalIds

        await answer(paused, [{ approvalId, approved: false }])

        expect(mocks.saveFile).not.toHaveBeenCalled()
      })
    })

    describe('with the real Gmail tools', () => {
      const MAIL_SUBJECT = 'SECRET MERGER SUBJECT'
      const MAIL_SENDER = 'eve@evil.example'
      const MAIL_SNIPPET = 'SECRET MERGER SNIPPET'
      const MAIL_BODY = 'SECRET MERGER BODY'
      const FRAME = /<untrusted_tool_result[\s\S]*?<\/untrusted_tool_result>/g
      let gmailFetch: ReturnType<typeof vi.fn>
      let buildByo: (
        grants: Record<string, string>,
        priorParts?: readonly unknown[],
      ) => Promise<{
        tools: Record<string, unknown>
        entries: Map<string, unknown>
      }>
      let searchGrantHash = ''

      function outsideFrames(prompt: string): string {
        return prompt.replace(FRAME, '')
      }

      async function continueRound(
        messageId: string,
        round: number,
        steps: Array<Array<Record<string, unknown>>>,
      ) {
        return await request({
          servers: [linear],
          steps,
          body: { continue: { messageId, round } },
        })
      }

      beforeEach(async () => {
        const { buildGoogleByoTools } = await import(
          '~~/server/utils/google/byo-tools'
        )

        gmailFetch = vi.fn(async (input: string) => {
          const url = new URL(input)

          if (url.pathname === '/gmail/v1/users/me/threads') {
            return Response.json({ threads: [{ id: 't1' }] })
          }

          if (
            url.pathname === '/gmail/v1/users/me/threads/t1'
            && url.searchParams.get('format') === 'full'
          ) {
            return Response.json({
              id: 't1',
              messages: [{
                id: 'm1',
                internalDate: '1763719200000',
                payload: {
                  mimeType: 'text/plain',
                  headers: [{ name: 'Subject', value: MAIL_SUBJECT }],
                  body: {
                    data: Buffer.from(MAIL_BODY).toString('base64url'),
                  },
                },
              }],
            })
          }

          if (url.pathname === '/gmail/v1/users/me/threads/t1') {
            return Response.json({
              id: 't1',
              messages: [{
                id: 'm1',
                internalDate: '1763719200000',
                snippet: MAIL_SNIPPET,
                payload: {
                  headers: [
                    { name: 'From', value: `Eve <${MAIL_SENDER}>` },
                    { name: 'Subject', value: MAIL_SUBJECT },
                    { name: 'Date', value: 'Fri, 21 Nov 2025 10:00:00 +0000' },
                  ],
                },
              }],
            })
          }

          if (url.pathname === '/gmail/v1/users/me/drafts') {
            return Response.json({
              id: 'r-1',
              message: { id: 'm9', threadId: 't9' },
            })
          }

          return new Response('{}', { status: 404 })
        })

        const build = (
          grants: Record<string, string> = {},
          priorParts: readonly unknown[] = [],
        ) => {
          return buildGoogleByoTools({
            db: {} as never,
            kv: {} as never,
            userId: 1,
            priorParts,
            grantedScopes: [
              'https://www.googleapis.com/auth/gmail.readonly',
              'https://www.googleapis.com/auth/gmail.compose',
              'https://www.googleapis.com/auth/drive.readonly',
            ],
            chatGrantHashes: grants,
            logger: { set: vi.fn() },
            fetchImpl: gmailFetch as never,
          })
        }
        const hash = (await build()).entries
          .get('google__gmail_search')!.descriptor.definitionHash!

        buildByo = build as typeof buildByo
        searchGrantHash = hash
        mocks.googleSend = await build({ google__gmail_search: hash })
      })

      it('reads a thread that the paused reply\'s own search found, once the '
        + 'user approves, with tools rebuilt for the continuation', async () => {
        const builtWith: Array<readonly unknown[]> = []

        mocks.googleSendFactory = async (input) => {
          const priorParts = input.priorParts ?? []

          builtWith.push(priorParts)

          return await buildByo(
            { google__gmail_search: searchGrantHash },
            priorParts,
          )
        }

        const paused = await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-g', 'google__gmail_search', {
              query: 'merger',
            }),
            toolCallChunks('call-r', 'google__gmail_read_thread', {
              threadId: 't1',
            }),
          ],
        })
        const [approvalId] = paused.approvalIds

        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          toolName: 'google__gmail_read_thread',
          rememberOptions: ['once'],
          summary: 'Read the email thread from 2025-11-21 in your Gmail',
        })
        expect(paused.assistantParts.find((part: any) => {
          return part.type === 'data-tool-approval'
            && part.data?.toolCallId === 'call-r'
        })).toMatchObject({
          data: {
            summary: 'Read the email thread from 2025-11-21 in your Gmail',
            link: 'https://mail.google.com/mail/#all/t1',
          },
        })

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Read it.')])
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )
        const update = mocks.updates.at(-1)!

        expect(builtWith.at(-1)!.some((part: any) => {
          return part?.type === 'tool-google__gmail_search'
        })).toBe(true)
        expect(prompt).toContain(MAIL_BODY)
        expect(outsideFrames(prompt)).not.toContain(MAIL_BODY)
        expect(findPart(update.parts, 'tool-google__gmail_read_thread'))
          .toMatchObject({
            state: 'output-available',
            output: { references: [{ id: 't1', kind: 'gmail-thread' }] },
          })
        expect(JSON.stringify(update.parts)).not.toContain(MAIL_BODY)
      })

      async function pauseAfterSearch() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-g', 'google__gmail_search', {
              query: 'merger',
            }),
            toolCallChunks('call-w', 'google__gmail_create_draft', {
              to: [{ email: 'alice@example.com' }],
              subject: 'Re: plans',
              body: 'Hello Alice',
            }),
          ],
        })
      }

      function draftPosts() {
        return gmailFetch.mock.calls.filter((call) => {
          return new URL(String(call[0])).pathname.endsWith('/drafts')
        })
      }

      it('stores the thread as a reference, keeps the framed mail in KV while '
        + 'the draft waits, and creates the draft once approved', async () => {
        const paused = await pauseAfterSearch()
        const { toolApprovalResultIdOf, toolApprovalResultKey } = await import(
          '~~/server/utils/tool-approval/kv'
        )
        const key = toolApprovalResultKey(
          await toolApprovalResultIdOf(paused.messagePublicId, 'call-g'),
        )
        const [approvalId] = paused.approvalIds
        const storedSearch = findPart(
          paused.assistantParts,
          'tool-google__gmail_search',
        )

        expect(storedSearch).toMatchObject({
          state: 'output-available',
          output: {
            bodyRemoved: true,
            references: [{
              id: 't1',
              kind: 'gmail-thread',
              link: 'https://mail.google.com/mail/#all/t1',
              date: '2025-11-21T10:00:00.000Z',
            }],
          },
        })
        expect(JSON.stringify(paused.assistantParts))
          .not.toContain(MAIL_SUBJECT)
        expect(JSON.stringify(paused.assistantParts))
          .not.toContain(MAIL_SENDER)
        expect(JSON.stringify(paused.assistantParts))
          .not.toContain(MAIL_SNIPPET)
        expect(mocks.kv.get(key)).toContain(MAIL_SUBJECT)
        expect(mocks.kv.get(key)).toContain('<untrusted_tool_result')
        expect(draftPosts()).toHaveLength(0)
        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          access: 'write',
          toolName: 'google__gmail_create_draft',
          rememberOptions: ['once'],
          summary: 'Create a Gmail draft "Re: plans" to alice@example.com',
        })

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Drafted it.')])
        const update = mocks.updates.at(-1)!
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(draftPosts()).toHaveLength(1)
        expect(prompt).toContain(MAIL_SUBJECT)
        expect(outsideFrames(prompt)).not.toContain(MAIL_SUBJECT)
        expect(outsideFrames(prompt)).not.toContain(MAIL_SENDER)
        expect(outsideFrames(prompt)).not.toContain(MAIL_SNIPPET)
        expect(prompt).not.toContain('#all/t1')
        expect(JSON.stringify(update.parts)).not.toContain(MAIL_SUBJECT)
        expect(findPart(update.parts, 'tool-google__gmail_create_draft'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{ id: 'r-1', kind: 'gmail-draft' }],
            },
          })
        expect(mocks.kv.has(key)).toBe(false)
      })

      it('gives the model no mail text at all when the stash is gone',
        async () => {
          const paused = await pauseAfterSearch()
          const kvModule = await import('~~/server/utils/tool-approval/kv')
          const { toolApprovalResultIdOf, toolApprovalResultKey } = kvModule

          mocks.kv.delete(toolApprovalResultKey(
            await toolApprovalResultIdOf(paused.messagePublicId, 'call-g'),
          ))

          const { doStream } = await answer(paused, [
            { approvalId: paused.approvalIds[0], approved: true },
          ])
          const prompt = JSON.stringify(
            (doStream.mock.calls[0]?.[0] as any)?.prompt,
          )

          expect(prompt).not.toContain(MAIL_SUBJECT)
          expect(prompt).not.toContain(MAIL_SENDER)
          expect(prompt).not.toContain(MAIL_SNIPPET)
          expect(prompt).toContain('could not be kept')
        })

      it('asks no approval for a draft whose subject smuggles a header, and '
        + 'creates nothing', async () => {
        const { inserts } = await request({
          servers: [linear],
          steps: [
            toolCallChunks('call-w', 'google__gmail_create_draft', {
              to: [{ email: 'alice@example.com' }],
              subject: 'Hi\r\nBcc: evil@example.com',
              body: 'Hello',
            }),
            textChunks('I could not make that draft.'),
          ],
          body: {
            model: MODEL_ID,
            tools: [],
            reasoning: 'off',
            connectorIds: ['conn-linear'],
            messages: [{
              id: USER_MESSAGE_ID,
              role: 'user',
              parts: [{ type: 'text', text: 'Draft it' }],
            }],
          },
        })
        const assistant = inserts.find(value => value.role === 'assistant')
        const draftPart = assistant!.parts.find((part: any) => {
          return part.toolCallId === 'call-w'
        })

        expect(draftPart).toMatchObject({
          type: 'dynamic-tool',
          toolName: 'google__gmail_create_draft',
          state: 'output-error',
        })
        expect(assistant!.parts.some((part: any) => {
          return part.type === 'data-tool-approval'
            || part.state === 'approval-requested'
        })).toBe(false)
        expect(draftPosts()).toHaveLength(0)
      })

      it('does not create the draft when the user denies it', async () => {
        const paused = await pauseAfterSearch()

        await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: false },
        ])

        expect(draftPosts()).toHaveLength(0)
      })

      it('gives the model no mail text when a round continues a reply that '
        + 'searched Gmail', async () => {
        mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')
        mocks.chatMessages.push(
          {
            id: 'row-user',
            publicId: USER_MESSAGE_ID,
            role: 'user',
            parts: [{ type: 'text', text: 'Go' }],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
          {
            id: 'row-assistant',
            publicId: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'step-start' },
              {
                type: 'tool-google__gmail_search',
                toolCallId: 'call-mail-1',
                state: 'output-available',
                input: { query: 'merger' },
                output: {
                  references: [{
                    id: 't1',
                    kind: 'gmail-thread',
                    title: MAIL_SUBJECT,
                    link: 'https://mail.google.com/mail/#all/t1',
                    date: '2025-11-21T10:00:00.000Z',
                  }],
                  bodyRemoved: true,
                  note: 'The content was not kept.',
                },
              },
              { type: 'text', text: 'Found it.' },
              {
                type: 'data-tool-budget',
                id: 'tool-budget-1',
                data: {
                  round: 1,
                  maxRounds: 10,
                  reason: 'steps',
                  model: MODEL_ID,
                  gateway: null,
                  reasoning: 'off',
                  connectorIds: ['conn-linear'],
                },
              },
            ],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
        )

        const { doStream } = await continueRound('assistant-1', 2, [
          textChunks('Carried on.'),
        ])
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt ?? [],
        )

        expect(prompt).toContain('t1')
        expect(outsideFrames(prompt)).not.toContain(MAIL_SUBJECT)
        expect(prompt).not.toContain('mail.google.com')
      })
    })

    describe('with the real Calendar tools', () => {
      const EVENT_TITLE = 'SECRET LAYOFF TITLE'
      const EVENT_NOTES = 'SECRET LAYOFF NOTES'
      const GUEST = 'eve@evil.example'
      const LISTED_EVENT_LINK_ID = 'eid=YWJjZGVm'
      const CREATED_EVENT_LINK_ID = 'eid=bmV3'
      const EVENT_LINK = `https://www.google.com/calendar/event?${LISTED_EVENT_LINK_ID}`
      const CREATED_EVENT_LINK = `https://www.google.com/calendar/event?${CREATED_EVENT_LINK_ID}`
      const FRAME = /<untrusted_tool_result[\s\S]*?<\/untrusted_tool_result>/g
      const NEW_EVENT = {
        title: 'Planning',
        start: '2026-12-01T10:00:00+01:00',
        end: '2026-12-01T11:00:00+01:00',
        timeZone: 'Europe/Berlin',
      }
      let calendarFetch: ReturnType<typeof vi.fn>
      let insertStatus = 200

      function outsideFrames(prompt: string): string {
        return prompt.replace(FRAME, '')
      }

      function eventPosts() {
        return calendarFetch.mock.calls.filter((call) => {
          return (call[1] as RequestInit | undefined)?.method === 'POST'
        })
      }

      async function pauseAfterListing() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-l', 'google__calendar_list_events', {
              from: '2026-12-01T00:00:00+01:00',
              to: '2026-12-08T00:00:00+01:00',
            }),
            toolCallChunks('call-w', 'google__calendar_create_event', NEW_EVENT),
          ],
        })
      }

      beforeEach(async () => {
        const { buildGoogleCalendarTools } = await import(
          '~~/server/utils/google/calendar-tools'
        )

        insertStatus = 200
        calendarFetch = vi.fn(async (input: string, init?: RequestInit) => {
          const url = new URL(input)

          if (url.pathname !== '/calendar/v3/calendars/primary/events') {
            return new Response('{}', { status: 404 })
          }

          if (init?.method === 'POST' && insertStatus !== 200) {
            return Response.json(
              { error: { errors: [{ reason: 'backendError' }] } },
              { status: insertStatus },
            )
          }

          if (init?.method === 'POST') {
            return Response.json({
              id: 'newevent123',
              htmlLink: CREATED_EVENT_LINK,
              start: { dateTime: NEW_EVENT.start },
            })
          }

          return Response.json({
            items: [{
              id: 'ev1',
              summary: EVENT_TITLE,
              description: EVENT_NOTES,
              start: { dateTime: '2026-12-02T10:00:00+01:00' },
              end: { dateTime: '2026-12-02T11:00:00+01:00' },
              htmlLink: EVENT_LINK,
              attendees: [{ email: GUEST }],
            }],
          })
        })

        const build = (grants: Record<string, string> = {}) => {
          return buildGoogleCalendarTools({
            db: {} as never,
            kv: {} as never,
            userId: 1,
            grantedScopes: [
              'https://www.googleapis.com/auth/calendar.events.owned',
              'https://www.googleapis.com/auth/calendar.events.freebusy',
            ],
            chatGrantHashes: grants,
            logger: { set: vi.fn() },
            fetchImpl: calendarFetch as never,
          })
        }
        const hash = (await build()).entries
          .get('google__calendar_list_events')!.descriptor.definitionHash!

        mocks.googleSendFactory = async () => {
          return await build({ google__calendar_list_events: hash })
        }
      })

      it('stores events as references, keeps the framed text in KV while the '
        + 'write waits, and creates one event once approved', async () => {
        const paused = await pauseAfterListing()
        const { toolApprovalResultIdOf, toolApprovalResultKey } = await import(
          '~~/server/utils/tool-approval/kv'
        )
        const key = toolApprovalResultKey(
          await toolApprovalResultIdOf(paused.messagePublicId, 'call-l'),
        )
        const [approvalId] = paused.approvalIds
        const { buildCalendarEventId } = await import(
          '~~/server/utils/google/calendar-api'
        )

        expect(findPart(paused.assistantParts, 'tool-google__calendar_list_events'))
          .toMatchObject({
            state: 'output-available',
            output: {
              bodyRemoved: true,
              references: [{
                id: 'ev1',
                kind: 'calendar-event',
                link: EVENT_LINK,
                date: '2026-12-02',
              }],
            },
          })
        expect(JSON.stringify(paused.assistantParts)).not.toContain(EVENT_TITLE)
        expect(JSON.stringify(paused.assistantParts)).not.toContain(EVENT_NOTES)
        expect(JSON.stringify(paused.assistantParts)).not.toContain(GUEST)
        expect(mocks.kv.get(key)).toContain(EVENT_TITLE)
        expect(mocks.kv.get(key)).toContain('<untrusted_tool_result')
        expect(eventPosts()).toHaveLength(0)
        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          access: 'write',
          toolName: 'google__calendar_create_event',
          rememberOptions: ['once'],
          summary: 'Create the Google Calendar event "Planning" on 2026-12-01',
          input: NEW_EVENT,
        })

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Created it.')])
        const update = mocks.updates.at(-1)!
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(eventPosts()).toHaveLength(1)
        expect(JSON.parse(Buffer.from(
          eventPosts()[0]![1].body as Uint8Array,
        ).toString())).toEqual({
          id: await buildCalendarEventId(`1:${approvalId}`),
          summary: 'Planning',
          start: { dateTime: NEW_EVENT.start, timeZone: 'Europe/Berlin' },
          end: { dateTime: NEW_EVENT.end, timeZone: 'Europe/Berlin' },
        })
        expect(String(eventPosts()[0]![0])).toContain('sendUpdates=none')
        expect(prompt).toContain(EVENT_TITLE)
        expect(outsideFrames(prompt)).not.toContain(EVENT_TITLE)
        expect(outsideFrames(prompt)).not.toContain(EVENT_NOTES)
        expect(outsideFrames(prompt)).not.toContain(GUEST)
        expect(prompt).not.toContain(LISTED_EVENT_LINK_ID)
        expect(prompt).not.toContain(CREATED_EVENT_LINK_ID)
        expect(prompt).toContain('Nobody was invited')
        expect(JSON.stringify(update.parts)).not.toContain(EVENT_TITLE)
        expect(findPart(update.parts, 'tool-google__calendar_create_event'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{
                id: 'newevent123',
                kind: 'calendar-event',
                date: '2026-12-01',
              }],
            },
          })
        expect(mocks.kv.has(key)).toBe(false)
      })

      it('gives the model no event text at all when the stash is gone',
        async () => {
          const paused = await pauseAfterListing()
          const kvModule = await import('~~/server/utils/tool-approval/kv')
          const { toolApprovalResultIdOf, toolApprovalResultKey } = kvModule

          mocks.kv.delete(toolApprovalResultKey(
            await toolApprovalResultIdOf(paused.messagePublicId, 'call-l'),
          ))

          const { doStream } = await answer(paused, [
            { approvalId: paused.approvalIds[0], approved: true },
          ])
          const prompt = JSON.stringify(
            (doStream.mock.calls[0]?.[0] as any)?.prompt,
          )

          expect(prompt).not.toContain(EVENT_TITLE)
          expect(prompt).not.toContain(EVENT_NOTES)
          expect(prompt).not.toContain(GUEST)
          expect(prompt).toContain('could not be kept')
        })

      it('tells the model an approved create that Google then fails may have '
        + 'made the event, and records the failure', async () => {
        const paused = await pauseAfterListing()

        insertStatus = 500

        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('It failed.')])
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )
        const part = findPart(
          mocks.updates.at(-1)!.parts,
          'tool-google__calendar_create_event',
        )

        expect(eventPosts()).toHaveLength(1)
        expect(prompt).toContain('may or may not have been created')
        expect(prompt).toContain('check their calendar before trying again')
        expect(prompt).not.toContain('Try again in a moment')
        expect(part).toMatchObject({ state: 'output-error' })
        expect(JSON.stringify(mocks.updates.at(-1)!.parts))
          .not.toContain(EVENT_TITLE)
      })

      it('does not create the event when the user denies it', async () => {
        const paused = await pauseAfterListing()

        await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: false },
        ])

        expect(eventPosts()).toHaveLength(0)
      })

      it('asks no approval for an event that cannot run, and creates '
        + 'nothing', async () => {
        const { inserts } = await request({
          servers: [linear],
          steps: [
            toolCallChunks('call-w', 'google__calendar_create_event', {
              ...NEW_EVENT,
              end: '2026-12-01T09:00:00+01:00',
            }),
            textChunks('I could not make that event.'),
          ],
          body: {
            model: MODEL_ID,
            tools: [],
            reasoning: 'off',
            connectorIds: ['conn-linear'],
            messages: [{
              id: USER_MESSAGE_ID,
              role: 'user',
              parts: [{ type: 'text', text: 'Add it' }],
            }],
          },
        })
        const assistant = inserts.find(value => value.role === 'assistant')

        expect(assistant!.parts.find((part: any) => {
          return part.toolCallId === 'call-w'
        })).toMatchObject({
          toolName: 'google__calendar_create_event',
          state: 'output-error',
        })
        expect(assistant!.parts.some((part: any) => {
          return part.type === 'data-tool-approval'
            || part.state === 'approval-requested'
        })).toBe(false)
        expect(eventPosts()).toHaveLength(0)
      })

      it('gives the model no event text when a round continues a reply '
        + 'that read the calendar', async () => {
        mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')
        mocks.chatMessages.push(
          {
            id: 'row-user',
            publicId: USER_MESSAGE_ID,
            role: 'user',
            parts: [{ type: 'text', text: 'Go' }],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
          {
            id: 'row-assistant',
            publicId: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'step-start' },
              {
                type: 'tool-google__calendar_list_events',
                toolCallId: 'call-cal-1',
                state: 'output-available',
                input: {
                  from: '2026-12-01T00:00:00+01:00',
                  to: '2026-12-08T00:00:00+01:00',
                },
                output: {
                  references: [{
                    id: 'ev1',
                    kind: 'calendar-event',
                    title: EVENT_TITLE,
                    link: EVENT_LINK,
                    date: '2026-12-02',
                  }],
                  bodyRemoved: true,
                  note: 'The content was not kept.',
                },
              },
              { type: 'text', text: 'Found it.' },
              {
                type: 'data-tool-budget',
                id: 'tool-budget-1',
                data: {
                  round: 1,
                  maxRounds: 10,
                  reason: 'steps',
                  model: MODEL_ID,
                  gateway: null,
                  reasoning: 'off',
                  connectorIds: ['conn-linear'],
                },
              },
            ],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
        )

        const { doStream } = await request({
          servers: [linear],
          steps: [textChunks('Carried on.')],
          body: { continue: { messageId: 'assistant-1', round: 2 } },
        })
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt ?? [],
        )

        expect(prompt).toContain('ev1')
        expect(outsideFrames(prompt)).not.toContain(EVENT_TITLE)
        expect(prompt).not.toContain(LISTED_EVENT_LINK_ID)
        expect(prompt).not.toContain(CREATED_EVENT_LINK_ID)
      })
    })

    describe('with the real Drive folder tools', () => {
      const FOLDER_NAME = 'SECRET FOLDER NAME'
      const ROOT_ID = 'real-root-id-0123456789'
      const FOLDER_ID = 'listed-folder-id-0123456'
      const GENERATED_ID = 'generated-id-0123456789'
      const FRAME = /<untrusted_tool_result[\s\S]*?<\/untrusted_tool_result>/g
      const NEW_FOLDER = { name: 'Reports', parentFolderId: FOLDER_ID }
      const SECOND_FOLDER_ID = 'second-folder-id-01234'
      let driveFetch: ReturnType<typeof vi.fn>
      let createStatus = 200
      let secondFolder = false

      function outsideFrames(prompt: string): string {
        return prompt.replace(FRAME, '')
      }

      function folderPosts() {
        return driveFetch.mock.calls.filter((call) => {
          return (call[1] as RequestInit | undefined)?.method === 'POST'
        })
      }

      async function pauseAfterListing() {
        return await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-l', 'google__drive_list_folder', {
              folderId: 'root',
            }),
            toolCallChunks(
              'call-w',
              'google__drive_create_folder',
              NEW_FOLDER,
            ),
          ],
        })
      }

      beforeEach(async () => {
        const { buildGoogleDriveWriteTools } = await import(
          '~~/server/utils/google/drive-write-tools'
        )
        const { createGoogleReferenceIndex } = await import(
          '~~/server/utils/google/chat-references'
        )
        const store = new Map<string, string>()
        const folder = {
          mimeType: 'application/vnd.google-apps.folder',
          ownedByMe: true,
          shared: false,
          trashed: false,
          capabilities: {
            canAddChildren: true,
            canRename: true,
            canMoveItemWithinDrive: true,
          },
        }

        createStatus = 200
        secondFolder = false
        driveFetch = vi.fn(async (input: string, init?: RequestInit) => {
          const url = new URL(input)

          if (init?.method === 'PATCH') {
            const sent = JSON.parse(
              Buffer.from(init.body as Uint8Array).toString() || '{}',
            )
            const added = url.searchParams.get('addParents')

            return Response.json({
              id: url.pathname.split('/').at(-1),
              name: sent.name ?? FOLDER_NAME,
              mimeType: folder.mimeType,
              parents: [added ?? ROOT_ID],
            })
          }

          if (url.pathname === '/drive/v3/files/generateIds') {
            return Response.json({ ids: [GENERATED_ID] })
          }

          if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
            if (createStatus !== 200) {
              return Response.json(
                { error: { errors: [{ reason: 'backendError' }] } },
                { status: createStatus },
              )
            }

            return Response.json({
              id: GENERATED_ID,
              name: 'Reports',
              mimeType: folder.mimeType,
              parents: [FOLDER_ID],
            })
          }

          if (url.pathname === '/drive/v3/files') {
            return Response.json({
              files: [
                { id: FOLDER_ID, name: FOLDER_NAME, ...folder },
                ...(secondFolder
                  ? [{ id: SECOND_FOLDER_ID, name: 'Archive', ...folder }]
                  : []),
              ],
            })
          }

          const id = url.pathname.split('/').at(-1)

          return Response.json({
            id: id === 'root' ? ROOT_ID : id,
            name: id === 'root' ? 'My Drive' : FOLDER_NAME,
            parents: id === 'root' ? [] : [ROOT_ID],
            ...folder,
          })
        })

        const build = (
          grants: Record<string, string> = {},
          priorParts: readonly unknown[] = [],
        ) => {
          return buildGoogleDriveWriteTools({
            db: {} as never,
            kv: {
              get: async (key: string) => store.get(key) ?? null,
              put: async (key: string, value: string) => {
                store.set(key, value)
              },
            } as never,
            userId: 1,
            grantedScopes: [
              'https://www.googleapis.com/auth/drive',
              'https://www.googleapis.com/auth/drive.readonly',
            ],
            chatGrantHashes: grants,
            index: createGoogleReferenceIndex([priorParts]),
            logger: { set: vi.fn() },
            fetchImpl: driveFetch as never,
          })
        }
        const hash = (await build()).entries
          .get('google__drive_list_folder')!.descriptor.definitionHash!

        mocks.googleSendFactory = async (input) => {
          return await build(
            { google__drive_list_folder: hash },
            input.priorParts,
          )
        }
      })

      it('shows the names the chat knows on the card, stores references '
        + 'only and creates one folder once approved', async () => {
        const paused = await pauseAfterListing()
        const [approvalId] = paused.approvalIds
        const approvalPart = paused.assistantParts.find((part: any) => {
          return part.type === 'data-tool-approval'
            && part.data.toolCallId === 'call-w'
        }) as any

        expect(findPart(paused.assistantParts, 'tool-google__drive_list_folder'))
          .toMatchObject({
            state: 'output-available',
            output: {
              bodyRemoved: true,
              references: [
                { id: ROOT_ID, kind: 'drive-root', title: 'My Drive' },
                {
                  id: FOLDER_ID,
                  kind: 'drive-folder',
                  title: FOLDER_NAME,
                  parentId: ROOT_ID,
                },
              ],
            },
          })
        expect(approvalPart.data).toMatchObject({
          rememberOptions: ['once'],
          summary: `Create the folder "Reports" inside "${FOLDER_NAME}" in `
            + 'your Google Drive',
          driveNames: { folder: { name: FOLDER_NAME, id: FOLDER_ID } },
        })
        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          access: 'write',
          toolName: 'google__drive_create_folder',
          rememberOptions: ['once'],
          input: NEW_FOLDER,
        })
        expect(folderPosts()).toHaveLength(0)

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Created it.')])
        const update = mocks.updates.at(-1)!
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(folderPosts()).toHaveLength(1)

        const body = JSON.parse(Buffer.from(
          folderPosts()[0]![1].body as Uint8Array,
        ).toString())

        expect(body).toMatchObject({
          id: GENERATED_ID,
          name: 'Reports',
          parents: [FOLDER_ID],
        })
        expect(Object.keys(body).sort()).toEqual([
          'appProperties',
          'id',
          'mimeType',
          'name',
          'parents',
        ])
        expect(prompt).toContain(FOLDER_NAME)
        expect(outsideFrames(prompt)).not.toContain(FOLDER_NAME)
        expect(prompt).toContain(GENERATED_ID)
        expect(prompt).not.toContain('drive.google.com')
        expect(findPart(update.parts, 'tool-google__drive_create_folder'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{
                id: GENERATED_ID,
                kind: 'drive-folder',
                title: 'Reports',
                parentId: FOLDER_ID,
              }],
            },
          })
      })

      it('does not create the folder when the user denies it', async () => {
        const paused = await pauseAfterListing()

        await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: false },
        ])

        expect(folderPosts()).toHaveLength(0)
      })

      it('tells the model an approved create that Google then fails may '
        + 'have made the folder', async () => {
        const paused = await pauseAfterListing()

        createStatus = 500

        const { doStream } = await answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ], [textChunks('It failed.')])
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(folderPosts()).toHaveLength(1)
        expect(prompt).toContain('may or may not have been created')
        expect(prompt).toContain('check their Google Drive before trying again')
      })

      function patchCalls() {
        return driveFetch.mock.calls.filter((call) => {
          return (call[1] as RequestInit | undefined)?.method === 'PATCH'
        })
      }

      it('renames a listed folder once approved: the card names the old name '
        + 'from the chat, one PATCH sends only the new name, and only a '
        + 'reference is stored', async () => {
        const paused = await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-l', 'google__drive_list_folder', {
              folderId: 'root',
            }),
            toolCallChunks('call-r', 'google__drive_rename', {
              itemId: FOLDER_ID,
              newName: 'Renamed',
            }),
          ],
        })
        const [approvalId] = paused.approvalIds
        const approvalPart = paused.assistantParts.find((part: any) => {
          return part.type === 'data-tool-approval'
            && part.data.toolCallId === 'call-r'
        }) as any

        expect(approvalPart.data).toMatchObject({
          rememberOptions: ['once'],
          summary: `Rename "${FOLDER_NAME}" to "Renamed" in your Google Drive`,
          driveNames: {
            item: { name: FOLDER_NAME, id: FOLDER_ID, kind: 'folder' },
          },
        })
        expect(readKvJson(`tool-approval:${approvalId}`)).toMatchObject({
          family: 'google',
          access: 'write',
          toolName: 'google__drive_rename',
          rememberOptions: ['once'],
          input: { itemId: FOLDER_ID, newName: 'Renamed' },
        })
        expect(patchCalls()).toHaveLength(0)

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Renamed it.')])
        const update = mocks.updates.at(-1)!
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )

        expect(patchCalls()).toHaveLength(1)
        expect(JSON.parse(Buffer.from(
          patchCalls()[0]![1].body as Uint8Array,
        ).toString())).toEqual({ name: 'Renamed' })
        expect(outsideFrames(prompt)).not.toContain(FOLDER_NAME)
        expect(prompt).not.toContain('drive.google.com')
        expect(findPart(update.parts, 'tool-google__drive_rename'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{
                id: FOLDER_ID,
                kind: 'drive-folder',
                title: 'Renamed',
                parentId: ROOT_ID,
              }],
            },
          })
      })

      it('moves a listed folder once approved: the card names the item and '
        + 'the target, one PATCH carries only the parents in its query',
      async () => {
        secondFolder = true

        const moveInput = {
          itemId: FOLDER_ID,
          fromFolderId: 'root',
          toFolderId: SECOND_FOLDER_ID,
        }
        const paused = await pauseTurn({
          servers: [linear],
          connectorIds: [],
          steps: [
            toolCallChunks('call-l', 'google__drive_list_folder', {
              folderId: 'root',
            }),
            toolCallChunks('call-m', 'google__drive_move', moveInput),
          ],
        })
        const [approvalId] = paused.approvalIds
        const approvalPart = paused.assistantParts.find((part: any) => {
          return part.type === 'data-tool-approval'
            && part.data.toolCallId === 'call-m'
        }) as any

        expect(approvalPart.data).toMatchObject({
          rememberOptions: ['once'],
          summary: `Move "${FOLDER_NAME}" from My Drive to "Archive" in your `
            + 'Google Drive',
          driveNames: {
            item: { name: FOLDER_NAME, id: FOLDER_ID, kind: 'folder' },
            to: { name: 'Archive', id: SECOND_FOLDER_ID, kind: 'folder' },
          },
        })
        expect(approvalPart.data.driveNames).not.toHaveProperty('from')
        expect(patchCalls()).toHaveLength(0)

        const { doStream } = await answer(paused, [
          { approvalId, approved: true },
        ], [textChunks('Moved it.')])
        const update = mocks.updates.at(-1)!
        const prompt = JSON.stringify(
          (doStream.mock.calls[0]?.[0] as any)?.prompt,
        )
        const [patchedUrl, patchedInit] = patchCalls()[0]! as [
          string,
          RequestInit,
        ]
        const parsed = new URL(patchedUrl)

        expect(patchCalls()).toHaveLength(1)
        expect(Buffer.from(patchedInit.body as Uint8Array).toString())
          .toBe('{}')
        expect(parsed.searchParams.get('addParents')).toBe(SECOND_FOLDER_ID)
        expect(parsed.searchParams.get('removeParents')).toBe(ROOT_ID)
        expect(outsideFrames(prompt)).not.toContain(FOLDER_NAME)
        expect(findPart(update.parts, 'tool-google__drive_move'))
          .toMatchObject({
            output: {
              bodyRemoved: true,
              references: [{
                id: FOLDER_ID,
                kind: 'drive-folder',
                parentId: SECOND_FOLDER_ID,
              }],
            },
          })
      })

      it('refuses a rename of an id the chat never returned without asking',
        async () => {
          const paused = await pauseTurn({
            servers: [linear],
            connectorIds: [],
            steps: [
              toolCallChunks('call-r', 'google__drive_rename', {
                itemId: 'unknown-item-id-0123456',
                newName: 'Renamed',
              }),
            ],
          })

          expect(paused.approvalIds).toHaveLength(0)
          expect(patchCalls()).toHaveLength(0)
        })
    })
  })

  describe('a chat that came to hold Google data while paused', () => {
    const UNCONFIRMED_GEMINI = 'gemini-3.8-flash'

    it('refuses the approval answer on its paused model and says how to go on',
      async () => {
        vi.stubGlobal('useChatProvider', vi.fn(() => ({
          provider: { id: 'google' },
          model: {
            id: UNCONFIRMED_GEMINI,
            name: 'Gemini 3.8 Flash',
            tools: [],
            toolCall: true,
            modalities: { input: ['text'], output: ['text'] },
          },
        })))

        const paused = await pauseCreateIssue()

        expect(readKvJson(`tool-approval:${paused.approvalIds[0]}`)?.snapshot)
          .toMatchObject({ model: UNCONFIRMED_GEMINI })

        mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

        await expect(answer(paused, [
          { approvalId: paused.approvalIds[0], approved: true },
        ])).rejects.toMatchObject({
          status: 403,
          message: expect.stringContaining('This reply cannot continue'),
          fix: expect.stringContaining('Send a new message'),
        })
        expect(linear.callCount('tools/call')).toBe(0)
      })

    it('lets the answer through on an allowed paused model', async () => {
      const paused = await pauseCreateIssue()

      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')

      const { doStream } = await answer(paused, [
        { approvalId: paused.approvalIds[0], approved: true },
      ])

      expect(doStream).toHaveBeenCalled()
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

  describe('long tool tasks (rounds)', () => {
    const LIST_ISSUES = 'mcp__linear__list_issues'

    function createWorkingModel() {
      let callIndex = 0
      const doStream = vi.fn(async (options: any) => {
        callIndex += 1

        const isForced = options?.toolChoice?.type === 'none'
          || !options?.tools?.length
        const chunks = isForced
          ? textChunks('Listed some issues, more to go.')
          : toolCallChunks(`call-${callIndex}`, LIST_ISSUES, {
            page: callIndex,
          })

        return { stream: simulateReadableStream({ chunks: chunks as any }) }
      })

      return { model: new MockLanguageModelV4({ doStream }), doStream }
    }

    async function continueRound(
      messageId: string,
      round: number,
      steps: Array<Array<Record<string, unknown>>> = [textChunks('Done.')],
    ) {
      return await request({
        servers: [linear],
        steps,
        body: { continue: { messageId, round } },
      })
    }

    it('ends a reply that ran out of steps with a budget part after a '
      + 'progress note', async () => {
      const scripted = createWorkingModel()
      const { inserts } = await request({
        servers: [linear],
        scripted,
        body: {
          model: MODEL_ID,
          tools: [],
          reasoning: 'off',
          connectorIds: ['conn-linear'],
          messages: [{
            id: USER_MESSAGE_ID,
            role: 'user',
            parts: [{ type: 'text', text: 'Go through every issue' }],
          }],
        },
      })
      const assistant = inserts.find(value => value.role === 'assistant')
      const lastCall = scripted.doStream.mock.calls.at(-1)?.[0] as any
      const system = JSON.stringify(lastCall?.prompt?.filter((message: any) => {
        return message.role === 'system'
      }))

      expect(linear.callCount('tools/call')).toBeGreaterThan(1)
      expect(system).toContain('The work continues right after this.')
      expect(assistant?.parts.at(-1)).toEqual({
        type: 'data-tool-budget',
        id: 'tool-budget-1',
        data: {
          round: 1,
          maxRounds: 10,
          reason: 'steps',
          model: MODEL_ID,
          gateway: null,
          reasoning: 'off',
          connectorIds: ['conn-linear'],
        },
      })
    })

    it('writes no budget part for a reply that answered by itself',
      async () => {
        const { inserts } = await request({
          servers: [linear],
          steps: [
            toolCallChunks('call-1', LIST_ISSUES, {}),
            textChunks('One issue.'),
          ],
          body: {
            model: MODEL_ID,
            tools: [],
            reasoning: 'off',
            connectorIds: ['conn-linear'],
            messages: [{
              id: USER_MESSAGE_ID,
              role: 'user',
              parts: [{ type: 'text', text: 'List issues' }],
            }],
          },
        })
        const assistant = inserts.find(value => value.role === 'assistant')

        expect(assistant?.parts.some((part: any) => {
          return part.type === 'data-tool-budget'
        })).toBe(false)
      })

    it('refuses a round that is not the next one, after a newer message, '
      + 'at the round limit, and when the flag is off', async () => {
      mocks.chatMessages.push(
        {
          id: 'row-user',
          publicId: USER_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Go' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
        {
          id: 'row-assistant',
          publicId: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Working.' },
            {
              type: 'data-tool-budget',
              id: 'tool-budget-1',
              data: {
                round: 1,
                maxRounds: 10,
                reason: 'steps',
                model: MODEL_ID,
                gateway: null,
                reasoning: 'off',
                connectorIds: ['conn-linear'],
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
      )

      await expect(continueRound('assistant-1', 3))
        .rejects.toMatchObject({ status: 409, code: 'TOOL_ROUND_STALE' })

      const assistant = mocks.chatMessages[1]!

      assistant.parts[1].data.round = 10

      await expect(continueRound('assistant-1', 11))
        .rejects.toMatchObject({ status: 400 })
      await expect(continueRound('assistant-1', 10))
        .rejects.toMatchObject({ status: 409, code: 'TOOL_ROUND_STALE' })

      assistant.parts[1].data.round = 1
      mocks.chatMessages.push({
        id: 'row-user-2',
        publicId: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'Newer' }],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date(),
      })

      await expect(continueRound('assistant-1', 2))
        .rejects.toMatchObject({ status: 409 })

      mocks.chatMessages.pop()
      mocks.flags = new Set(['connectors'])

      await expect(continueRound('assistant-1', 2))
        .rejects.toMatchObject({ status: 404 })
      expect(mocks.updates).toHaveLength(0)
    })

    it('refuses the next round on a refused model once the chat holds '
      + 'Google data', async () => {
      vi.stubGlobal('useChatProvider', vi.fn(() => ({
        provider: { id: 'google' },
        model: {
          id: 'gemini-3.8-flash',
          name: 'Gemini 3.8 Flash',
          tools: [],
          toolCall: true,
          modalities: { input: ['text'], output: ['text'] },
        },
      })))
      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')
      mocks.chatMessages.push(
        {
          id: 'row-user',
          publicId: USER_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Go' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
        {
          id: 'row-assistant',
          publicId: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Working.' },
            {
              type: 'data-tool-budget',
              id: 'tool-budget-1',
              data: {
                round: 1,
                maxRounds: 10,
                reason: 'steps',
                model: 'gemini-3.8-flash',
                gateway: null,
                reasoning: 'off',
                connectorIds: ['conn-linear'],
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
      )

      await expect(continueRound('assistant-1', 2)).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('This reply cannot continue'),
      })
      expect(mocks.updates).toHaveLength(0)
    })

    it('runs the next round into the same reply with the continue prompt',
      async () => {
        mocks.chatMessages.push(
          {
            id: 'row-user',
            publicId: USER_MESSAGE_ID,
            role: 'user',
            parts: [{ type: 'text', text: 'Go' }],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
          {
            id: 'row-assistant',
            publicId: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'step-start' },
              { type: 'text', text: 'Working on it.' },
              {
                type: 'data-tool-budget',
                id: 'tool-budget-1',
                data: {
                  round: 1,
                  maxRounds: 10,
                  reason: 'steps',
                  model: MODEL_ID,
                  gateway: null,
                  reasoning: 'off',
                  connectorIds: ['conn-linear'],
                },
              },
            ],
            tools: [],
            reasoning: 'off',
            usage: null,
            createdAt: new Date(),
          },
        )

        const { doStream } = await continueRound('assistant-1', 2, [
          textChunks('All issues listed.'),
        ])
        const prompt = (doStream.mock.calls[0]?.[0] as any)?.prompt ?? []
        const lastMessage = prompt.at(-1)
        const updated = mocks.updates.at(-1)!

        expect(lastMessage).toMatchObject({ role: 'user' })
        expect(JSON.stringify(lastMessage)).toContain('Continue the task')
        expect(updated.parts.map((part: any) => part.type)).toEqual([
          'step-start',
          'text',
          'data-tool-budget',
          'step-start',
          'text',
        ])
        expect(updated.parts.at(-1)).toMatchObject({
          text: 'All issues listed.',
        })
        expect(mocks.claims.get('round-assistant-1-2')).toMatchObject({
          messagePublicId: 'assistant-1',
        })
      })

    it('gives the model no Google file name when a round continues a reply '
      + 'that read a Drive file', async () => {
      mocks.chatGoogleDataAt = new Date('2026-11-22T10:00:00Z')
      mocks.chatMessages.push(
        {
          id: 'row-user',
          publicId: USER_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Go' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
        {
          id: 'row-assistant',
          publicId: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            {
              type: 'tool-google__drive_read_file',
              toolCallId: 'call-drive-1',
              state: 'output-available',
              input: { fileId: 'file-1' },
              output: {
                references: [{
                  id: 'drive-id-7',
                  kind: 'drive-file',
                  title: 'Secret Plan.md',
                  link: 'https://drive.google.com/open?id=drive-id-7',
                }],
                bodyRemoved: true,
                note: 'The content was not kept.',
              },
            },
            { type: 'text', text: 'Read it.' },
            {
              type: 'data-tool-budget',
              id: 'tool-budget-1',
              data: {
                round: 1,
                maxRounds: 10,
                reason: 'steps',
                model: MODEL_ID,
                gateway: null,
                reasoning: 'off',
                connectorIds: ['conn-linear'],
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
      )

      const { doStream } = await continueRound('assistant-1', 2, [
        textChunks('Carried on.'),
      ])
      const prompt = JSON.stringify(
        (doStream.mock.calls[0]?.[0] as any)?.prompt ?? [],
      )

      expect(prompt).toContain('drive-id-7')
      expect(prompt).not.toContain('Secret Plan')
      expect(prompt).not.toContain('open?id=drive-id-7')
      expect(JSON.stringify(mocks.updates.at(-1)!.parts))
        .toContain('Secret Plan.md')
    })

    it('never runs a round twice: a round that already started is '
      + 'interrupted', async () => {
      mocks.chatMessages.push(
        {
          id: 'row-user',
          publicId: USER_MESSAGE_ID,
          role: 'user',
          parts: [{ type: 'text', text: 'Go' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
        {
          id: 'row-assistant',
          publicId: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Working.' },
            {
              type: 'data-tool-budget',
              id: 'tool-budget-1',
              data: {
                round: 1,
                maxRounds: 10,
                reason: 'steps',
                model: MODEL_ID,
                gateway: null,
                reasoning: 'off',
                connectorIds: ['conn-linear'],
              },
            },
          ],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date(),
        },
      )
      mocks.claims.set('round-assistant-1-2', {
        approvalId: 'round-assistant-1-2',
        userId: 1,
        chatPublicId: CHAT_PUBLIC_ID,
        messagePublicId: 'assistant-1',
        status: 'claimed',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await expect(continueRound('assistant-1', 2)).rejects.toMatchObject({
        status: 409,
        code: 'TOOL_ROUND_STALE',
        message: 'This round was interrupted',
      })
      expect(mocks.updates).toHaveLength(0)
    })
  })
})
