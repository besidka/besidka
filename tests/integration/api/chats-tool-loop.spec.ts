import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { getModelCostMap } from '../../../server/utils/ai/cost-map'
import {
  createFixtureFollowUpTool,
  FIXTURE_FOLLOW_UP_TOOL_NAME,
} from '../../fixtures/follow-up-turn-tool'
import { getPersistedEmptyAnswerFailureText } from '../../../shared/utils/chat-failure-text'

const LOOP_MODEL_ID = 'kimi-k2.6'
const LOOP_PROVIDER_ID = 'moonshotai'

/**
 * Drives the real `streamText` loop through the real send pipeline, shaped as
 * a Moonshot AI send because Moonshot's Formula-API web search is the only
 * shipped tool that carries the `withFollowUpTurn()` marker. Only the
 * UI-stream plumbing entry points are stubbed so the handler's execute() can
 * be awaited — `streamText`, `toUIMessageStream` and `readUIMessageStream`
 * all run for real, which is what makes the step count, the persisted
 * intermediate tool parts and the cross-step usage totals genuine evidence
 * rather than a restatement of a mock.
 */
const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  loggerSet: vi.fn(),
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

vi.mock('~~/server/utils/ai/tool-loop', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../server/utils/ai/tool-loop')
  >()

  return {
    ...actual,
    TOOL_LOOP_CONTINUATION_TIMEOUT_MS: 150,
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
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

function createToolCallChunks(toolCallId: string) {
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
    },
  ]
}

function createReasoningChunks(id: string, text: string) {
  return [
    { type: 'reasoning-start' as const, id },
    { type: 'reasoning-delta' as const, id, delta: text },
    { type: 'reasoning-end' as const, id },
  ]
}

function createSourceUrlChunks(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'source' as const,
    sourceType: 'url' as const,
    id: `${prefix}-source-${index}`,
    url: `https://example.com/${prefix}-${index}`,
    title: `Result ${index} for ${prefix}`,
  }))
}

function createReasoningToolCallStepChunks(toolCallId: string) {
  return [
    ...createReasoningChunks(
      `reasoning-${toolCallId}`,
      'Deciding what to search for next.',
    ),
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName: FIXTURE_FOLLOW_UP_TOOL_NAME,
      input: JSON.stringify({ query: 'besidka release notes' }),
    },
    ...createSourceUrlChunks(toolCallId, 10),
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

function createStreamedToolCallChunks(input: {
  toolCallId: string
  toolName: string
  rawInput: string
}) {
  return [
    {
      type: 'tool-input-start' as const,
      id: input.toolCallId,
      toolName: input.toolName,
    },
    {
      type: 'tool-input-delta' as const,
      id: input.toolCallId,
      delta: input.rawInput,
    },
    { type: 'tool-input-end' as const, id: input.toolCallId },
    {
      type: 'tool-call' as const,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      input: input.rawInput,
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

function createPreambleToolCallChunks(toolCallId: string, preamble: string) {
  return [
    { type: 'text-start' as const, id: 'preamble-1' },
    { type: 'text-delta' as const, id: 'preamble-1', delta: preamble },
    { type: 'text-end' as const, id: 'preamble-1' },
    ...createToolCallChunks(toolCallId),
  ]
}

function createNoAnswerFinishChunks() {
  return [
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

type ScriptedStep = Array<Record<string, unknown>> | Error | 'stall-after-text'

function createStallingStream(abortSignal: AbortSignal | undefined) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: 'stalled-text' })
      controller.enqueue({
        type: 'text-delta',
        id: 'stalled-text',
        delta: 'Half an answer',
      })
      abortSignal?.addEventListener('abort', () => {
        controller.error(abortSignal.reason)
      })
    },
  })
}

function createScriptedModel(steps: ScriptedStep[]) {
  let callCount = 0
  const doStream = vi.fn(async (options?: { abortSignal?: AbortSignal }) => {
    const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

    callCount += 1

    if (chunks instanceof Error) {
      throw chunks
    }

    if (chunks === 'stall-after-text') {
      return { stream: createStallingStream(options?.abortSignal) as any }
    }

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

function createDb(existingMessages: unknown[] = []) {
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
            messages: existingMessages,
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
    model: LOOP_MODEL_ID,
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
  steps: ScriptedStep[]
  onExecute?: (query: string) => void
  shouldThrow?: boolean
  withoutMarker?: boolean
  bodyOverrides?: Record<string, unknown>
  existingMessages?: unknown[]
  reasoning?: 'low' | 'medium' | 'high'
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

  vi.stubGlobal('useMoonshotAi', vi.fn(async () => ({
    instance: model,
    tools: {
      tools: {
        [FIXTURE_FOLLOW_UP_TOOL_NAME]: fixtureTool,
      },
    },
    providerOptions: {},
    reasoning: input.reasoning,
  })))

  const handler = await getHandler()
  const created = createDb(input.existingMessages ?? [])

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: baseBody(input.bodyOverrides),
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]

  return {
    doStream,
    assistantInsert,
    insertValues: created.insertValues,
    writer: result.writer,
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
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: LOOP_PROVIDER_ID },
      model: {
        id: LOOP_MODEL_ID,
        name: 'Kimi K2.6',
        tools: ['web_search'],
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
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

  it('streams the whole-loop usage live, without waiting for a reload',
    async () => {
      const { assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createTextChunks('Answer'),
        ],
      })

      const chunks = await readClientChunks()
      const finishChunk = chunks.find((chunk) => {
        return chunk.type === 'finish' && chunk.messageMetadata
      })

      expect(finishChunk?.messageMetadata?.usage).toEqual(
        expect.objectContaining({
          inputTokens: 20,
          outputTokens: 40,
        }),
      )
      expect(finishChunk?.messageMetadata?.usage)
        .toEqual(assistantInsert?.usage)
    })

  it('prices the whole loop once from the model cost map and never '
    + 'fabricates a totalCost', async () => {
    const { assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1'),
        createTextChunks('Answer'),
      ],
    })
    const modelCost = getModelCostMap()[LOOP_MODEL_ID]

    expect(modelCost).toBeDefined()
    expect(assistantInsert?.usage).toEqual({
      model: LOOP_MODEL_ID,
      provider: LOOP_PROVIDER_ID,
      inputTokens: 20,
      outputTokens: 40,
      totalTokens: 60,
      inputCost: (20 * (modelCost?.input ?? 0)) / 1_000_000,
      outputCost: (40 * (modelCost?.output ?? 0)) / 1_000_000,
    })
    expect(assistantInsert?.usage?.totalCost).toBeUndefined()
  })

  it('forces a final answer at the step cap instead of truncating the '
    + 'reply', async () => {
    const queries: string[] = []
    const { doStream, assistantInsert } = await runLoopSend({
      steps: [
        createToolCallChunks('call-1'),
        createToolCallChunks('call-2'),
        createToolCallChunks('call-3'),
        createTextChunks('Here is what I found so far.'),
      ],
      onExecute: query => queries.push(query),
    })
    const chunks = await readClientChunks()
    const chunkTypes = chunks.map(chunk => chunk.type)

    expect(doStream).toHaveBeenCalledTimes(4)
    expect(queries).toHaveLength(3)
    expect(chunkTypes).not.toContain('abort')
    expect(chunkTypes).not.toContain('error')
    expect(chunkTypes).toContain('finish')

    const firstStepCallOptions = doStream.mock.calls[0]?.[0]
    const finalStepCallOptions = doStream.mock.calls[3]?.[0]

    expect(firstStepCallOptions?.toolChoice).toEqual({ type: 'auto' })
    expect(finalStepCallOptions?.toolChoice).toEqual({ type: 'none' })
    expect(finalStepCallOptions?.prompt[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('search budget is used up'),
      }),
    )
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: 'Here is what I found so far.',
      }),
    ]))
  })

  it('persists a real answer for the production-shaped rows the bug left '
    + 'blank: reasoning and source-url parts alongside every tool call',
  async () => {
    const { doStream, assistantInsert } = await runLoopSend({
      steps: [
        createReasoningToolCallStepChunks('call-1'),
        createReasoningToolCallStepChunks('call-2'),
        createReasoningToolCallStepChunks('call-3'),
        createTextChunks('Here is the answer, grounded in those sources.'),
      ],
      bodyOverrides: { reasoning: 'high' },
    })

    expect(doStream).toHaveBeenCalledTimes(4)
    expect(doStream.mock.calls[3]?.[0]?.toolChoice)
      .toEqual({ type: 'none' })
    expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning' }),
      expect.objectContaining({ type: 'source-url' }),
      expect.objectContaining({
        type: 'text',
        text: 'Here is the answer, grounded in those sources.',
      }),
    ]))
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
    expect(assistantInsert).toBeUndefined()
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

  describe('a follow-up-turn tool that finishes with no answer', () => {
    it('persists the turn with a visible failure notice instead of '
      + 'silently dropping it', async () => {
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createNoAnswerFinishChunks(),
        ],
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(assistantInsert).toBeDefined()
      expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
          state: 'output-available',
        }),
        expect.objectContaining({
          type: 'text',
          text: getPersistedEmptyAnswerFailureText(),
        }),
      ]))
    })

    it('surfaces a live error chunk so the client never silently hangs',
      async () => {
        const { writer } = await runLoopSend({
          steps: [
            createToolCallChunks('call-1'),
            createNoAnswerFinishChunks(),
          ],
        })

        const errorCall = writer.write.mock.calls.find(([chunk]: [{
          type?: string
        }]) => {
          return chunk?.type === 'error'
        })

        expect(errorCall).toBeDefined()

        const parsedError = JSON.parse(errorCall?.[0]?.errorText)

        expect(parsedError.code).toBe('assistant-empty-answer')
      })

    it('does not send the "response is ready" push notification for a '
      + 'failed turn', async () => {
      const { doStream } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createNoAnswerFinishChunks(),
        ],
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(globalThis.sendPushNotificationToUser).not.toHaveBeenCalled()
    })

    it('does not trap Regenerate: a resend of the same user message runs '
      + 'a fresh generation instead of replaying the stale failure',
    async () => {
      const failureText = getPersistedEmptyAnswerFailureText()
      const existingMessages = [
        {
          id: 'user-db-id',
          publicId: 'user-public-1',
          role: 'user',
          parts: [{ type: 'text', text: 'What shipped recently?' }],
          tools: [],
          reasoning: 'off',
        },
        {
          id: 'assistant-db-id',
          publicId: 'assistant-public-1',
          role: 'assistant',
          parts: [
            {
              type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
              toolCallId: 'call-1',
              state: 'output-available',
              input: { query: 'besidka release notes' },
              output: {
                results: [{
                  title: 'Result',
                  url: 'https://example.com',
                }],
              },
            },
            { type: 'text', text: failureText },
          ],
          tools: [],
          reasoning: 'off',
        },
      ]

      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-2'),
          createTextChunks('Here is what shipped.'),
        ],
        existingMessages,
      })

      expect(doStream).toHaveBeenCalledTimes(2)
      expect(assistantInsert?.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Here is what shipped.',
        }),
      ]))
    })
  })

  describe('search-answer continuation', () => {
    function getAiLoggerField(field: string) {
      return mocks.aiLoggerSet.mock.calls
        .map(([fields]) => fields as Record<string, any>)
        .filter(fields => fields[field] !== undefined)
        .at(-1)?.[field]
    }

    function getToolLoopAttributes() {
      return mocks.aiLoggerSet.mock.calls
        .map(([fields]) => fields as Record<string, any>)
        .filter(fields => fields.attributes?.toolLoop !== undefined)
        .at(-1)?.attributes.toolLoop
    }

    function getPromptText(callOptions: any): string {
      return JSON.stringify(callOptions?.prompt ?? [])
    }

    it('answers in a tool-less continuation when the forced step still '
      + 'calls a tool', async () => {
      const queries: string[] = []
      const { doStream, assistantInsert, writer } = await runLoopSend({
        steps: [
          createReasoningToolCallStepChunks('call-1'),
          createReasoningToolCallStepChunks('call-2'),
          createReasoningToolCallStepChunks('call-3'),
          createToolCallChunks('call-4'),
          createTextChunks('Grounded answer from the continuation.'),
        ],
        onExecute: query => queries.push(query),
      })
      const chunks = await readClientChunks()
      const parts = assistantInsert?.parts ?? []
      const lastSourceIndex = parts.findLastIndex((part: any) => {
        return part.type === 'source-url'
      })
      const answerIndex = parts.findIndex((part: any) => {
        return part.type === 'text'
          && part.text === 'Grounded answer from the continuation.'
      })
      const forcedStepCallOptions = doStream.mock.calls[3]?.[0]
      const continuationCallOptions = doStream.mock.calls[4]?.[0]
      const modelCost = getModelCostMap()[LOOP_MODEL_ID]

      expect(doStream).toHaveBeenCalledTimes(5)
      expect(queries).toHaveLength(3)
      expect(forcedStepCallOptions?.toolChoice).toEqual({ type: 'none' })
      expect(forcedStepCallOptions?.tools).toBeUndefined()
      expect(continuationCallOptions?.tools).toBeUndefined()
      expect(getPromptText(continuationCallOptions))
        .toContain('Web search results gathered for this conversation')
      expect(getPromptText(continuationCallOptions))
        .toContain('Result for besidka release notes')
      expect(continuationCallOptions?.prompt.some((message: any) => {
        return message.role === 'tool'
      })).toBe(false)
      expect(lastSourceIndex).toBeGreaterThan(-1)
      expect(answerIndex).toBeGreaterThan(lastSourceIndex)
      expect(parts).not.toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(writer.write.mock.calls.some(([chunk]: [{ type?: string }]) => {
        return chunk?.type === 'error'
      })).toBe(false)
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(1)
      expect(chunks.at(-1)?.type).toBe('finish')
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        inputTokens: 50,
        outputTokens: 100,
        inputCost: (50 * (modelCost?.input ?? 0)) / 1_000_000,
        outputCost: (100 * (modelCost?.output ?? 0)) / 1_000_000,
      }))
      expect(chunks.at(-1)?.messageMetadata?.usage)
        .toEqual(assistantInsert?.usage)
      expect(getAiLoggerField('ai')).toEqual(expect.objectContaining({
        tokens: expect.objectContaining({ input: 50, output: 100 }),
        cost: assistantInsert?.usage.inputCost
          + assistantInsert?.usage.outputCost,
      }))
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        steps: 4,
        forcedStepToolCall: true,
        continuationRan: true,
        continuationProducedText: true,
        finishReason: 'stop',
      }))
    })

    it('hides the expected rejection of a tool call on the forced step '
      + 'from the persisted parts and the client stream', async () => {
      const { assistantInsert } = await runLoopSend({
        steps: [
          createReasoningToolCallStepChunks('call-1'),
          createReasoningToolCallStepChunks('call-2'),
          createReasoningToolCallStepChunks('call-3'),
          createToolCallChunks('call-4'),
          createTextChunks('Grounded answer from the continuation.'),
        ],
      })
      const chunks = await readClientChunks()
      const parts = assistantInsert?.parts ?? []
      const toolParts = parts.filter((part: any) => {
        return part.type.startsWith('tool-')
      })

      expect(toolParts).toHaveLength(3)
      expect(toolParts.map((part: any) => part.state))
        .toEqual(['output-available', 'output-available', 'output-available'])
      expect(parts).not.toContainEqual(expect.objectContaining({
        state: 'output-error',
      }))
      expect(JSON.stringify(parts)).not.toContain('NoSuchTool')
      expect(JSON.stringify(parts)).not.toContain('call-4')
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Grounded answer from the continuation.',
      }))
      expect(chunks.some((chunk) => {
        return chunk.toolCallId === 'call-4'
      })).toBe(false)
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        forcedStepToolCall: true,
        forcedStepRejectedToolCall: true,
        continuationRan: true,
        continuationProducedText: true,
      }))
    })

    it('sends the continuation no tool history from earlier search turns',
      async () => {
        const existingMessages = [
          {
            id: 'user-db-id',
            publicId: 'user-public-0',
            role: 'user',
            parts: [{ type: 'text', text: 'What shipped last month?' }],
            tools: [],
            reasoning: 'off',
          },
          {
            id: 'assistant-db-id',
            publicId: 'assistant-public-0',
            role: 'assistant',
            parts: [
              {
                type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
                toolCallId: 'earlier-call',
                state: 'output-available',
                input: { query: 'besidka last month' },
                output: {
                  results: [{
                    title: 'Earlier result',
                    url: 'https://example.com/earlier',
                  }],
                },
              },
              { type: 'text', text: 'Last month shipped search.' },
            ],
            tools: [],
            reasoning: 'off',
          },
        ]
        const { doStream, assistantInsert } = await runLoopSend({
          steps: [
            createToolCallChunks('call-1'),
            createNoAnswerFinishChunks(),
            createTextChunks('Answer without tool history.'),
          ],
          existingMessages,
        })
        const continuationPrompt = doStream.mock.calls[2]?.[0]?.prompt ?? []

        expect(doStream).toHaveBeenCalledTimes(3)
        expect(continuationPrompt.some((message: any) => {
          return message.role === 'tool'
        })).toBe(false)
        expect(continuationPrompt.some((message: any) => {
          return Array.isArray(message.content)
            && message.content.some((part: any) => {
              return part.type === 'tool-call' || part.type === 'tool-result'
            })
        })).toBe(false)
        expect(JSON.stringify(continuationPrompt))
          .toContain('Last month shipped search.')
        expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
          type: 'text',
          text: 'Answer without tool history.',
        }))
      })

    it('falls back to the empty-answer notice when the continuation also '
      + 'returns no text', async () => {
      const { doStream, assistantInsert, writer } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createNoAnswerFinishChunks(),
          createNoAnswerFinishChunks(),
        ],
      })
      const errorCall = writer.write.mock.calls.find(([chunk]: [{
        type?: string
      }]) => {
        return chunk?.type === 'error'
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(JSON.parse(errorCall?.[0]?.errorText).code)
        .toBe('assistant-empty-answer')
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        inputTokens: 30,
        outputTokens: 60,
      }))
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: false,
      }))
    })

    it('runs the continuation instead of surfacing an error thrown by the '
      + 'forced step after a completed search', async () => {
      const { doStream, assistantInsert, writer } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createToolCallChunks('call-2'),
          createToolCallChunks('call-3'),
          new Error('function calls require declared tools'),
          createTextChunks('Answer despite the forced-step failure.'),
        ],
      })
      const chunks = await readClientChunks()

      expect(doStream).toHaveBeenCalledTimes(5)
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answer despite the forced-step failure.',
      }))
      expect(assistantInsert?.parts).not.toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: getPersistedEmptyAnswerFailureText(),
        }),
      )
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(chunks.at(-1)?.type).toBe('finish')
      expect(writer.write.mock.calls.some(([chunk]: [{ type?: string }]) => {
        return chunk?.type === 'error'
      })).toBe(false)
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        inputTokens: 40,
        outputTokens: 80,
      }))
    })

    it('answers from the gathered results when the step after a search '
      + 'errors', async () => {
      const { doStream, assistantInsert, writer } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          new Error('Bad Request'),
          createTextChunks('Answer despite the round-trip failure.'),
        ],
      })
      const chunks = await readClientChunks()
      const parts = assistantInsert?.parts ?? []
      const continuationPrompt = doStream.mock.calls[2]?.[0]?.prompt ?? []

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(doStream.mock.calls[2]?.[0]?.tools).toBeUndefined()
      expect(JSON.stringify(continuationPrompt))
        .toContain('Result for besidka release notes')
      expect(parts).toContainEqual(expect.objectContaining({
        type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
        state: 'output-available',
      }))
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answer despite the round-trip failure.',
      }))
      expect(parts).not.toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(chunks.at(-1)?.type).toBe('finish')
      expect(writer.write.mock.calls.some(([chunk]: [{ type?: string }]) => {
        return chunk?.type === 'error'
      })).toBe(false)
      expect(assistantInsert?.usage).toEqual(expect.objectContaining({
        inputTokens: 20,
        outputTokens: 40,
      }))
      expect(getAiLoggerField('ai')).toEqual(expect.objectContaining({
        tokens: expect.objectContaining({ input: 20, output: 40 }),
      }))
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: true,
        forcedStepError: undefined,
        heldStepError: {
          stepNumber: 1,
          error: expect.stringContaining('Bad Request'),
        },
      }))
    })

    it('falls back to the error and the empty-answer notice when the '
      + 'continuation after a mid-loop error also fails', async () => {
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          new Error('Bad Request'),
          new Error('continuation failed'),
        ],
      })
      const chunks = await readClientChunks()
      const errorChunks = chunks.filter(chunk => chunk.type === 'error')

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(errorChunks).toHaveLength(1)
      expect(errorChunks[0]?.errorText).toContain('Bad Request')
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
        state: 'output-available',
      }))
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: false,
        continuationError: expect.stringContaining('continuation failed'),
        heldStepError: expect.objectContaining({ stepNumber: 1 }),
      }))
    })

    it('answers after a browser-style tool call with invalid input and a '
      + 'forced-step call to an undeclared tool', async () => {
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createToolCallChunks('call-2'),
          createStreamedToolCallChunks({
            toolCallId: 'call-3',
            toolName: FIXTURE_FOLLOW_UP_TOOL_NAME,
            rawInput: JSON.stringify({ cursor: 1, id: 0 }),
          }),
          createStreamedToolCallChunks({
            toolCallId: 'call-4',
            toolName: 'open_file',
            rawInput: JSON.stringify({ cursor: 1 }),
          }),
          createTextChunks('Answer from the gathered results.'),
        ],
      })
      const chunks = await readClientChunks()
      const parts = assistantInsert?.parts ?? []
      const invalidCallPart = parts.find((part: any) => {
        return part.toolCallId === 'call-3'
      })
      const continuationPrompt = getPromptText(doStream.mock.calls[4]?.[0])
      const loggedFields = mocks.loggerSet.mock.calls.map(([fields]) => {
        return fields as Record<string, unknown>
      })
      const streamFailureLogs = loggedFields.filter((fields) => {
        return fields.stage === 'stream'
      })

      expect(doStream).toHaveBeenCalledTimes(5)
      expect(invalidCallPart).toEqual(expect.objectContaining({
        type: `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`,
        state: 'output-error',
        rawInput: { cursor: 1, id: 0 },
      }))
      expect(JSON.parse(invalidCallPart?.errorText)).toEqual(
        expect.objectContaining({
          code: 'invalid-provider-output',
          status: 422,
          message: 'The model sent an invalid tool call.',
        }),
      )
      expect(streamFailureLogs).toHaveLength(0)
      expect(JSON.stringify(parts)).not.toContain('open_file')
      expect(continuationPrompt).toContain('Result for besidka release notes')
      expect(parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Answer from the gathered results.',
      }))
      expect(parts).not.toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(chunks.map(chunk => chunk.type)).not.toContain('error')
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        steps: 4,
        forcedStepToolCall: true,
        forcedStepRejectedToolCall: true,
        continuationRan: true,
        continuationProducedText: true,
      }))
    })

    it('keeps the existing error handling for an error before any search',
      async () => {
        const { doStream } = await runLoopSend({
          steps: [new Error('provider unavailable')],
        })
        const chunks = await readClientChunks()

        expect(doStream).toHaveBeenCalledTimes(1)
        expect(chunks.map(chunk => chunk.type)).toContain('error')
        expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
          continuationRan: false,
          heldStepError: undefined,
        }))
      })

    it('never runs a continuation for a turn that already answered',
      async () => {
        const { doStream, assistantInsert } = await runLoopSend({
          steps: [
            createToolCallChunks('call-1'),
            createToolCallChunks('call-2'),
            createTextChunks('Answered within the loop.'),
          ],
        })
        const chunks = await readClientChunks()

        expect(doStream).toHaveBeenCalledTimes(3)
        expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
          type: 'text',
          text: 'Answered within the loop.',
        }))
        expect(assistantInsert?.usage).toEqual(expect.objectContaining({
          inputTokens: 30,
          outputTokens: 60,
        }))
        expect(chunks.filter(chunk => chunk.type === 'finish'))
          .toHaveLength(1)
        expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
          steps: 3,
          forcedStepToolCall: false,
          continuationRan: false,
          continuationProducedText: false,
          finishReason: 'stop',
        }))
      })
    it('logs the held forced-step error text when the continuation '
      + 'answers', async () => {
      await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createToolCallChunks('call-2'),
          createToolCallChunks('call-3'),
          new Error('function calls require declared tools'),
          createTextChunks('Answer despite the forced-step failure.'),
        ],
      })

      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationProducedText: true,
        continuationTruncated: false,
        forcedStepError: expect.stringContaining(
          'function calls require declared tools',
        ),
      }))
    })

    it('runs the continuation and persists its answer after a preamble '
      + 'that preceded the searches', async () => {
      const { doStream, assistantInsert, writer } = await runLoopSend({
        steps: [
          createPreambleToolCallChunks('call-1', 'Let me look that up.'),
          createNoAnswerFinishChunks(),
          createTextChunks('Answer after the preamble.'),
        ],
      })
      const parts = assistantInsert?.parts ?? []
      const preambleIndex = parts.findIndex((part: any) => {
        return part.type === 'text' && part.text === 'Let me look that up.'
      })
      const toolIndex = parts.findIndex((part: any) => {
        return part.type === `tool-${FIXTURE_FOLLOW_UP_TOOL_NAME}`
      })
      const answerIndex = parts.findIndex((part: any) => {
        return part.type === 'text'
          && part.text === 'Answer after the preamble.'
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(preambleIndex).toBeGreaterThan(-1)
      expect(toolIndex).toBeGreaterThan(preambleIndex)
      expect(answerIndex).toBeGreaterThan(toolIndex)
      expect(parts).not.toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
      expect(writer.write.mock.calls.some(([chunk]: [{ type?: string }]) => {
        return chunk?.type === 'error'
      })).toBe(false)
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: true,
      }))
    })

    it('persists the empty-answer notice when only a preamble preceded the '
      + 'searches and the continuation is empty', async () => {
      const { assistantInsert } = await runLoopSend({
        steps: [
          createPreambleToolCallChunks('call-1', 'Let me look that up.'),
          createNoAnswerFinishChunks(),
          createNoAnswerFinishChunks(),
        ],
      })

      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: 'Let me look that up.',
      }))
      expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
        type: 'text',
        text: getPersistedEmptyAnswerFailureText(),
      }))
    })

    it('closes and persists the partial answer when the continuation times '
      + 'out mid-stream', async () => {
      const { doStream, assistantInsert } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createNoAnswerFinishChunks(),
          'stall-after-text',
        ],
      })
      const chunks = await readClientChunks()
      const types = chunks.map(chunk => chunk.type)
      const partialPart = assistantInsert?.parts.find((part: any) => {
        return part.type === 'text' && part.text === 'Half an answer'
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(types).not.toContain('abort')
      expect(types.indexOf('text-end')).toBeGreaterThan(
        types.indexOf('text-delta'),
      )
      expect(types.at(-1)).toBe('finish')
      expect(partialPart).toBeDefined()
      expect(partialPart?.state).not.toBe('streaming')
      expect(assistantInsert?.parts).not.toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: getPersistedEmptyAnswerFailureText(),
        }),
      )
      expect(getToolLoopAttributes()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: true,
        continuationTruncated: true,
      }))
    })

    it('caps the continuation reasoning effort to low', async () => {
      const { doStream } = await runLoopSend({
        steps: [
          createToolCallChunks('call-1'),
          createNoAnswerFinishChunks(),
          createTextChunks('Answer'),
        ],
        reasoning: 'high',
        bodyOverrides: { reasoning: 'high' },
      })

      expect(doStream).toHaveBeenCalledTimes(3)
      expect(doStream.mock.calls[0]?.[0]?.reasoning).toBe('high')
      expect(doStream.mock.calls[2]?.[0]?.reasoning).toBe('low')
    })
  })
})
