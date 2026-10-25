import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import { CHAT_SEARCH_INSTRUCTION } from '../../../server/utils/ai/chat-search-tools'
import { MEMORY_TOOL_NOTICE } from '../../../server/utils/memory/tools/memory-constants'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

const MODEL_ID = 'gpt-5-mini'
const PROVIDER_ID = 'openai'
const GATEWAY_MODEL_ID = 'anthropic/claude-opus-5'
const USER_MESSAGE_ID = 'user-public-1'
const USER_MESSAGE_TEXT = 'Please remember that I like pasta.'
const ABOUT_ME_TEXT = 'I am a backend developer. Answer concisely.'
const PROJECT_INSTRUCTIONS = 'Always answer in a formal tone.'
const SEARCH_QUERY = 'launch plan'

/**
 * Route-level wiring of the memory index, the `aboutMe` block and the memory
 * tools. The two tool factories are stubs that keep the real shared budget,
 * so the settings gates, the budget sharing and the instruction order are
 * genuine while D1 access for the tools is not needed (the real tools have
 * their own database-backed spec). The index loader, the settings loader and
 * `buildChatInstructions` run unmocked over a scripted `db.query`.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  chatSearchToolsInputs: [] as Array<Record<string, any>>,
  memoryToolsInputs: [] as Array<Record<string, any>>,
  aiLoggerSet: vi.fn(),
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

vi.mock('~~/server/utils/memory/tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')
  const { consumeChatSearchCall } = await import(
    '~~/server/utils/memory/tools/chat-search-budget'
  )

  return {
    getChatSearchTools: (input: Record<string, any>) => {
      mocks.chatSearchToolsInputs.push(input)

      return {
        tools: {
          search_chats: withFollowUpTurn(tool({
            description: 'Stub search_chats.',
            inputSchema: z.object({ query: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return { notice: 'Quoted history.', results: [] }
            },
          })),
          read_chat: withFollowUpTurn(tool({
            description: 'Stub read_chat.',
            inputSchema: z.object({ chatId: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return { notice: 'Quoted history.', chatId: 'chat-earlier' }
            },
          })),
        },
      }
    },
  }
})

vi.mock('~~/server/utils/memory/tools/memory-tools', async () => {
  const { withFollowUpTurn } = await import('~~/server/utils/ai/tool-loop')
  const { consumeChatSearchCall } = await import(
    '~~/server/utils/memory/tools/chat-search-budget'
  )

  return {
    getMemoryTools: (input: Record<string, any>) => {
      mocks.memoryToolsInputs.push(input)

      const readTools = {
        memory_list: withFollowUpTurn(tool({
          description: 'Stub memory_list.',
          inputSchema: z.object({}),
          async execute() {
            consumeChatSearchCall(input.budget)

            return { notice: MEMORY_TOOL_NOTICE, entries: [] }
          },
        })),
        memory_read: withFollowUpTurn(tool({
          description: 'Stub memory_read.',
          inputSchema: z.object({ id: z.string() }),
          async execute() {
            consumeChatSearchCall(input.budget)

            return {
              notice: MEMORY_TOOL_NOTICE,
              entry: {
                id: 'entry-1',
                handle: 'topics/pasta',
                scope: 'account',
                category: 'topics',
                title: 'Pasta',
                description: 'Likes pasta',
                body: 'Likes pasta.',
              },
            }
          },
        })),
      }

      if (!input.userMessageText) {
        return { tools: readTools }
      }

      return {
        tools: {
          ...readTools,
          memory_write: withFollowUpTurn(tool({
            description: 'Stub memory_write.',
            inputSchema: z.object({ title: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return { notice: MEMORY_TOOL_NOTICE, action: 'created' }
            },
          })),
          memory_forget: withFollowUpTurn(tool({
            description: 'Stub memory_forget.',
            inputSchema: z.object({ id: z.string() }),
            async execute() {
              consumeChatSearchCall(input.budget)

              return { notice: MEMORY_TOOL_NOTICE, removed: {} }
            },
          })),
        },
      }
    },
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
    outputTokens: {
      total: 20,
      text: 20,
      reasoning: undefined,
    },
  }
}

function createToolCallChunks(
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
      finishReason: {
        unified: 'tool-calls' as const,
        raw: undefined,
      },
      usage: createUsage(),
    },
  ]
}

function createTextChunks(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: {
        unified: 'stop' as const,
        raw: undefined,
      },
      usage: createUsage(),
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

function createMemoryRow(overrides: Record<string, unknown> = {}) {
  const timestamp = new Date('2026-10-20T10:00:00.000Z')

  return {
    id: 'entry-account-1',
    projectId: null,
    category: 'topics',
    slug: 'pasta',
    title: 'Pasta',
    description: 'Likes to cook pasta',
    body: 'Cooks pasta twice a week.',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'user',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null,
    ...overrides,
  }
}

interface SettingsRow {
  memoryEnabled?: boolean | null
  chatSearchEnabled?: boolean | null
  memoryIncludeSensitive?: boolean | null
  aboutMe?: string | null
}

interface DbScenario {
  settings?: SettingsRow | undefined
  settingsError?: Error
  memoryRows?: Array<Record<string, unknown>>
  memoryError?: Error
  project?: Record<string, unknown> | null
}

function createDb(scenario: DbScenario = {}) {
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

  const memoryFindMany = vi.fn(async (query: {
    where: { userId: number, projectId: unknown }
  }) => {
    if (scenario.memoryError) {
      throw scenario.memoryError
    }

    const projectFilter = query.where.projectId

    return (scenario.memoryRows ?? []).filter((row) => {
      if (
        typeof projectFilter === 'object'
        && projectFilter !== null
        && 'isNull' in projectFilter
      ) {
        return row.projectId === null
      }

      return row.projectId === projectFilter
    })
  })
  const settingsFindFirst = vi.fn(async () => {
    if (scenario.settingsError) {
      throw scenario.settingsError
    }

    return scenario.settings
  })
  const project = scenario.project ?? null

  return {
    db: {
      query: {
        userSettings: { findFirst: settingsFindFirst },
        memoryEntries: {
          findMany: memoryFindMany,
          findFirst: vi.fn(async () => undefined),
        },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: project ? 'project-1' : null,
            project,
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
    memoryFindMany,
    settingsFindFirst,
  }
}

function braveFetch() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ grounding: { generic: [] } }),
  })) as unknown as typeof fetch
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

function stubChatProvider(toolCall: boolean | undefined) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: PROVIDER_ID },
    model: {
      id: MODEL_ID,
      name: 'GPT-5 mini',
      tools: ['web_search', 'image_generation'],
      ...(toolCall === undefined ? {} : { toolCall }),
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  scenario?: DbScenario
  tools?: string[]
  gateway?: { toolCall: boolean | undefined }
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))
  vi.stubGlobal('useGateway', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
    generateChatTitle: vi.fn(),
    toolCall: input.gateway?.toolCall,
  })))
  vi.stubGlobal('fetch', braveFetch())

  const handler = await getHandler()
  const created = createDb(input.scenario)

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: input.gateway ? GATEWAY_MODEL_ID : MODEL_ID,
      ...(input.gateway ? { gateway: 'openrouter' } : {}),
      tools: input.tools ?? [],
      reasoning: 'off',
      messages: [{
        id: USER_MESSAGE_ID,
        role: 'user',
        parts: [{ type: 'text', text: USER_MESSAGE_TEXT }],
      }],
    },
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
  const chunks = await readClientChunks()

  return { doStream, assistantInsert, chunks, created }
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

function readAttribute(name: string) {
  return mocks.aiLoggerSet.mock.calls
    .map(([fields]) => fields as Record<string, any>)
    .filter(fields => fields.attributes?.[name] !== undefined)
    .at(-1)?.attributes[name]
}

const MEMORY_ON: SettingsRow = { memoryEnabled: true }

describe('memory send-path wiring', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.chatSearchToolsInputs = []
    mocks.memoryToolsInputs = []

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
    vi.stubGlobal('getRouterParams', (
      event: { params: unknown },
    ) => {
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
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    stubChatProvider(true)
  })

  describe('defaults and the memory switch', () => {
    it('uses the app default (memory on) when there is no settings row',
      async () => {
        const { doStream, created } = await runSend({
          scenario: { settings: undefined, memoryRows: [createMemoryRow()] },
          steps: [createTextChunks('Plain answer.')],
        })
        const callOptions = doStream.mock.calls[0]?.[0] as any

        expect(mocks.memoryToolsInputs).toHaveLength(1)
        expect(mocks.chatSearchToolsInputs).toHaveLength(1)
        expect(created.memoryFindMany).toHaveBeenCalled()
        expect(readToolNames(callOptions).sort()).toEqual([
          'memory_forget',
          'memory_list',
          'memory_read',
          'memory_write',
          'read_chat',
          'search_chats',
        ])
        expect(readSystemPrompt(callOptions).startsWith('<memory>'))
          .toBe(true)
      })

    it('keeps memory off when the user turned it off: no index, no memory '
      + 'tools, no entry read, chat search still on', async () => {
      const { doStream, created } = await runSend({
        scenario: {
          settings: { memoryEnabled: false },
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.memoryToolsInputs).toHaveLength(0)
      expect(mocks.chatSearchToolsInputs).toHaveLength(1)
      expect(created.memoryFindMany).not.toHaveBeenCalled()
      expect(readToolNames(callOptions).sort()).toEqual([
        'read_chat',
        'search_chats',
      ])
      expect(readSystemPrompt(callOptions)).toBe(CHAT_SEARCH_INSTRUCTION)
      expect(readAttribute('memoryIndex')).toBeUndefined()
      expect(readAttribute('memoryTools')).toBeUndefined()
    })

    it('still injects aboutMe while memory is off and registers no memory '
      + 'tools', async () => {
      const { doStream, created } = await runSend({
        scenario: {
          settings: { memoryEnabled: false, aboutMe: ABOUT_ME_TEXT },
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toContain(ABOUT_ME_TEXT)
      expect(systemPrompt).not.toContain('<memory>')
      expect(systemPrompt.indexOf(ABOUT_ME_TEXT))
        .toBeLessThan(systemPrompt.indexOf(CHAT_SEARCH_INSTRUCTION))
      expect(created.memoryFindMany).not.toHaveBeenCalled()
      expect(mocks.memoryToolsInputs).toHaveLength(0)
    })

    it('registers the memory tools and injects the index when memory is '
      + 'on', async () => {
      const { doStream, created } = await runSend({
        scenario: {
          settings: MEMORY_ON,
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any
      const systemPrompt = readSystemPrompt(callOptions)

      expect(readToolNames(callOptions).sort()).toEqual([
        'memory_forget',
        'memory_list',
        'memory_read',
        'memory_write',
        'read_chat',
        'search_chats',
      ])
      expect(created.memoryFindMany).toHaveBeenCalled()
      expect(systemPrompt.startsWith('<memory>')).toBe(true)
      expect(systemPrompt).toContain('topics/pasta | Pasta')
      expect(systemPrompt).toContain('memory_read')
      expect(readAttribute('memoryIndex')).toEqual({
        tokens: expect.any(Number),
        entryCount: 1,
        trimSteps: [],
        overBudget: false,
      })
      expect(readAttribute('memoryTools')).toEqual({
        registered: true,
        writesEnabled: true,
        usedCalls: 0,
      })
    })

    it('hands the tool factory the persisted user message id, the text, '
      + 'the chat and a constant false sensitive flag', async () => {
      await runSend({
        scenario: {
          settings: { memoryEnabled: true, memoryIncludeSensitive: true },
        },
        steps: [createTextChunks('Plain answer.')],
      })

      expect(mocks.memoryToolsInputs).toHaveLength(1)
      expect(mocks.memoryToolsInputs[0]).toEqual(expect.objectContaining({
        userId: 1,
        chatId: 'chat-1',
        projectId: null,
        useAccountMemory: null,
        sourceMessageId: USER_MESSAGE_ID,
        userMessageText: USER_MESSAGE_TEXT,
        includeSensitive: false,
        budget: { maxCalls: 3, usedCalls: 0, untrustedResultSeen: false },
      }))
    })

    it('shares one budget object between the search and the memory tools',
      async () => {
        await runSend({
          scenario: { settings: MEMORY_ON },
          steps: [createTextChunks('Plain answer.')],
        })

        expect(mocks.chatSearchToolsInputs[0]?.budget)
          .toBe(mocks.memoryToolsInputs[0]?.budget)
      })

    it('registers no index text for a memory-on user with no entries, but '
      + 'still the tools', async () => {
      const { doStream } = await runSend({
        scenario: { settings: MEMORY_ON, memoryRows: [] },
        steps: [createTextChunks('Plain answer.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toBe(CHAT_SEARCH_INSTRUCTION)
      expect(readAttribute('memoryIndex')).toBeUndefined()
      expect(mocks.memoryToolsInputs).toHaveLength(1)
    })
  })

  describe('chat search flag', () => {
    it('registers no search tools and no search line when chatSearchEnabled '
      + 'is false, while memory still works', async () => {
      const { doStream } = await runSend({
        scenario: {
          settings: { memoryEnabled: true, chatSearchEnabled: false },
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any
      const systemPrompt = readSystemPrompt(callOptions)

      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(mocks.memoryToolsInputs).toHaveLength(1)
      expect(readToolNames(callOptions).sort()).toEqual([
        'memory_forget',
        'memory_list',
        'memory_read',
        'memory_write',
      ])
      expect(systemPrompt).not.toContain(CHAT_SEARCH_INSTRUCTION)
      expect(readAttribute('chatSearch')).toBeUndefined()
      expect(readAttribute('memoryTools')).toEqual(expect.objectContaining({
        registered: true,
      }))
    })

    it('registers nothing and stays single step when both flags are off',
      async () => {
        const { doStream } = await runSend({
          scenario: {
            settings: { memoryEnabled: false, chatSearchEnabled: false },
          },
          steps: [createTextChunks('Plain answer.')],
        })
        const callOptions = doStream.mock.calls[0]?.[0] as any

        expect(mocks.chatSearchToolsInputs).toHaveLength(0)
        expect(mocks.memoryToolsInputs).toHaveLength(0)
        expect(callOptions?.tools).toBeUndefined()
        expect(doStream).toHaveBeenCalledTimes(1)
      })
  })

  describe('instruction order', () => {
    it('puts the index, then aboutMe, then the project prompt, the '
      + 'chat-search line and the dated clause', async () => {
      const { doStream } = await runSend({
        tools: ['web_search_brave'],
        scenario: {
          settings: { memoryEnabled: true, aboutMe: ABOUT_ME_TEXT },
          memoryRows: [createMemoryRow()],
          project: {
            id: 'project-1',
            name: 'Launch',
            instructions: PROJECT_INSTRUCTIONS,
            memory: null,
            memoryStatus: 'idle',
            useAccountMemory: null,
          },
        },
        steps: [createTextChunks('No search needed.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])
      const positions = [
        systemPrompt.indexOf('<memory>'),
        systemPrompt.indexOf(ABOUT_ME_TEXT),
        systemPrompt.indexOf(PROJECT_INSTRUCTIONS),
        systemPrompt.indexOf(CHAT_SEARCH_INSTRUCTION),
        systemPrompt.indexOf('Today\'s date'),
      ]

      expect(positions[0]).toBe(0)
      expect(positions.every(position => position >= 0)).toBe(true)
      expect([...positions].sort((first, second) => first - second))
        .toEqual(positions)
    })

    it('is byte-identical across two turns with the same data', async () => {
      const scenario = {
        settings: { memoryEnabled: true, aboutMe: ABOUT_ME_TEXT },
        memoryRows: [createMemoryRow()],
      }
      const first = await runSend({
        scenario,
        steps: [createTextChunks('First.')],
      })

      mocks.mergedStreams = []
      vi.resetModules()

      const second = await runSend({
        scenario,
        steps: [createTextChunks('Second.')],
      })

      expect(readSystemPrompt(first.doStream.mock.calls[0]?.[0]))
        .toBe(readSystemPrompt(second.doStream.mock.calls[0]?.[0]))
    })

    it('puts the same memory block first in the search-answer '
      + 'continuation', async () => {
      const { doStream } = await runSend({
        scenario: {
          settings: { memoryEnabled: true, aboutMe: ABOUT_ME_TEXT },
          memoryRows: [createMemoryRow()],
        },
        steps: [
          createToolCallChunks('call-1', 'search_chats', { query: SEARCH_QUERY }),
          createToolCallChunks('call-2', 'search_chats', { query: SEARCH_QUERY }),
          createToolCallChunks('call-3', 'search_chats', { query: SEARCH_QUERY }),
          createToolCallChunks('call-4', 'search_chats', { query: SEARCH_QUERY }),
          createTextChunks('Answer from the continuation.'),
        ],
      })
      const mainPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])
      const continuationOptions = doStream.mock.calls[4]?.[0] as any
      const continuationPrompt = readSystemPrompt(continuationOptions)

      expect(doStream).toHaveBeenCalledTimes(5)
      expect(continuationOptions?.tools).toBeUndefined()
      expect(continuationPrompt.startsWith('<memory>')).toBe(true)
      expect(continuationPrompt).toContain(ABOUT_ME_TEXT)
      expect(continuationPrompt).not.toContain(CHAT_SEARCH_INSTRUCTION)
      expect(mainPrompt.startsWith(continuationPrompt)).toBe(true)
    })
  })

  describe('fail-closed settings', () => {
    it('turns every flag off and drops aboutMe when the settings read '
      + 'throws, without failing the chat', async () => {
      const { doStream, assistantInsert, chunks, created } = await runSend({
        scenario: {
          settingsError: new Error('d1 unavailable'),
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Still answers.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any

      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(mocks.memoryToolsInputs).toHaveLength(0)
      expect(callOptions?.tools).toBeUndefined()
      expect(readSystemPrompt(callOptions)).toBe('')
      expect(created.memoryFindMany).not.toHaveBeenCalled()
      expect(readAttribute('memorySettings')).toEqual({
        error: 'd1 unavailable',
      })
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Still answers.',
      }))
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
    })

    it('drops the index, logs it and keeps the chat running when the '
      + 'entries read throws', async () => {
      const { doStream, assistantInsert } = await runSend({
        scenario: {
          settings: { memoryEnabled: true, aboutMe: ABOUT_ME_TEXT },
          memoryError: new Error('memory read failed'),
        },
        steps: [createTextChunks('Still answers.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).not.toContain('<memory>')
      expect(systemPrompt).toContain(ABOUT_ME_TEXT)
      expect(readAttribute('memoryIndex')).toEqual({
        error: 'memory read failed',
      })
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Still answers.',
      }))
    })
  })

  describe('project isolation', () => {
    const isolatedProject = {
      id: 'project-1',
      name: 'Launch',
      instructions: null,
      memory: null,
      memoryStatus: 'idle',
      useAccountMemory: false,
    }

    it('reads no account entries and scopes chat search to the project '
      + 'when the project keeps its memory separate', async () => {
      const { doStream, created } = await runSend({
        scenario: {
          settings: MEMORY_ON,
          project: isolatedProject,
          memoryRows: [
            createMemoryRow({ slug: 'account-fact', title: 'Account fact' }),
            createMemoryRow({
              id: 'entry-project-1',
              projectId: 'project-1',
              slug: 'project-fact',
              title: 'Project fact',
            }),
          ],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toContain('project/topics/project-fact')
      expect(systemPrompt).not.toContain('account-fact')
      expect(created.memoryFindMany).toHaveBeenCalledTimes(1)
      expect(mocks.chatSearchToolsInputs[0]?.projectId).toBe('project-1')
      expect(mocks.memoryToolsInputs[0]).toEqual(expect.objectContaining({
        projectId: 'project-1',
        useAccountMemory: false,
      }))
    })

    it('passes the loaded disabled status to the tools and keeps project '
      + 'entries out of the index', async () => {
      const { doStream } = await runSend({
        scenario: {
          settings: MEMORY_ON,
          project: {
            ...isolatedProject,
            useAccountMemory: true,
            memoryStatus: 'disabled',
          },
          memoryRows: [
            createMemoryRow({ slug: 'account-fact', title: 'Account fact' }),
            createMemoryRow({
              id: 'entry-project-1',
              projectId: 'project-1',
              slug: 'project-fact',
              title: 'Project fact',
            }),
          ],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(mocks.memoryToolsInputs[0]?.projectDisabled).toBe(true)
      expect(systemPrompt).toContain('topics/account-fact')
      expect(systemPrompt).not.toContain('project-fact')
    })

    it('passes projectDisabled false for an enabled project', async () => {
      await runSend({
        scenario: {
          settings: MEMORY_ON,
          project: { ...isolatedProject, useAccountMemory: true },
        },
        steps: [createTextChunks('Plain answer.')],
      })

      expect(mocks.memoryToolsInputs[0]?.projectDisabled).toBe(false)
    })

    it.each([
      ['null', null],
      ['true', true],
    ])('shows account entries and leaves search unscoped when '
      + 'useAccountMemory is %s', async (_label, useAccountMemory) => {
      const { doStream } = await runSend({
        scenario: {
          settings: MEMORY_ON,
          project: { ...isolatedProject, useAccountMemory },
          memoryRows: [
            createMemoryRow({ slug: 'account-fact', title: 'Account fact' }),
            createMemoryRow({
              id: 'entry-project-1',
              projectId: 'project-1',
              slug: 'project-fact',
              title: 'Project fact',
            }),
          ],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const systemPrompt = readSystemPrompt(doStream.mock.calls[0]?.[0])

      expect(systemPrompt).toContain('topics/account-fact')
      expect(systemPrompt).toContain('project/topics/project-fact')
      expect(mocks.chatSearchToolsInputs[0]?.projectId).toBeUndefined()
    })

    it('leaves search unscoped in a chat without a project', async () => {
      await runSend({
        scenario: { settings: MEMORY_ON },
        steps: [createTextChunks('Plain answer.')],
      })

      expect(mocks.chatSearchToolsInputs[0]?.projectId).toBeUndefined()
      expect(mocks.memoryToolsInputs[0]?.projectId).toBeNull()
    })
  })

  describe('model capability and forced tool choice', () => {
    it.each([
      ['false', false],
      ['undefined', undefined],
    ])('injects the index without tools or the tool sentence when the '
      + 'model toolCall is %s', async (_label, toolCall) => {
      stubChatProvider(toolCall)

      const { doStream } = await runSend({
        scenario: {
          settings: MEMORY_ON,
          memoryRows: [createMemoryRow()],
        },
        steps: [createTextChunks('Plain answer.')],
      })
      const callOptions = doStream.mock.calls[0]?.[0] as any
      const systemPrompt = readSystemPrompt(callOptions)

      expect(mocks.memoryToolsInputs).toHaveLength(0)
      expect(mocks.chatSearchToolsInputs).toHaveLength(0)
      expect(callOptions?.tools).toBeUndefined()
      expect(doStream).toHaveBeenCalledTimes(1)
      expect(systemPrompt).toContain('topics/pasta | Pasta')
      expect(systemPrompt).not.toContain('memory_read')
      expect(readAttribute('memoryTools')).toBeUndefined()
    })

    it('registers no memory tools on a gateway image-generation send',
      async () => {
        const { doStream } = await runSend({
          gateway: { toolCall: true },
          tools: ['image_generation'],
          scenario: { settings: MEMORY_ON },
          steps: [createTextChunks('Here is your image.')],
        })

        expect(mocks.memoryToolsInputs).toHaveLength(0)
        expect((doStream.mock.calls[0]?.[0] as any)?.tools).toBeUndefined()
      })

    it('registers the memory tools on a gateway send only when the '
      + 'gateway reports toolCall true', async () => {
      const supported = await runSend({
        gateway: { toolCall: true },
        scenario: { settings: MEMORY_ON },
        steps: [createTextChunks('Gateway answer.')],
      })

      expect(readToolNames(supported.doStream.mock.calls[0]?.[0]).sort())
        .toEqual([
          'memory_forget',
          'memory_list',
          'memory_read',
          'memory_write',
          'read_chat',
          'search_chats',
        ])

      mocks.mergedStreams = []
      mocks.memoryToolsInputs = []

      const unsupported = await runSend({
        gateway: { toolCall: undefined },
        scenario: { settings: MEMORY_ON },
        steps: [createTextChunks('Gateway answer.')],
      })

      expect(mocks.memoryToolsInputs).toHaveLength(0)
      expect((unsupported.doStream.mock.calls[0]?.[0] as any)?.tools)
        .toBeUndefined()
    })
  })

  describe('memory tool calls inside the loop', () => {
    it('grants the lookup steps for memory tools alone and never bills '
      + 'them as web searches', async () => {
      const { doStream, assistantInsert, chunks } = await runSend({
        scenario: {
          settings: { memoryEnabled: true, chatSearchEnabled: false },
        },
        steps: [
          createToolCallChunks('call-1', 'memory_read', { id: 'topics/pasta' }),
          createToolCallChunks('call-2', 'memory_write', { title: 'Pasta' }),
          createTextChunks('Saved it.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'tool-memory_read',
        state: 'output-available',
      }))
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'tool-memory_write',
        state: 'output-available',
      }))
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Saved it.',
      }))
      expect(parts).not.toContainEqual(expect.objectContaining({
        type: 'source-url',
      }))
      expect(assistantInsert?.usage?.searchUnits).toBeUndefined()
      expect(assistantInsert?.usage?.searchProvider).toBeUndefined()
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(readAttribute('memoryTools')).toEqual({
        registered: true,
        writesEnabled: true,
        usedCalls: 2,
      })
    })

    it('persists memory tool parts without entry bodies while the live '
      + 'stream still carries them', async () => {
      const { assistantInsert, chunks } = await runSend({
        scenario: {
          settings: { memoryEnabled: true, chatSearchEnabled: false },
        },
        steps: [
          createToolCallChunks('call-1', 'memory_read', { id: 'topics/pasta' }),
          createTextChunks('Done.'),
        ],
      })
      const readPart = (assistantInsert?.parts ?? []).find((part: any) => {
        return part.type === 'tool-memory_read'
      })

      expect(readPart?.output.entry).toEqual({
        id: 'entry-1',
        handle: 'topics/pasta',
        scope: 'account',
        category: 'topics',
        title: 'Pasta',
        description: 'Likes pasta',
      })
      expect(JSON.stringify(assistantInsert?.parts)).not.toContain(
        'Likes pasta.',
      )
      expect(JSON.stringify(chunks)).toContain('Likes pasta.')
    })

    it('turns the fourth call of one step into a budget tool error across '
      + 'both families and still answers', async () => {
      const parallelCalls = [
        ['call-1', 'memory_list', {}],
        ['call-2', 'search_chats', { query: SEARCH_QUERY }],
        ['call-3', 'memory_read', { id: 'topics/pasta' }],
        ['call-4', 'memory_write', { title: 'Pasta' }],
      ] as const
      const { doStream, assistantInsert, chunks } = await runSend({
        scenario: { settings: MEMORY_ON },
        steps: [
          [
            ...parallelCalls.map(([toolCallId, toolName, toolInput]) => {
              return createToolCallChunks(toolCallId, toolName, toolInput)[0]!
            }),
            createToolCallChunks('unused', 'memory_list', {})[1]!,
          ],
          createTextChunks('Answer after the shared budget.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []
      const budgetErrorPart = parts.find((part: any) => {
        return part.toolCallId === 'call-4'
      })

      expect(budgetErrorPart).toEqual(expect.objectContaining({
        type: 'tool-memory_write',
        state: 'output-error',
      }))
      expect(budgetErrorPart?.errorText).toContain('limit')
      expect(parts.filter((part: any) => {
        return part.state === 'output-available'
      })).toHaveLength(3)
      expect(doStream).toHaveBeenCalledTimes(2)
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answer after the shared budget.',
      }))
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(readAttribute('memoryTools')).toEqual(expect.objectContaining({
        usedCalls: 3,
      }))
    })
  })
})
