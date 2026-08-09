import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'
import {
  createFixtureFollowUpTool,
  FIXTURE_FOLLOW_UP_TOOL_NAME,
} from '../../fixtures/follow-up-turn-tool'

/**
 * Drives the real `streamText` loop through the real send pipeline. Only the
 * UI-stream plumbing entry points are stubbed so the handler's execute() can
 * be awaited — `streamText`, `toUIMessageStream` and `readUIMessageStream`
 * all run for real, which is what makes the step count, the persisted
 * intermediate tool parts and the cross-step cost sum genuine evidence
 * rather than a restatement of a mock.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
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
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  getGeneratedImageFileIds: vi.fn(() => []),
  isKnownImageGenerationModel: vi.fn(() => false),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

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

function createProviderMetadata(cost: number | undefined) {
  if (cost === undefined) {
    return undefined
  }

  return { openrouter: { usage: { cost } } }
}

function createToolCallChunks(toolCallId: string, cost?: number) {
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName: FIXTURE_FOLLOW_UP_TOOL_NAME,
      input: JSON.stringify({ query: 'besidka release notes' }),
    },
    {
      type: 'finish' as const,
      finishReason: {
        unified: 'tool-calls' as const,
        raw: undefined,
      },
      usage: createUsage(),
      providerMetadata: createProviderMetadata(cost),
    },
  ]
}

function createTextChunks(text: string, cost?: number) {
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
      providerMetadata: createProviderMetadata(cost),
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

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )

  return module.default
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
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
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
  }
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'openai/gpt-5',
    gateway: 'openrouter',
    tools: ['web_search'],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'What shipped recently?' }],
    }],
    ...overrides,
  }
}

async function runLoopSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  onExecute?: (query: string) => void
  shouldThrow?: boolean
  withoutMarker?: boolean
}) {
  const { model, doStream } = createScriptedModel(input.steps)
  const markedTool = createFixtureFollowUpTool({
    onExecute: input.onExecute,
    shouldThrow: input.shouldThrow,
  })
  const fixtureTool = input.withoutMarker
    ? tool({
      description: markedTool.description,
      inputSchema: markedTool.inputSchema,
      execute: markedTool.execute,
    })
    : markedTool

  vi.stubGlobal('useGateway', vi.fn(async () => ({
    instance: model,
    tools: {
      tools: {
        [FIXTURE_FOLLOW_UP_TOOL_NAME]: fixtureTool,
      },
    },
    providerOptions: {},
    generateChatTitle: vi.fn(),
  })))

  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: baseBody(),
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]

  return { doStream, assistantInsert }
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

describe('multi-step tool loop', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
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
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
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
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({ public: {} })))
  })

  it('runs a second model turn after the marked tool returns a result',
    async () => {
      const queries: string[] = []
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createTextChunks('Here is what shipped.'),
        ],
        onExecute: query => queries.push(query),
      })

      expect(doStream).toHaveBeenCalledTimes(2)
      expect(queries).toEqual(['besidka release notes'])
      expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
          state: 'output-available',
        }),
        expect.objectContaining({
          type: 'text',
          text: 'Here is what shipped.',
        }),
      ]))
    })

  it('persists the intermediate tool call input and output verbatim',
    async () => {
      const { assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createTextChunks('Answer'),
        ],
      })
      const toolPart = assistantInsert?.parts.find((part: any) => {
        return part.type === `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`
      })

      expect(toolPart?.input).toEqual({ query: 'besidka release notes' })
      expect(toolPart?.output).toEqual({
        results: [{
          title: 'Result for besidka release notes',
          url: 'https://example.com',
        }],
      })
    })

  it('sums the per-step openrouter cost across the whole loop', async () => {
    const { assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1', 0.004),
        createTextChunks('Answer', 0.0015),
      ],
    })

    expect(assistantInsert?.usage?.totalCost).toBeCloseTo(0.0055, 10)
    expect(assistantInsert?.usage?.inputTokens).toBe(20)
    expect(assistantInsert?.usage?.outputTokens).toBe(40)
  })

  it('streams the same summed cost live, without waiting for a reload',
    async () => {
      await runLoopSend({
        steps: [
          createToolCallChunks('call-1', 0.004),
          createTextChunks('Answer', 0.0015),
        ],
      })

      const chunks = await readClientChunks()
      const finishChunk = chunks.find((chunk) => {
        return chunk.type === 'finish' && chunk.messageMetadata
      })

      expect(finishChunk?.messageMetadata?.usage?.totalCost)
        .toBeCloseTo(0.0055, 10)
    })

  it('leaves totalCost unset when no step reports a cost', async () => {
    const { assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1'),
        createTextChunks('Answer'),
      ],
    })

    expect(assistantInsert?.usage?.totalCost).toBeUndefined()
  })

  it('stops at the step cap when the model keeps calling the tool',
    async () => {
      const queries: string[] = []
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createToolCallChunks('call-2'),
          createToolCallChunks('call-3'),
          createToolCallChunks('call-4'),
        ],
        onExecute: query => queries.push(query),
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(queries).toHaveLength(3)
      expect(assistantInsert).toBeDefined()
    })

  it('never loops for the identical tool without the marker, even though '
    + 'it has the same execute()', async () => {
    const queries: string[] = []
    const { doStream, assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1'),
        createTextChunks('This second step must never run.'),
      ],
      onExecute: query => queries.push(query),
      withoutMarker: true,
    })

    expect(doStream).toHaveBeenCalledTimes(1)
    expect(queries).toEqual(['besidka release notes'])
    expect(assistantInsert?.parts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
    ]))
  })

  it('terminates the loop when the tool execute() throws', async () => {
    const { doStream, assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1'),
        createTextChunks('The lookup failed, here is what I know.'),
      ],
      shouldThrow: true,
    })

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
        state: 'output-error',
      }),
      expect.objectContaining({
        type: 'text',
        text: 'The lookup failed, here is what I know.',
      }),
    ]))
  })
})
