import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { tool } from 'ai'
import { z } from 'zod'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generationInProgressKvKey } from '~~/server/utils/chats/generation-in-progress'
import {
  generationStopKvKey,
  readGenerationLeaseState,
} from '~~/server/utils/chats/generation-lease'
import { REPLY_STOPPED_PART_TYPE } from '#shared/utils/chat-reply-stopped'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const MODEL_ID = 'gemini-3.8-flash'
const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const CHAT_PUBLIC_ID = 'chat-1'
const USER_MESSAGE_ID = 'user-public-1'
const FAKE_KEY = 'AIzaSyFakeKeyForTests1234567890abcdef'
const STREAM_DEADLINE_MS = 10_000
const GOOGLE_PROJECT_SPEND_CAP_BODY = {
  error: {
    code: 429,
    message: 'Your project has exceeded its monthly spending cap.',
    status: 'RESOURCE_EXHAUSTED',
  },
}

const mocks = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  staleReads: false,
  reasoningAlwaysOn: false,
  staleSnapshot: new Map<string, string>(),
  emitted: [] as Array<Record<string, unknown>>,
  loggerSets: [] as Array<Record<string, unknown>>,
}))

vi.mock('~~/server/utils/tool-approval/secret', () => ({
  useToolApprovalSecret: async () => 'test-tool-approval-secret',
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn((value: Record<string, unknown>) => {
      mocks.loggerSets.push(value)
    }),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: vi.fn((value: Record<string, unknown>) => {
      mocks.loggerSets.push(value)
    }),
    emit: vi.fn((value: Record<string, unknown>) => {
      mocks.emitted.push(value)

      return null
    }),
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
    isFeatureActive: () => false,
  }),
}))

vi.mock('~~/server/utils/skills/runtime/send', () => ({
  prepareSkillsForSend: async () => ({
    tools: {},
    toolsRegistered: false,
    instructionBlock: null,
    activeSkillsBlock: null,
    invocationBlock: null,
    holdsSkillText: false,
    streamActivations: [],
    getToolActivations: () => [],
  }),
}))

vi.mock('~~/server/capabilities/index', () => ({
  getCapabilityTools: async () => ({}),
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
            messages: [],
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
      const source = mocks.staleReads ? mocks.staleSnapshot : mocks.kv

      return source.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      mocks.kv.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      mocks.kv.delete(key)
    }),
  }
}

function spendCapFetch() {
  return vi.fn(async () => {
    return new Response(JSON.stringify(GOOGLE_PROJECT_SPEND_CAP_BODY), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after-ms': '0',
      },
    })
  })
}

function createEndlessModel() {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'text-1' })
            controller.enqueue({
              type: 'text-delta',
              id: 'text-1',
              delta: 'Thinking about it. Here is the first part of it. ',
            })
            abortSignal?.addEventListener('abort', () => {
              controller.error(abortSignal.reason)
            })
          },
        }),
      }
    },
  })
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

function createLookupTool(onExecute: () => void = () => undefined) {
  return {
    ...tool({
      description: 'Looks something up',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => {
        onExecute()

        return { results: ['A finding'] }
      },
    }),
    requiresFollowUpTurn: true,
  }
}

function createSearchThenReasonModel(secondStep: 'hang' | 'finish') {
  let callCount = 0
  const doStream = vi.fn(async ({ abortSignal }: {
    abortSignal?: AbortSignal
  }) => {
    callCount += 1

    if (callCount === 1) {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'reasoning-start', id: 'r-1' })
            controller.enqueue({
              type: 'reasoning-delta',
              id: 'r-1',
              delta: 'I should look this up.',
            })
            controller.enqueue({ type: 'reasoning-end', id: 'r-1' })
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'lookup',
              input: JSON.stringify({ query: 'news' }),
            })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: createUsage(),
            })
            controller.close()
          },
        }),
      }
    }

    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'reasoning-start', id: 'r-2' })
          controller.enqueue({
            type: 'reasoning-delta',
            id: 'r-2',
            delta: 'Reading the findings now.\n',
          })

          if (secondStep === 'finish') {
            controller.enqueue({ type: 'reasoning-end', id: 'r-2' })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: createUsage(),
            })
            controller.close()

            return
          }

          abortSignal?.addEventListener('abort', () => {
            controller.error(abortSignal.reason)
          })
        },
      }),
    }
  })

  return { model: new MockLanguageModelV4({ doStream }), doStream }
}

function stubGoogle(instance: unknown, tools: Record<string, unknown> = {}) {
  vi.stubGlobal('useGoogle', vi.fn(async () => ({
    instance,
    imageModel: undefined,
    imageModelId: 'gemini-3.1-flash-image',
    tools: Object.keys(tools).length > 0 ? { tools } : {},
    providerOptions: {},
    reasoning: undefined,
  })))
}

async function startSend() {
  const handler = (await import(
    '../../../server/api/v1/chats/[slug]/index.post'
  )).default
  const created = createDb()
  const waitUntilPromises: Promise<unknown>[] = []

  vi.stubGlobal('useDb', () => created.db)

  const response = await handler({
    params: { slug: CHAT_SLUG },
    context: {
      cloudflare: {
        context: {
          waitUntil: (promise: Promise<unknown>) => {
            waitUntilPromises.push(promise)
          },
        },
      },
    },
    body: {
      model: MODEL_ID,
      tools: [],
      reasoning: 'off',
      messages: [{
        id: USER_MESSAGE_ID,
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      }],
    },
  } as any) as Response

  return { response, created, waitUntilPromises }
}

async function readWithDeadline(response: Response): Promise<string> {
  let deadline: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      reject(new Error('The route stream never finished'))
    }, STREAM_DEADLINE_MS)
  })

  try {
    return await Promise.race([response.text(), timedOut])
  } finally {
    clearTimeout(deadline)
  }
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<void> {
  const decoder = new TextDecoder()
  let received = ''

  while (!received.includes(marker)) {
    const { done, value } = await reader.read()

    if (done) {
      throw new Error(`The stream ended before ${marker}`)
    }

    received += decoder.decode(value, { stream: true })
  }
}

const leaseKey = generationInProgressKvKey(CHAT_PUBLIC_ID, USER_MESSAGE_ID)

describe('chat send stream lifecycle', () => {
  beforeAll(async () => {
    await import('../../../server/api/v1/chats/[slug]/index.post')
  }, 60_000)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.kv = new Map()
    mocks.staleReads = false
    mocks.reasoningAlwaysOn = false
    mocks.staleSnapshot = new Map()
    mocks.emitted = []
    mocks.loggerSets = []

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
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'google' },
      model: {
        id: MODEL_ID,
        name: 'Gemini 3.8 Flash',
        tools: [],
        toolCall: true,
        reasoningAlwaysOn: mocks.reasoningAlwaysOn,
        modalities: { input: ['text'], output: ['text'] },
      },
    })))
  })

  it('finishes an errored Google send, logs it and frees the lease',
    async () => {
      const fetcher = spendCapFetch()
      const google = createGoogleGenerativeAI({
        apiKey: FAKE_KEY,
        fetch: fetcher as unknown as typeof fetch,
      })

      stubGoogle(google(MODEL_ID))

      const { response, waitUntilPromises } = await startSend()
      const body = await readWithDeadline(response)

      await Promise.allSettled(waitUntilPromises)

      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(body).toContain('"type":"error"')
      expect(body).toContain('provider-quota-exceeded')
      expect(mocks.emitted).toContainEqual(expect.objectContaining({
        message: 'AI stream completed',
      }))
      expect(mocks.loggerSets).toContainEqual(expect.objectContaining({
        errorCode: 'provider-quota-exceeded',
      }))
      expect(mocks.kv.has(leaseKey)).toBe(false)
    })

  it('frees the lease and marks the run stopped when the client leaves',
    async () => {
      stubGoogle(createEndlessModel())

      const { response, waitUntilPromises } = await startSend()
      const reader = response.body!.getReader()

      await reader.read()

      const lease = JSON.parse(mocks.kv.get(leaseKey) ?? 'null')

      expect(lease?.runId).toEqual(expect.any(String))

      await reader.cancel(new Error('client went away'))
      await Promise.allSettled(waitUntilPromises)

      expect(mocks.kv.has(leaseKey)).toBe(false)
      expect(mocks.kv.get(generationStopKvKey(lease.runId))).toBe('1')
      expect(await readGenerationLeaseState(createKv(), leaseKey))
        .toEqual({ state: 'free' })
    })

  it('stores a reply cut off by a disconnect as stopped, even through'
    + ' cached KV reads, inside waitUntil', async () => {
    stubGoogle(createEndlessModel())

    const { response, created, waitUntilPromises } = await startSend()
    const reader = response.body!.getReader()

    await readUntil(reader, '"type":"text-delta"')

    mocks.staleSnapshot = new Map(mocks.kv)
    mocks.staleReads = true

    await reader.cancel(new Error('client went away'))
    await Promise.allSettled(waitUntilPromises)

    const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
      return value.role === 'assistant'
    })?.[0]

    expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
      type: REPLY_STOPPED_PART_TYPE,
    }))
  })

  it('starts a real run for a resend right after a disconnect', async () => {
    stubGoogle(createEndlessModel())

    const first = await startSend()
    const firstReader = first.response.body!.getReader()

    await readUntil(firstReader, '"type":"text-delta"')
    await firstReader.cancel(new Error('client went away'))

    const resend = await startSend()
    const resendReader = resend.response.body!.getReader()

    await readUntil(resendReader, '"type":"text-delta"')
    await resendReader.cancel(new Error('done'))
    await Promise.allSettled([
      ...first.waitUntilPromises,
      ...resend.waitUntilPromises,
    ])
  })

  it('lets a resend served by the same isolate take over through a stale'
    + ' KV cache', async () => {
    stubGoogle(createEndlessModel())

    const first = await startSend()
    const firstReader = first.response.body!.getReader()

    await readUntil(firstReader, '"type":"text-delta"')

    const lease = JSON.parse(mocks.kv.get(leaseKey) ?? 'null')

    mocks.staleSnapshot = new Map(mocks.kv)
    mocks.staleReads = true
    await firstReader.cancel(new Error('client went away'))

    const routeLease = await import('~~/server/utils/chats/generation-lease')

    expect(await routeLease.readGenerationLeaseState(createKv(), leaseKey))
      .toEqual({ state: 'stopped', lease })

    await Promise.allSettled(first.waitUntilPromises)
  })

  function findAssistantInsert(
    insertValues: ReturnType<typeof vi.fn>,
  ): Record<string, any> | undefined {
    return insertValues.mock.calls.find(([value]) => {
      return value.role === 'assistant'
    })?.[0]
  }

  function expectStoppedWithoutError(
    assistantInsert: Record<string, any> | undefined,
  ) {
    const texts = (assistantInsert?.parts ?? [])
      .filter((part: { type: string }) => part.type === 'text')
      .map((part: { text: string }) => part.text)

    expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
      type: REPLY_STOPPED_PART_TYPE,
    }))
    expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
      type: 'reasoning',
    }))
    expect(texts.join(' ')).not.toContain('didn\'t write an answer')
    expect(mocks.loggerSets).not.toContainEqual(expect.objectContaining({
      errorCode: 'assistant-empty-answer',
    }))
    expect(mocks.loggerSets).toContainEqual(expect.objectContaining({
      stage: 'stopped',
    }))
  }

  it('stores a disconnect after tool steps without text as a stopped reply,'
    + ' not an empty answer', async () => {
    const { model } = createSearchThenReasonModel('hang')

    mocks.reasoningAlwaysOn = true
    stubGoogle(model, { lookup: createLookupTool() })

    const { response, created, waitUntilPromises } = await startSend()
    const reader = response.body!.getReader()

    await readUntil(reader, '"delta":"now.')
    await reader.cancel(new Error('client went away'))
    await Promise.allSettled(waitUntilPromises)

    expectStoppedWithoutError(findAssistantInsert(created.insertValues))
  })

  it('stores a run stopped through the stop route during tool steps as'
    + ' stopped, with no answer continuation', async () => {
    const { model, doStream } = createSearchThenReasonModel('finish')

    mocks.reasoningAlwaysOn = true
    stubGoogle(model, {
      lookup: createLookupTool(() => {
        const lease = JSON.parse(mocks.kv.get(leaseKey) ?? 'null')

        mocks.kv.set(generationStopKvKey(lease.runId), '1')
      }),
    })

    const { response, created, waitUntilPromises } = await startSend()
    const body = await readWithDeadline(response)

    await Promise.allSettled(waitUntilPromises)

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(body).not.toContain('assistant-empty-answer')
    expectStoppedWithoutError(findAssistantInsert(created.insertValues))
  })
})
