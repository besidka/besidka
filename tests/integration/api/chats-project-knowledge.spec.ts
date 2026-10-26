import type { KnowledgeItem } from '#shared/types/project-knowledge.d'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import {
  CHAT_SEARCH_INSTRUCTION,
} from '../../../server/utils/ai/chat-search-tools'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'
import {
  KNOWLEDGE_MEDIA_TURN_TEXT,
} from '../../../server/utils/chats/model-turns'

const DIRECT_MODEL_ID = 'gpt-5-mini'
const GATEWAY_MODEL_ID = 'anthropic/claude-opus-5'
const PROJECT_INTERNAL_ID = 7
const ABOUT_ME_MARKER = 'ABOUT_ME_MARKER prefers short answers.'
const PROJECT_RULES = 'PROJECT_RULES answer in bullet points.'
const NOTE_TEXT = 'The Aurora launch date is the fifth of May. '
  + 'The Aurora budget is ten thousand euros.'
const USER_TEXT = 'When is the Aurora launch date?'
const ONE_MILLION_TOKENS = 1_000_000
const QWEN_SIZED_WINDOW = 262_144
const GATEWAY_FALLBACK_BUDGET = 8960
const IMAGE_SIZE_BYTES = 2048
const SMALL_WINDOW = 200_000
const LONG_TEXT_CHARS = 300_000

/**
 * Route-level wiring of project knowledge. Only the D1/R2 loader
 * (`send-data`) is replaced: the decision, the file index, the full block,
 * the MiniSearch searcher, the two tools with their real per-request budget,
 * pre-retrieval and the tool loop all run for real against an in-memory
 * pack. The loader mock is registered once at module level and its
 * implementation is reassigned per test, never re-registered.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  isChatSearchToolEnabled: false,
  isMemoryToolsEnabled: false,
  memoryWriteSawUntrustedResult: [] as boolean[],
  uiStreamOptions: [] as Array<Record<string, any>>,
  aiLoggerSet: vi.fn(),
  loadKnowledgeSendData: vi.fn(),
  ensureKnowledgePackFresh: vi.fn(),
  commitKnowledgeChange: vi.fn(),
  kvStore: new Map<string, string>(),
  kvGet: vi.fn(),
  kvPut: vi.fn(),
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
    toUIMessageStream: (
      options: Parameters<typeof actual.toUIMessageStream>[0],
    ) => {
      mocks.uiStreamOptions.push(options as Record<string, any>)

      return actual.toUIMessageStream(options)
    },
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: mocks.aiLoggerSet,
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

vi.mock('~~/server/utils/knowledge/send-data', () => ({
  loadKnowledgeSendData: (input: unknown) => {
    return mocks.loadKnowledgeSendData(input)
  },
}))

vi.mock('~~/server/utils/knowledge/pack', () => ({
  ensureKnowledgePackFresh: (input: unknown) => {
    return mocks.ensureKnowledgePackFresh(input)
  },
  commitKnowledgeChange: (input: unknown) => {
    return mocks.commitKnowledgeChange(input)
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
  isChatSearchToolEnabled: () => mocks.isChatSearchToolEnabled,
  isMemoryToolsEnabled: () => mocks.isMemoryToolsEnabled,
}))

vi.mock('~~/server/utils/memory/tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')

  return {
    getChatSearchTools: () => {
      return {
        tools: {
          search_chats: withFollowUpTurn(tool({
            description: 'Stub search_chats.',
            inputSchema: z.object({ query: z.string() }),
            async execute() {
              return { notice: 'Quoted history.', results: [] }
            },
          })),
        },
      }
    },
  }
})

vi.mock('~~/server/utils/memory/tools/memory-tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')

  return {
    getMemoryTools: (input: { budget: { untrustedResultSeen: boolean } }) => {
      return {
        tools: {
          memory_write: withFollowUpTurn(tool({
            description: 'Stub memory_write.',
            inputSchema: z.object({ title: z.string() }),
            async execute() {
              mocks.memoryWriteSawUntrustedResult.push(
                input.budget.untrustedResultSeen,
              )

              if (input.budget.untrustedResultSeen) {
                throw Object.assign(new Error('Untrusted content seen.'), {
                  status: 403,
                })
              }

              return { action: 'created' }
            },
          })),
        },
      }
    },
  }
})

interface ScenarioItem extends Partial<KnowledgeItem> {
  storageKey?: string | null
}

interface Scenario {
  mode?: 'auto' | 'full' | 'search' | null
  items?: ScenarioItem[]
  packText?: string
  version?: number
  packVersion?: number | null
  isPackUnreadable?: boolean
  packOmitsItemIds?: string[]
}

function createUsage(inputTokens = 10, outputTokens = 20) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  }
}

function createToolCallChunk(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
) {
  return {
    type: 'tool-call' as const,
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  }
}

function createToolStep(
  calls: Array<ReturnType<typeof createToolCallChunk>>,
  usage = createUsage(),
) {
  return [
    ...calls,
    {
      type: 'finish' as const,
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage,
    },
  ]
}

function createTextChunks(text: string, usage = createUsage()) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage,
    },
  ]
}

function createScriptedModel(steps: Array<Array<Record<string, unknown>>>) {
  let callCount = 0
  const doStream = vi.fn(async () => {
    const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

    callCount += 1

    return {
      stream: simulateReadableStream({ chunks: chunks as any }),
    }
  })

  return {
    model: new MockLanguageModelV4({ doStream }),
    doStream,
  }
}

function createKnowledgeItem(overrides: ScenarioItem = {}) {
  const counts = {
    latinChars: NOTE_TEXT.length,
    cyrillicChars: 0,
    otherChars: 0,
  }

  return {
    id: 'note-aurora',
    projectId: 'project-public-id',
    kind: 'note' as const,
    fileId: null,
    title: 'Aurora launch',
    description: 'Launch plan',
    relativePath: 'plans/aurora.md',
    folderId: null,
    mediaType: 'text/markdown',
    sizeBytes: null,
    pageCount: null,
    textBytes: NOTE_TEXT.length,
    ...counts,
    extractStatus: 'ready' as const,
    extractError: null,
    extractor: 'note' as const,
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    storageKey: null,
    ...overrides,
  }
}

function createSendData(scenario: Scenario) {
  const items = (scenario.items ?? [{}]).map(createKnowledgeItem)
  const textItems = items.filter((item) => {
    return !item.mediaType?.startsWith('image/')
      && !scenario.packOmitsItemIds?.includes(item.id)
  })
  const loadPack = vi.fn(async () => {
    if (scenario.isPackUnreadable) {
      return null
    }

    return {
      header: {
        type: 'header' as const,
        version: 3,
        builtAt: '2026-10-25T10:00:00.000Z',
        items: textItems.map((item) => {
          return { itemId: item.id, updatedAt: item.updatedAt, chunks: 1 }
        }),
      },
      lines: textItems.map((item) => {
        return {
          type: 'chunk' as const,
          itemId: item.id,
          ordinal: 0,
          breadcrumb: item.title,
          text: scenario.packText ?? NOTE_TEXT,
        }
      }),
    }
  })

  return {
    data: {
      state: {
        mode: scenario.mode ?? null,
        version: scenario.version ?? 3,
        packVersion: scenario.packVersion === undefined
          ? 2
          : scenario.packVersion,
      },
      items,
      loadPack,
    },
    loadPack,
  }
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

function createDb(input: {
  projectId: string | null
  messages: Array<Record<string, unknown>>
}) {
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
        userSettings: {
          findFirst: vi.fn(async () => ({
            memoryEnabled: false,
            chatSearchEnabled: true,
            memoryIncludeSensitive: false,
            aboutMe: ABOUT_ME_MARKER,
          })),
        },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: input.projectId,
            project: input.projectId
              ? {
                id: input.projectId,
                name: 'Aurora',
                instructions: PROJECT_RULES,
                memory: null,
                memoryStatus: 'idle',
                memoryMigratedAt: null,
                useAccountMemory: null,
              }
              : null,
            messages: input.messages,
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
  }
}

async function readClientChunks() {
  const stream = mocks.mergedStreams[0]

  if (!stream) {
    return []
  }

  const chunks: Array<Record<string, any>> = []

  for await (const chunk of stream as any) {
    chunks.push(chunk)
  }

  return chunks
}

function stubChatProvider(input: {
  toolCall?: boolean
  contextLength?: number
  inputModalities?: string[]
} = {}) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'openai' },
    model: {
      id: DIRECT_MODEL_ID,
      name: 'GPT-5 mini',
      tools: ['web_search', 'image_generation'],
      toolCall: input.toolCall ?? true,
      contextLength: input.contextLength ?? ONE_MILLION_TOKENS,
      maxOutputTokens: 128_000,
      modalities: {
        input: input.inputModalities ?? ['text'],
        output: ['text'],
      },
    },
  })))
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  scenario?: Scenario | null
  inProject?: boolean
  messages?: Array<Record<string, unknown>>
  providerTools?: Record<string, unknown>
  gateway?: { toolCall: boolean, contextLength?: number }
  userText?: string
  hasWaitUntil?: boolean
  awaitScheduled?: boolean
}) {
  const scheduledPromises: Promise<unknown>[] = []
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    scheduledPromises.push(promise)
  })
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: input.providerTools ?? {},
    providerOptions: {},
  })))
  vi.stubGlobal('useGateway', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
    generateChatTitle: vi.fn(),
    toolCall: input.gateway?.toolCall,
    contextLength: input.gateway?.contextLength,
  })))

  const handler = await getHandler()
  const { encodePublicId } = await import(
    '../../../server/utils/custom-db-types'
  )
  const sendData = input.scenario === null
    ? null
    : createSendData(input.scenario ?? {})

  mocks.loadKnowledgeSendData.mockImplementation(async () => {
    return sendData?.data ?? null
  })

  const created = createDb({
    projectId: input.inProject === false
      ? null
      : encodePublicId(PROJECT_INTERNAL_ID),
    messages: input.messages ?? [],
  })

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    ...(input.hasWaitUntil
      ? { context: { cloudflare: { context: { waitUntil } } } }
      : {}),
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: input.gateway ? GATEWAY_MODEL_ID : DIRECT_MODEL_ID,
      ...(input.gateway ? { gateway: 'openrouter' } : {}),
      tools: [],
      reasoning: 'off',
      messages: [{
        id: 'user-public-1',
        role: 'user',
        parts: [{ type: 'text', text: input.userText ?? USER_TEXT }],
      }],
    },
  } as any)

  await result.ready

  if (input.awaitScheduled !== false) {
    await Promise.all(scheduledPromises)
  }

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const userInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'user'
  })?.[0]
  const chunks = await readClientChunks()
  const writtenParts = result.writer.write.mock.calls.map(([part]: any) => {
    return part
  })

  return {
    doStream,
    assistantInsert,
    userInsert,
    chunks,
    writtenParts,
    loadPack: sendData?.loadPack,
    waitUntil,
  }
}

function readToolNames(callOptions: any): string[] {
  const tools = callOptions?.tools ?? []

  return tools.map((declaredTool: { name: string }) => declaredTool.name)
}

function readSystemPrompt(callOptions: any): string {
  const systemMessage = callOptions?.prompt?.find((message: any) => {
    return message.role === 'system'
  })

  return String(systemMessage?.content ?? '')
}

function readUserTurns(callOptions: any): any[] {
  return (callOptions?.prompt ?? []).filter((message: any) => {
    return message.role === 'user'
  })
}

function readTurnText(turn: any): string {
  return (turn?.content ?? [])
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text)
    .join('\n')
}

function readKnowledgeAttributes(): Record<string, any> {
  return mocks.aiLoggerSet.mock.calls
    .map(([fields]) => fields as Record<string, any>)
    .filter(fields => fields.attributes?.knowledge !== undefined)
    .reduce((merged, fields) => {
      return { ...merged, ...fields.attributes.knowledge }
    }, {} as Record<string, any>)
}

function findKnowledgeNotice(writtenParts: any[]) {
  return writtenParts.find((part) => {
    return part?.type === 'data-knowledge-notice'
  })
}

describe('project knowledge send-path wiring', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.isChatSearchToolEnabled = false
    mocks.isMemoryToolsEnabled = false
    mocks.memoryWriteSawUntrustedResult = []
    mocks.uiStreamOptions = []
    mocks.loadKnowledgeSendData.mockReset()
    mocks.ensureKnowledgePackFresh.mockReset()
    mocks.ensureKnowledgePackFresh.mockResolvedValue(undefined)
    mocks.commitKnowledgeChange.mockReset()
    mocks.commitKnowledgeChange.mockResolvedValue({
      version: 4,
      packVersion: 4,
    })

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
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
    vi.stubGlobal('convertFilesForAI', vi.fn(async (
      messages: Array<{ parts: Array<Record<string, unknown>> }>,
    ) => {
      return {
        messages: messages.map((message) => {
          return {
            ...message,
            parts: message.parts.map((part) => {
              return part.type === 'file'
                ? { ...part, url: 'data:image/png;base64,AAAA' }
                : part
            }),
          }
        }),
        missingFiles: [],
      }
    }))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    mocks.kvStore.clear()
    mocks.kvGet.mockReset()
    mocks.kvGet.mockImplementation(async (key: string) => {
      return mocks.kvStore.get(key) ?? null
    })
    mocks.kvPut.mockReset()
    mocks.kvPut.mockImplementation(async (key: string, value: string) => {
      mocks.kvStore.set(key, value)
    })
    vi.stubGlobal('useKV', () => ({
      get: mocks.kvGet,
      put: mocks.kvPut,
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    stubChatProvider()
  })

  it('injects the full block on a 1M direct model after the memory block '
    + 'and the project prompt and before the chat-search line', async () => {
    mocks.isChatSearchToolEnabled = true

    const { doStream, assistantInsert, loadPack } = await runSend({
      steps: [createTextChunks('The fifth of May.', createUsage(500, 40))],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any
    const systemPrompt = readSystemPrompt(callOptions)
    const aboutMeIndex = systemPrompt.indexOf('ABOUT_ME_MARKER')
    const projectIndex = systemPrompt.indexOf('PROJECT_RULES')
    const blockIndex = systemPrompt.indexOf('<project_knowledge>')
    const chatSearchIndex = systemPrompt.indexOf(CHAT_SEARCH_INSTRUCTION)

    expect(mocks.loadKnowledgeSendData).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, projectId: PROJECT_INTERNAL_ID }),
    )
    expect(loadPack).toHaveBeenCalledTimes(1)
    expect(aboutMeIndex).toBeGreaterThanOrEqual(0)
    expect(projectIndex).toBeGreaterThan(aboutMeIndex)
    expect(blockIndex).toBeGreaterThan(projectIndex)
    expect(chatSearchIndex).toBeGreaterThan(blockIndex)
    expect(systemPrompt).toContain(NOTE_TEXT)
    expect(systemPrompt).toContain('<document id="note-aurora"')
    expect(systemPrompt).not.toContain('search_project_knowledge')
    expect(readToolNames(callOptions)).toEqual(['search_chats'])
    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      mode: 'full',
      reason: 'within-budget',
      packStale: true,
    }))
    expect(assistantInsert?.usage).toEqual(expect.objectContaining({
      knowledgeTokens: expect.any(Number),
      firstStepInputTokens: 500,
      lastStepOutputTokens: 40,
    }))
    expect(assistantInsert?.usage.knowledgeTokens).toBeGreaterThan(0)
  })

  it('registers the two knowledge tools and the file index in search mode on '
    + 'a 262k model, with first and last step usage recorded', async () => {
    stubChatProvider({ contextLength: QWEN_SIZED_WINDOW })

    const { doStream, assistantInsert, loadPack } = await runSend({
      scenario: {
        items: [{ latinChars: 200_000, textBytes: 200_000 }],
      },
      steps: [
        createToolStep([
          createToolCallChunk('call-1', 'search_project_knowledge', {
            query: 'Aurora launch',
          }),
        ], createUsage(900, 15)),
        createTextChunks('The fifth of May.', createUsage(1400, 60)),
      ],
    })
    const firstCallOptions = doStream.mock.calls[0]?.[0] as any
    const systemPrompt = readSystemPrompt(firstCallOptions)
    const toolPart = assistantInsert?.parts.find((part: any) => {
      return part.type === 'tool-search_project_knowledge'
    })

    expect(readToolNames(firstCallOptions).sort()).toEqual([
      'read_project_knowledge',
      'search_project_knowledge',
    ])
    expect(systemPrompt).toContain('Project files the user uploaded')
    expect(systemPrompt).toContain('- [note-aurora] plans/aurora.md')
    expect(systemPrompt).toContain('search_project_knowledge')
    expect(systemPrompt).not.toContain('<project_knowledge>')
    expect(loadPack).toHaveBeenCalledTimes(1)
    expect(toolPart).toEqual(expect.objectContaining({
      state: 'output-available',
    }))
    expect(JSON.stringify(toolPart?.output)).toContain('fifth of May')
    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      mode: 'search',
      reason: 'over-budget',
      searchCalls: 1,
    }))
    expect(assistantInsert?.usage).toEqual(expect.objectContaining({
      inputTokens: 2300,
      knowledgeTokens: 0,
      firstStepInputTokens: 900,
      lastStepOutputTokens: 60,
    }))
  })

  it('assumes a 128k window for a gateway model without a catalog '
    + 'contextLength', async () => {
    const { doStream } = await runSend({
      gateway: { toolCall: true },
      steps: [createTextChunks('The fifth of May.')],
    })
    const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      mode: 'full',
      budget: GATEWAY_FALLBACK_BUDGET,
      contextWindowKnown: false,
    }))
    expect(systemPrompt).toContain('<project_knowledge>')
  })

  it('appends pre-retrieval excerpts to the current user turn on a '
    + 'forced-toolChoice send and persists none of them', async () => {
    const { doStream, userInsert } = await runSend({
      scenario: { mode: 'search' },
      providerTools: {
        tools: {
          generate_stub: tool({
            description: 'Stub forced tool.',
            inputSchema: z.object({}),
            async execute() {
              return { ok: true }
            },
          }),
        },
        toolChoice: { type: 'tool', toolName: 'generate_stub' },
      },
      steps: [createTextChunks('The fifth of May.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any
    const lastUserText = readTurnText(readUserTurns(callOptions).at(-1))

    expect(readToolNames(callOptions)).toEqual(['generate_stub'])
    expect(lastUserText).toContain(USER_TEXT)
    expect(lastUserText).toContain('<project_knowledge_excerpts>')
    expect(lastUserText).toContain('fifth of May')
    expect(readSystemPrompt(callOptions)).not.toContain(
      '<project_knowledge_excerpts>',
    )
    expect(userInsert?.parts).toEqual([
      { type: 'text', text: USER_TEXT },
    ])
    expect(JSON.stringify(userInsert)).not.toContain('project_knowledge')
  })

  it('uses pre-retrieval instead of tools on a tool-less model', async () => {
    stubChatProvider({ toolCall: false })

    const { doStream, userInsert } = await runSend({
      scenario: { mode: 'search' },
      steps: [createTextChunks('The fifth of May.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any
    const lastUserText = readTurnText(readUserTurns(callOptions).at(-1))

    expect(readToolNames(callOptions)).toEqual([])
    expect(lastUserText).toContain('<project_knowledge_excerpts>')
    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      preRetrieval: true,
    }))
    expect(JSON.stringify(userInsert)).not.toContain('project_knowledge')
  })

  it('turns the fourth knowledge call of one step into a 429 tool error and '
    + 'still answers', async () => {
    const parallelCalls = ['call-1', 'call-2', 'call-3', 'call-4']
      .map((toolCallId) => {
        return createToolCallChunk(toolCallId, 'search_project_knowledge', {
          query: 'Aurora',
        })
      })
    const { doStream, assistantInsert, chunks } = await runSend({
      scenario: { mode: 'search' },
      steps: [
        createToolStep(parallelCalls),
        createTextChunks('Answer after the knowledge budget.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const budgetErrorPart = parts.find((part: any) => {
      return part.toolCallId === 'call-4'
    })

    expect(budgetErrorPart).toEqual(expect.objectContaining({
      type: 'tool-search_project_knowledge',
      state: 'output-error',
    }))
    expect(budgetErrorPart?.errorText).toContain('"status":429')
    expect(parts.filter((part: any) => {
      return part.state === 'output-available'
    })).toHaveLength(3)
    expect(doStream).toHaveBeenCalledTimes(2)
    expect(chunks.map(chunk => chunk.type)).not.toContain('error')
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'text',
      text: 'Answer after the knowledge budget.',
    }))
  })

  it('falls back to search with a data-knowledge-notice when always-full '
    + 'does not fit the model', async () => {
    stubChatProvider({ contextLength: 8000 })

    const { doStream, writtenParts } = await runSend({
      scenario: {
        mode: 'full',
        items: [{ latinChars: 40_000, textBytes: 40_000 }],
      },
      steps: [createTextChunks('The fifth of May.')],
    })

    expect(findKnowledgeNotice(writtenParts)).toEqual({
      type: 'data-knowledge-notice',
      data: { modelName: 'GPT-5 mini', notice: 'full-does-not-fit' },
    })
    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      mode: 'search',
      reason: 'does-not-fit',
    }))
    expect(readToolNames(doStream.mock.calls[0]?.[0]).sort()).toEqual([
      'read_project_knowledge',
      'search_project_knowledge',
    ])
  })

  it('attaches no media on a non-vision model and says so', async () => {
    const { doStream, writtenParts } = await runSend({
      scenario: {
        items: [
          {},
          {
            id: 'image-diagram',
            kind: 'file',
            title: 'diagram.png',
            relativePath: 'plans/diagram.png',
            mediaType: 'image/png',
            sizeBytes: IMAGE_SIZE_BYTES,
            extractStatus: 'no-text',
            latinChars: 0,
            textBytes: 0,
            storageKey: 'user-1/diagram.png',
          },
        ],
      },
      steps: [createTextChunks('The fifth of May.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0] as any
    const userTurns = readUserTurns(callOptions)
    const filePartCount = userTurns.flatMap((turn: any) => turn.content)
      .filter((part: any) => part.type === 'file').length

    expect(userTurns).toHaveLength(1)
    expect(filePartCount).toBe(0)
    expect(JSON.stringify(callOptions.prompt))
      .not.toContain(KNOWLEDGE_MEDIA_TURN_TEXT)
    expect(findKnowledgeNotice(writtenParts)?.data.notice)
      .toBe('media-omitted')
  })

  it('leads the prompt with the media turn on a vision model', async () => {
    stubChatProvider({ inputModalities: ['text', 'image'] })

    const { doStream } = await runSend({
      scenario: {
        items: [
          {},
          {
            id: 'image-diagram',
            kind: 'file',
            title: 'diagram.png',
            relativePath: 'plans/diagram.png',
            mediaType: 'image/png',
            sizeBytes: IMAGE_SIZE_BYTES,
            extractStatus: 'no-text',
            latinChars: 0,
            textBytes: 0,
            storageKey: 'user-1/diagram.png',
          },
        ],
      },
      steps: [createTextChunks('The fifth of May.')],
    })
    const prompt = (doStream.mock.calls[0]?.[0] as any).prompt
      .filter((message: any) => message.role !== 'system')

    expect(prompt.map((message: any) => message.role))
      .toEqual(['user', 'assistant', 'user'])
    expect(readTurnText(prompt[0])).toBe(KNOWLEDGE_MEDIA_TURN_TEXT)
    expect(prompt[0].content.filter((part: any) => {
      return part.type === 'file'
    })).toHaveLength(1)
    expect(readTurnText(prompt[2])).toBe(USER_TEXT)
  })

  it('trips the memory_write lock after a knowledge tool result', async () => {
    mocks.isMemoryToolsEnabled = true

    const { assistantInsert } = await runSend({
      scenario: { mode: 'search' },
      steps: [
        createToolStep([
          createToolCallChunk('call-1', 'search_project_knowledge', {
            query: 'Aurora',
          }),
        ]),
        createToolStep([
          createToolCallChunk('call-2', 'memory_write', { title: 'Aurora' }),
        ]),
        createTextChunks('Not saved.'),
      ],
    })
    const memoryWritePart = assistantInsert?.parts.find((part: any) => {
      return part.toolCallId === 'call-2'
    })

    expect(mocks.memoryWriteSawUntrustedResult).toEqual([true])
    expect(memoryWritePart?.state).toBe('output-error')
  })

  it('measures history from the previous answer of the same token family',
    async () => {
      const previousMessages = [
        {
          id: 1,
          publicId: 'user-public-0',
          role: 'user',
          parts: [{ type: 'text', text: 'Earlier question' }],
          tools: [],
          reasoning: 'off',
          usage: null,
          createdAt: new Date('2026-10-25T09:00:00.000Z'),
        },
        {
          id: 2,
          publicId: 'assistant-public-0',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Earlier answer' }],
          tools: [],
          reasoning: 'off',
          usage: {
            model: DIRECT_MODEL_ID,
            provider: 'openai',
            inputTokens: 2_000_000,
            outputTokens: 1000,
            totalTokens: 2_001_000,
            firstStepInputTokens: 980_000,
            lastStepOutputTokens: 1000,
            knowledgeTokens: 0,
          },
          createdAt: new Date('2026-10-25T09:01:00.000Z'),
        },
      ]

      await runSend({
        messages: previousMessages,
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'search',
        reason: 'does-not-fit',
      }))
    })

  it('ignores a measured history from another token family', async () => {
    await runSend({
      messages: [{
        id: 2,
        publicId: 'assistant-public-0',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier answer' }],
        tools: [],
        reasoning: 'off',
        usage: {
          model: 'claude-opus-5',
          provider: 'anthropic',
          inputTokens: 980_000,
          outputTokens: 1000,
          totalTokens: 981_000,
          firstStepInputTokens: 980_000,
          lastStepOutputTokens: 1000,
          knowledgeTokens: 0,
        },
        createdAt: new Date('2026-10-25T09:01:00.000Z'),
      }],
      steps: [createTextChunks('The fifth of May.')],
    })

    expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
      mode: 'full',
      reason: 'within-budget',
    }))
  })

  describe('mode hysteresis across sends', () => {
    const KNOWLEDGE_IN_BAND = {
      items: [{ latinChars: 232_000, textBytes: 232_000 }],
    }

    function previousAnswer(knowledgeMode?: 'full' | 'search' | 'none') {
      return [{
        id: 2,
        publicId: 'assistant-public-0',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier answer' }],
        tools: [],
        reasoning: 'off',
        usage: {
          model: DIRECT_MODEL_ID,
          provider: 'openai',
          inputTokens: 500,
          outputTokens: 40,
          totalTokens: 540,
          ...(knowledgeMode ? { knowledgeMode } : {}),
        },
        createdAt: new Date('2026-10-25T09:01:00.000Z'),
      }]
    }

    it('keeps searching in the 85% to 100% band after a search send', async () => {
      const { assistantInsert } = await runSend({
        scenario: KNOWLEDGE_IN_BAND,
        messages: previousAnswer('search'),
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'search',
        reason: 'hysteresis',
        previousMode: 'search',
      }))
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        knowledgeMode: 'search',
        knowledgeTokens: 0,
      }))
    })

    it('stays full in the same band after a full send', async () => {
      const { assistantInsert } = await runSend({
        scenario: KNOWLEDGE_IN_BAND,
        messages: previousAnswer('full'),
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'full',
        reason: 'within-budget',
        previousMode: 'full',
      }))
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        knowledgeMode: 'full',
      }))
    })

    it('uses the plain budget rule for a chat that has no recorded mode', async () => {
      await runSend({
        scenario: KNOWLEDGE_IN_BAND,
        messages: previousAnswer(),
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'full',
        reason: 'within-budget',
        previousMode: null,
      }))
    })

    it('returns to full once the knowledge is under 85% of the budget', async () => {
      await runSend({
        scenario: { items: [{ latinChars: 200_000, textBytes: 200_000 }] },
        messages: previousAnswer('search'),
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'full',
        reason: 'within-budget',
      }))
    })
  })

  it('never loads knowledge for a chat outside a project', async () => {
    const { doStream, assistantInsert } = await runSend({
      inProject: false,
      steps: [createTextChunks('No project here.')],
    })

    expect(mocks.loadKnowledgeSendData).not.toHaveBeenCalled()
    expect(readSystemPrompt(doStream.mock.calls[0]?.[0]))
      .not.toContain('project_knowledge')
    expect(assistantInsert?.usage).not.toHaveProperty('knowledgeTokens')
    expect(assistantInsert?.usage).not.toHaveProperty('firstStepInputTokens')
  })

  it('keeps the send working when the knowledge data cannot be loaded',
    async () => {
      const { doStream, assistantInsert, writtenParts } = await runSend({
        scenario: null,
        steps: [createTextChunks('Answer without knowledge.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.loadKnowledgeSendData).toHaveBeenCalledTimes(1)
      expect(readToolNames(callOptions)).toEqual([])
      expect(readSystemPrompt(callOptions)).toContain('PROJECT_RULES')
      expect(readSystemPrompt(callOptions)).not.toContain('project_knowledge')
      expect(findKnowledgeNotice(writtenParts)).toBeUndefined()
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answer without knowledge.',
      }))
      expect(assistantInsert?.usage).not.toHaveProperty('knowledgeTokens')
    })

  describe('memory writes while knowledge documents are in the prompt', () => {
    function memoryWriteSteps() {
      return [
        createToolStep([
          createToolCallChunk('call-1', 'memory_write', { title: 'Aurora' }),
        ]),
        createTextChunks('Handled.'),
      ]
    }

    function findMemoryWritePart(assistantInsert: any) {
      return assistantInsert?.parts.find((part: any) => {
        return part.toolCallId === 'call-1'
      })
    }

    it('refuses memory_write on a full-mode send with documents', async () => {
      mocks.isMemoryToolsEnabled = true

      const { assistantInsert, doStream } = await runSend({
        steps: memoryWriteSteps(),
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toContain('<project_knowledge>')
      expect(systemPrompt).toContain('Saving to memory is unavailable')
      expect(mocks.memoryWriteSawUntrustedResult).toEqual([true])
      expect(findMemoryWritePart(assistantInsert)?.state)
        .toBe('output-error')
    })

    it('refuses memory_write on a full-mode send with media only', async () => {
      mocks.isMemoryToolsEnabled = true
      stubChatProvider({ inputModalities: ['text', 'image'] })

      const { assistantInsert, doStream } = await runSend({
        scenario: {
          items: [{
            id: 'image-diagram',
            kind: 'file',
            title: 'diagram.png',
            relativePath: 'plans/diagram.png',
            mediaType: 'image/png',
            sizeBytes: IMAGE_SIZE_BYTES,
            extractStatus: 'no-text',
            latinChars: 0,
            textBytes: 0,
            storageKey: 'user-1/diagram.png',
          }],
        },
        steps: memoryWriteSteps(),
      })
      const prompt = (doStream.mock.calls[0]?.[0] as any).prompt

      expect(JSON.stringify(prompt)).toContain(KNOWLEDGE_MEDIA_TURN_TEXT)
      expect(mocks.memoryWriteSawUntrustedResult).toEqual([true])
      expect(findMemoryWritePart(assistantInsert)?.state)
        .toBe('output-error')
    })

    it('still allows memory_write on a search-mode send with only the file '
      + 'index', async () => {
      mocks.isMemoryToolsEnabled = true

      const { assistantInsert, doStream } = await runSend({
        scenario: { mode: 'search' },
        steps: memoryWriteSteps(),
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toContain('<project_files>')
      expect(systemPrompt).not.toContain('<project_knowledge>')
      expect(mocks.memoryWriteSawUntrustedResult).toEqual([false])
      expect(findMemoryWritePart(assistantInsert)?.state)
        .toBe('output-available')
    })
  })

  describe('lazy pack loading', () => {
    it('never loads the pack in search mode without a tool call or '
      + 'pre-retrieval', async () => {
      const { loadPack, assistantInsert } = await runSend({
        scenario: { mode: 'search' },
        steps: [createTextChunks('No lookup needed.')],
      })

      expect(loadPack).not.toHaveBeenCalled()
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'No lookup needed.',
      }))
    })

    it('adds no excerpts when the message terms are not all in the '
      + 'documents', async () => {
      stubChatProvider({ toolCall: false })

      const { doStream, loadPack } = await runSend({
        scenario: { mode: 'search' },
        userText: 'When should the zebra party start?',
        steps: [createTextChunks('No excerpts.')],
      })
      const lastUserText = readTurnText(
        readUserTurns(doStream.mock.calls[0]?.[0]).at(-1),
      )

      expect(loadPack).toHaveBeenCalledTimes(1)
      expect(lastUserText).toBe('When should the zebra party start?')
      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        preRetrieval: false,
      }))
    })
  })

  describe('pack freshness on send', () => {
    const maintenanceInput = {
      userId: 1,
      projectId: PROJECT_INTERNAL_ID,
      logger: expect.anything(),
    }

    it('rebuilds a stale pack in the background and sends with the '
      + 'previous pack', async () => {
      const { doStream, loadPack } = await runSend({
        hasWaitUntil: true,
        scenario: { version: 4, packVersion: 3 },
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledTimes(1)
      expect(mocks.ensureKnowledgePackFresh)
        .toHaveBeenCalledWith(maintenanceInput)
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(loadPack).toHaveBeenCalledTimes(1)
      expect(readSystemPrompt(doStream.mock.calls[0]?.[0]))
        .toContain(NOTE_TEXT)
    })

    it('sends with the old pack and rebuilds in the background when items '
      + 'were added after it', async () => {
      const { doStream } = await runSend({
        hasWaitUntil: true,
        scenario: {
          mode: 'full',
          version: 5,
          packVersion: 4,
          items: [{}, { id: 'note-fresh', title: 'Fresh upload' }],
          packOmitsItemIds: ['note-fresh'],
        },
        steps: [createTextChunks('Answered from the old pack.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledTimes(1)
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(doStream).toHaveBeenCalledTimes(1)
      expect(systemPrompt).toContain(NOTE_TEXT)
      expect(systemPrompt).not.toContain('Fresh upload')
    })

    it('schedules a rebuild for a project that never built a pack',
      async () => {
        await runSend({
          hasWaitUntil: true,
          scenario: { version: 2, packVersion: null, isPackUnreadable: true },
          steps: [createTextChunks('No pack yet.')],
        })

        expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledTimes(1)
        expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      })

    it('does not wait for the background rebuild before answering',
      async () => {
        mocks.ensureKnowledgePackFresh.mockReturnValue(new Promise(() => {}))

        const { doStream, assistantInsert } = await runSend({
          hasWaitUntil: true,
          awaitScheduled: false,
          scenario: { version: 4, packVersion: 3 },
          steps: [createTextChunks('Answered right away.')],
        })

        expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledTimes(1)
        expect(doStream).toHaveBeenCalledTimes(1)
        expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
          type: 'text',
          text: 'Answered right away.',
        }))
      })

    it('skips silently without waitUntil on a stale pack', async () => {
      const { doStream } = await runSend({
        hasWaitUntil: false,
        scenario: { version: 4, packVersion: 3 },
        steps: [createTextChunks('No scheduler.')],
      })

      expect(doStream).toHaveBeenCalledTimes(1)
      expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
    })

    it('schedules a repair when the pointer is fresh but the pack reads '
      + 'back null, and still answers', async () => {
      const { doStream, assistantInsert } = await runSend({
        hasWaitUntil: true,
        scenario: { version: 3, packVersion: 3, isPackUnreadable: true },
        steps: [createTextChunks('Answered without the pack.')],
      })

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledTimes(1)
      expect(mocks.commitKnowledgeChange)
        .toHaveBeenCalledWith(maintenanceInput)
      expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
      expect(readSystemPrompt(doStream.mock.calls[0]?.[0]))
        .not.toContain('<project_knowledge>')
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answered without the pack.',
      }))
    })

    it('swallows a failed repair and logs it as packRepair without text',
      async () => {
        mocks.commitKnowledgeChange.mockRejectedValue(
          new Error('lease unavailable'),
        )

        const { assistantInsert } = await runSend({
          hasWaitUntil: true,
          scenario: { version: 3, packVersion: 3, isPackUnreadable: true },
          steps: [createTextChunks('Still answered.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          packRepair: { error: 'lease unavailable' },
        }))
        expect(assistantInsert?.parts).toContainEqual(
          expect.objectContaining({ type: 'text', text: 'Still answered.' }),
        )
      })

    it('throttles the repair per project for ten minutes', async () => {
      const scenario = {
        version: 3,
        packVersion: 3,
        isPackUnreadable: true,
      }

      await runSend({
        hasWaitUntil: true,
        scenario,
        steps: [createTextChunks('First send.')],
      })

      expect(mocks.kvPut).toHaveBeenCalledWith(
        `knowledge:repair:${PROJECT_INTERNAL_ID}`,
        expect.any(String),
        { expirationTtl: 600 },
      )

      mocks.aiLoggerSet.mockClear()

      await runSend({
        hasWaitUntil: true,
        scenario,
        steps: [createTextChunks('Second send.')],
      })

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledTimes(1)
      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        packRepair: { skipped: 'throttled' },
      }))
    })

    it('skips the repair and still answers when KV fails', async () => {
      mocks.kvGet.mockRejectedValue(new Error('kv unavailable'))

      const { assistantInsert } = await runSend({
        hasWaitUntil: true,
        scenario: { version: 3, packVersion: 3, isPackUnreadable: true },
        steps: [createTextChunks('KV is down.')],
      })

      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        packRepair: { error: 'kv unavailable' },
      }))
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'KV is down.',
      }))
    })

    it('does not throttle the stale-pointer rebuild', async () => {
      const scenario = { version: 4, packVersion: 3 }

      await runSend({
        hasWaitUntil: true,
        scenario,
        steps: [createTextChunks('First send.')],
      })
      await runSend({
        hasWaitUntil: true,
        scenario,
        steps: [createTextChunks('Second send.')],
      })

      expect(mocks.ensureKnowledgePackFresh).toHaveBeenCalledTimes(2)
      expect(mocks.kvPut).not.toHaveBeenCalledWith(
        `knowledge:repair:${PROJECT_INTERNAL_ID}`,
        expect.anything(),
        expect.anything(),
      )
    })

    it('schedules the repair once however often the pack is read',
      async () => {
        stubChatProvider({ toolCall: false })

        await runSend({
          hasWaitUntil: true,
          scenario: {
            mode: 'search',
            version: 3,
            packVersion: 3,
            isPackUnreadable: true,
          },
          steps: [createTextChunks('One repair only.')],
        })

        expect(mocks.commitKnowledgeChange).toHaveBeenCalledTimes(1)
      })

    it('schedules nothing for a fresh, readable pack', async () => {
      await runSend({
        hasWaitUntil: true,
        scenario: { version: 3, packVersion: 3 },
        steps: [createTextChunks('All fresh.')],
      })

      expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('schedules nothing for a project that has no knowledge version',
      async () => {
        await runSend({
          hasWaitUntil: true,
          scenario: { version: 0, packVersion: null, isPackUnreadable: true },
          steps: [createTextChunks('No version.')],
        })

        expect(mocks.ensureKnowledgePackFresh).not.toHaveBeenCalled()
        expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      })

    it('skips silently without waitUntil on a corrupt fresh pack',
      async () => {
        const { assistantInsert } = await runSend({
          hasWaitUntil: false,
          scenario: { version: 3, packVersion: 3, isPackUnreadable: true },
          steps: [createTextChunks('No scheduler.')],
        })

        expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
        expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
          type: 'text',
          text: 'No scheduler.',
        }))
      })
  })

  describe('prompt-cache stability', () => {
    it('sends a byte-identical system prompt and media turn on two '
      + 'consecutive sends', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-26T10:00:00.000Z'))
      stubChatProvider({ inputModalities: ['text', 'image'] })

      const scenario: Scenario = {
        items: [
          {},
          {
            id: 'image-diagram',
            kind: 'file',
            title: 'diagram.png',
            relativePath: 'plans/diagram.png',
            mediaType: 'image/png',
            sizeBytes: IMAGE_SIZE_BYTES,
            extractStatus: 'no-text',
            latinChars: 0,
            textBytes: 0,
            storageKey: 'user-1/diagram.png',
          },
        ],
      }
      const first = await runSend({
        scenario,
        steps: [createTextChunks('First answer.')],
      })

      vi.setSystemTime(new Date('2026-10-26T10:00:30.000Z'))

      const second = await runSend({
        scenario,
        steps: [createTextChunks('Second answer.')],
      })
      const firstPrompt = (first.doStream.mock.calls[0]?.[0] as any).prompt
      const secondPrompt = (second.doStream.mock.calls[0]?.[0] as any).prompt
      const withoutSystem = (prompt: any[]) => {
        return prompt.filter(message => message.role !== 'system')
      }

      expect(readSystemPrompt({ prompt: firstPrompt }))
        .toContain('<project_knowledge>')
      expect(readSystemPrompt({ prompt: secondPrompt }))
        .toBe(readSystemPrompt({ prompt: firstPrompt }))
      expect(JSON.stringify(withoutSystem(secondPrompt).slice(0, 2)))
        .toBe(JSON.stringify(withoutSystem(firstPrompt).slice(0, 2)))
      expect(JSON.stringify(withoutSystem(firstPrompt)[0]))
        .toContain(KNOWLEDGE_MEDIA_TURN_TEXT)
    })
  })

  describe('model-facing copies', () => {
    function readOriginalMessages(): any[] {
      return (mocks.uiStreamOptions[0]?.originalMessages ?? []) as any[]
    }

    it('leaves originalMessages untouched when media turns are added',
      async () => {
        stubChatProvider({ inputModalities: ['text', 'image'] })

        const { doStream } = await runSend({
          scenario: {
            items: [
              {},
              {
                id: 'image-diagram',
                kind: 'file',
                title: 'diagram.png',
                relativePath: 'plans/diagram.png',
                mediaType: 'image/png',
                sizeBytes: IMAGE_SIZE_BYTES,
                extractStatus: 'no-text',
                latinChars: 0,
                textBytes: 0,
                storageKey: 'user-1/diagram.png',
              },
            ],
          },
          steps: [createTextChunks('The fifth of May.')],
        })
        const promptRoles = (doStream.mock.calls[0]?.[0] as any).prompt
          .filter((message: any) => message.role !== 'system')
          .map((message: any) => message.role)
        const originalMessages = readOriginalMessages()

        expect(promptRoles).toEqual(['user', 'assistant', 'user'])
        expect(originalMessages).toHaveLength(1)
        expect(originalMessages[0].id).toBe('user-public-1')
        expect(originalMessages[0].parts).toEqual([
          { type: 'text', text: USER_TEXT },
        ])
      })

    it('leaves originalMessages untouched when excerpts are added',
      async () => {
        stubChatProvider({ toolCall: false })

        const { doStream } = await runSend({
          scenario: { mode: 'search' },
          steps: [createTextChunks('The fifth of May.')],
        })
        const lastUserText = readTurnText(
          readUserTurns(doStream.mock.calls[0]?.[0]).at(-1),
        )
        const originalMessages = readOriginalMessages()

        expect(lastUserText).toContain('<project_knowledge_excerpts>')
        expect(originalMessages).toHaveLength(1)
        expect(originalMessages[0].parts).toEqual([
          { type: 'text', text: USER_TEXT },
        ])
        expect(JSON.stringify(originalMessages))
          .not.toContain('project_knowledge')
      })
  })

  describe('history estimate', () => {
    const measuredAssistantUsage = {
      model: DIRECT_MODEL_ID,
      provider: 'openai',
      inputTokens: 900_000,
      outputTokens: 1000,
      totalTokens: 901_000,
      firstStepInputTokens: 900_000,
      lastStepOutputTokens: 1000,
      knowledgeTokens: 0,
    }

    function createStoredMessage(input: {
      id: number
      publicId: string
      role: 'user' | 'assistant'
      parts: Array<Record<string, unknown>>
      usage?: Record<string, unknown> | null
    }) {
      return {
        id: input.id,
        publicId: input.publicId,
        role: input.role,
        parts: input.parts,
        tools: [],
        reasoning: 'off',
        usage: input.usage ?? null,
        createdAt: new Date(`2026-10-25T09:0${input.id}:00.000Z`),
      }
    }

    function measuredRows(extraRows: Array<Record<string, unknown>> = []) {
      return [
        createStoredMessage({
          id: 1,
          publicId: 'user-public-0',
          role: 'user',
          parts: [{ type: 'text', text: 'Earlier question' }],
        }),
        createStoredMessage({
          id: 2,
          publicId: 'assistant-public-0',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Earlier answer' }],
          usage: measuredAssistantUsage,
        }),
        ...extraRows,
      ]
    }

    it('fits when the measured history leaves room', async () => {
      await runSend({
        messages: measuredRows(),
        steps: [createTextChunks('The fifth of May.')],
      })

      expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
        mode: 'full',
        reason: 'within-budget',
      }))
    })

    it('adds the user turns stored after the measured assistant message',
      async () => {
        await runSend({
          messages: measuredRows([
            createStoredMessage({
              id: 3,
              publicId: 'user-failed-1',
              role: 'user',
              parts: [{ type: 'text', text: 'a'.repeat(LONG_TEXT_CHARS) }],
            }),
          ]),
          steps: [createTextChunks('The fifth of May.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          mode: 'search',
          reason: 'does-not-fit',
        }))
      })

    it('excludes the message being sent from the unmeasured tail',
      async () => {
        await runSend({
          messages: measuredRows([
            createStoredMessage({
              id: 3,
              publicId: 'user-public-1',
              role: 'user',
              parts: [{ type: 'text', text: 'a'.repeat(LONG_TEXT_CHARS) }],
            }),
          ]),
          steps: [createTextChunks('The fifth of May.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          mode: 'full',
          reason: 'within-budget',
        }))
      })

    describe('estimated path', () => {
      function earlierFileRows(parts: Array<Record<string, unknown>>) {
        return [
          createStoredMessage({
            id: 1,
            publicId: 'user-public-0',
            role: 'user',
            parts: [{ type: 'text', text: 'Look at these' }, ...parts],
          }),
          createStoredMessage({
            id: 2,
            publicId: 'assistant-public-0',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Seen' }],
          }),
        ]
      }

      function createImageParts(count: number) {
        return Array.from({ length: count }, (_unused, index) => {
          return {
            type: 'file',
            mediaType: 'image/png',
            url: `/files/user-1/image-${index}.png`,
            filename: `image-${index}.png`,
          }
        })
      }

      beforeEach(() => {
        stubChatProvider({ contextLength: SMALL_WINDOW })
      })

      it('fits with a short text-only history', async () => {
        await runSend({
          messages: earlierFileRows([]),
          steps: [createTextChunks('The fifth of May.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          mode: 'full',
          reason: 'within-budget',
        }))
      })

      it('counts 1600 tokens per earlier image part', async () => {
        await runSend({
          messages: earlierFileRows(createImageParts(120)),
          steps: [createTextChunks('The fifth of May.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          mode: 'search',
          reason: 'does-not-fit',
        }))
      })

      it('counts a few earlier image parts without flipping the mode',
        async () => {
          await runSend({
            messages: earlierFileRows(createImageParts(3)),
            steps: [createTextChunks('The fifth of May.')],
          })

          expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
            mode: 'full',
            reason: 'within-budget',
          }))
        })

      it('counts an earlier non-image file by its byte size', async () => {
        vi.stubGlobal('convertFilesForAI', vi.fn(async (
          messages: Array<{ parts: Array<Record<string, unknown>> }>,
        ) => {
          return {
            messages: messages.map((message) => {
              return {
                ...message,
                parts: message.parts.map((part) => {
                  return part.type === 'file'
                    ? {
                      ...part,
                      url: `data:application/pdf;base64,${'A'.repeat(1_000_000)}`,
                    }
                    : part
                }),
              }
            }),
            missingFiles: [],
          }
        }))

        await runSend({
          messages: earlierFileRows([{
            type: 'file',
            mediaType: 'application/pdf',
            url: '/files/user-1/contract.pdf',
            filename: 'contract.pdf',
          }]),
          steps: [createTextChunks('The fifth of May.')],
        })

        expect(readKnowledgeAttributes()).toEqual(expect.objectContaining({
          mode: 'search',
          reason: 'does-not-fit',
        }))
      })
    })
  })
})
