import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { TOOL_APPROVAL_DATA_PART_TYPE } from '#shared/utils/tool-approval-parts'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const MODEL_ID = 'gpt-5-mini'
const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const OTHER_SLUG = '01HZXBBBBBBBBBBBBBBBBBBBBB'
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
  toolCall: true,
  besidkaModes: new Map<string, string>(),
  besidkaSettings: null as null | {
    enabled: boolean
    alwaysAllowTools: Record<string, string>
  },
  besidkaSettingWrites: [] as boolean[],
  listMcpProjects: null as null | ReturnType<typeof import('vitest').vi.fn>,
  moveMcpChatsToProject: null as null | ReturnType<
    typeof import('vitest').vi.fn
  >,
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

vi.mock('~~/server/utils/besidka-tools/chat-settings', () => ({
  readBesidkaChatSettings: async () => {
    return mocks.besidkaSettings ?? { enabled: true, alwaysAllowTools: {} }
  },
  setBesidkaChatEnabled: async (
    _db: unknown,
    _userId: number,
    _chatPublicId: string,
    enabled: boolean,
  ) => {
    mocks.besidkaSettingWrites.push(enabled)
    mocks.besidkaSettings = {
      alwaysAllowTools: {},
      ...mocks.besidkaSettings,
      enabled,
    }

    return mocks.besidkaSettings
  },
  addBesidkaChatGrant: async () => undefined,
}))

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
        return [toolName, mocks.besidkaModes.get(toolName) ?? 'ask']
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

vi.mock('~~/server/utils/mcp/private/chat-actions', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/mcp/private/chat-actions')
  >()

  return {
    ...actual,
    moveMcpChatsToProject: (...args: unknown[]) => {
      return mocks.moveMcpChatsToProject?.(...args)
    },
  }
})

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

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  besidkaToolsEnabled?: boolean
  messageId?: string
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))

  const handler = (await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )).default
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: MODEL_ID,
      tools: [],
      reasoning: 'off',
      ...(input.besidkaToolsEnabled === undefined
        ? {}
        : { besidkaToolsEnabled: input.besidkaToolsEnabled }),
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

function writtenChunks(): Array<Record<string, any>> {
  return mocks.writers.flatMap(writer => writer.write.mock.calls)
    .map(([chunk]) => chunk)
}

function findPart(parts: Array<Record<string, any>>, type: string) {
  return parts.find(part => part.type === type)
}

describe('Besidka tools in the chat send', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.writers = []
    mocks.flags = new Set(['tool-approvals', 'besidka-tools'])
    mocks.toolCall = true
    mocks.besidkaModes = new Map()
    mocks.besidkaSettings = null
    mocks.besidkaSettingWrites = []
    mocks.listMcpProjects = vi.fn(async () => ({
      projects: [{ id: 'prj_1', name: 'Launch' }],
      nextCursor: null,
    }))
    mocks.moveMcpChatsToProject = vi.fn(async () => ({ moved: [] }))
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
        toolCall: mocks.toolCall,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
  })

  function readToolNames(callOptions: any): string[] {
    return (callOptions?.tools ?? []).map((tool: { name: string }) => {
      return tool.name
    })
  }

  function firstCallToolNames(doStream: ReturnType<typeof vi.fn>): string[] {
    return readToolNames(doStream.mock.calls[0]?.[0]).filter((name) => {
      return name.startsWith('besidka__')
    })
  }

  function noticeLines(): string[] {
    return writtenChunks()
      .filter(chunk => chunk.type === 'data-connectors-notice')
      .flatMap(chunk => chunk.data.lines)
  }

  function allModes(mode: 'blocked' | 'ask' | 'allow') {
    return [
      'list_shared_chats', 'list_projects', 'get_project',
      'read_project_knowledge_item', 'list_files', 'read_file',
      'get_settings', 'list_my_features', 'list_artifacts', 'get_artifact',
      'list_artifact_shares', 'update_chat', 'move_chats_to_project',
      'branch_chat', 'create_project', 'update_project',
      'update_project_knowledge_item', 'create_file', 'rename_file',
      'delete_chats', 'delete_chat_message', 'delete_project',
      'delete_project_knowledge_items', 'delete_files', 'delete_artifacts',
      'revoke_chat_shares', 'revoke_artifact_shares', 'share_artifact',
      'update_project_instructions', 'add_project_note', 'add_project_text',
      'update_settings',
    ].map(name => [name, mode] as const)
  }

  function setModes(
    overrides: Record<string, 'blocked' | 'ask' | 'allow'>,
    fallback: 'blocked' | 'ask' | 'allow' = 'blocked',
  ) {
    mocks.besidkaModes = new Map([
      ...allModes(fallback),
      ...Object.entries(overrides),
    ])
  }

  const finalAnswer = [textChunks('Done.')]

  it('offers Besidka tools when every gate passes', async () => {
    setModes({ list_projects: 'ask' })

    const { doStream } = await runSend({ steps: finalAnswer })
    const system = JSON.stringify(doStream.mock.calls[0]?.[0]?.prompt)

    expect(firstCallToolNames(doStream)).toEqual(['besidka__list_projects'])
    expect(system).toContain('besidka__')
    expect(system).toContain('untrusted_tool_result')
  })

  it.each([
    ['tool approvals only', ['tool-approvals']],
    ['the Besidka tools opt-in only', ['besidka-tools']],
    ['neither flag', []],
  ])('offers no Besidka tool with %s', async (_label, flags) => {
    setModes({ list_projects: 'ask' })
    mocks.flags = new Set(flags)

    const { doStream } = await runSend({ steps: finalAnswer })

    expect(firstCallToolNames(doStream)).toEqual([])
  })

  it('offers nothing in a chat with Besidka switched off, and on a model '
    + 'without tool calling', async () => {
    setModes({ list_projects: 'ask' })
    mocks.besidkaSettings = { enabled: false, alwaysAllowTools: {} }

    const switchedOff = await runSend({ steps: finalAnswer })

    expect(firstCallToolNames(switchedOff.doStream)).toEqual([])

    mocks.besidkaSettings = null
    mocks.toolCall = false

    const noTools = await runSend({ steps: finalAnswer })

    expect(firstCallToolNames(noTools.doStream)).toEqual([])
  })

  it('stores the choice a new chat\'s first send carries', async () => {
    setModes({ list_projects: 'ask' })

    const { doStream } = await runSend({
      steps: finalAnswer,
      besidkaToolsEnabled: false,
    })

    expect(mocks.besidkaSettingWrites).toEqual([false])
    expect(firstCallToolNames(doStream)).toEqual([])
  })

  it('never offers a Blocked tool and denies a call to it', async () => {
    setModes({ list_projects: 'blocked', list_files: 'ask' })

    const { doStream, assistantInsert } = await runSend({
      steps: [
        toolCallChunks('call-1', 'besidka__list_projects', {}),
        textChunks('I cannot list them.'),
      ],
    })

    expect(firstCallToolNames(doStream)).toEqual(['besidka__list_files'])
    expect(mocks.listMcpProjects).not.toHaveBeenCalled()
    expect(JSON.stringify(assistantInsert?.parts ?? []))
      .not.toContain('"state":"output-available"')
  })

  it('asks before a read in Needs approval and stores the Besidka record',
    async () => {
      setModes({ list_projects: 'ask' })

      const { assistantInsert } = await runSend({
        steps: [
          toolCallChunks('call-1', 'besidka__list_projects', {}),
          textChunks('Never reached.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []
      const toolPart = findPart(parts, 'tool-besidka__list_projects')

      expect(mocks.listMcpProjects).not.toHaveBeenCalled()
      expect(toolPart).toMatchObject({ state: 'approval-requested' })
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
        data: {
          toolName: 'besidka__list_projects',
          reason: 'default',
          summary: 'List my projects',
          rememberOptions: ['once', 'chat', 'always'],
        },
      })
      expect(readKvJson(`tool-approval:${toolPart.approval.id}`))
        .toMatchObject({
          family: 'besidka',
          access: 'read',
          toolName: 'besidka__list_projects',
          connectorId: null,
          definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          summary: 'List my projects',
        })
    })

  it('runs Always allow in an untainted send and asks after the read',
    async () => {
      setModes({ list_projects: 'allow', list_files: 'allow' })

      const { assistantInsert } = await runSend({
        steps: [
          toolCallChunks('call-1', 'besidka__list_projects', {}),
          toolCallChunks('call-2', 'besidka__list_files', {}),
          textChunks('Never reached.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(mocks.listMcpProjects).toHaveBeenCalledTimes(1)
      expect(findPart(parts, 'tool-besidka__list_projects')).toMatchObject({
        state: 'output-available',
        output: expect.stringContaining(
          '<untrusted_tool_result connector="besidka"',
        ),
      })
      expect(findPart(parts, 'data-tool-grant')).toMatchObject({
        data: { toolCallId: 'call-1', scope: 'always' },
      })
      expect(findPart(parts, TOOL_APPROVAL_DATA_PART_TYPE)).toMatchObject({
        data: {
          toolCallId: 'call-2',
          reason: 'untrusted-output',
          rememberOptions: ['once'],
        },
      })
    })

  it('asks Allow once or Deny only before a delete', async () => {
    setModes({ delete_chats: 'ask' })

    const { assistantInsert } = await runSend({
      steps: [
        toolCallChunks('call-1', 'besidka__delete_chats', {
          slugs: [OTHER_SLUG],
        }),
        textChunks('Never reached.'),
      ],
    })

    expect(findPart(assistantInsert?.parts ?? [], TOOL_APPROVAL_DATA_PART_TYPE))
      .toMatchObject({
        data: {
          reason: 'always-ask',
          summary: `Delete 1 chat: ${OTHER_SLUG}`,
          rememberOptions: ['once'],
        },
      })
  })

  it('refuses to move the current chat with a plain tool error', async () => {
    setModes({ move_chats_to_project: 'allow' })

    const { assistantInsert } = await runSend({
      steps: [
        toolCallChunks('call-1', 'besidka__move_chats_to_project', {
          slugs: [CHAT_SLUG],
          projectId: null,
        }),
        textChunks('I could not move it.'),
      ],
    })

    expect(mocks.moveMcpChatsToProject).not.toHaveBeenCalled()
    expect(findPart(
      assistantInsert?.parts ?? [],
      'tool-besidka__move_chats_to_project',
    )).toMatchObject({
      state: 'output-error',
      errorText: expect.stringContaining('chat you are in'),
    })
  })

  it('offers 16 tools at most, read first, and names the rest in a notice',
    async () => {
      setModes({ rename_file: 'allow' }, 'ask')

      const { doStream } = await runSend({ steps: finalAnswer })
      const names = firstCallToolNames(doStream)

      expect(names).toHaveLength(16)
      expect(names).toContain('besidka__rename_file')
      expect(names).toContain('besidka__list_projects')
      expect(names).not.toContain('besidka__delete_chats')
      expect(noticeLines()).toEqual([
        expect.stringMatching(/^16 Besidka tools were left out/),
      ])
    })
})
