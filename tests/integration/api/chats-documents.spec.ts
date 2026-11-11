import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import { getTableName } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import {
  createFakeDocumentStorage,
  seedDocument,
} from '../../setup/helpers/documents-db'
import type {
  FakeDocumentStorage,
} from '../../setup/helpers/documents-db'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const MODEL_ID = 'gpt-5-mini'
const CHAT_ID = 'pub-1'
const SECRET_PARAGRAPH = 'confidential-paragraph '
const PARAGRAPH_COUNT = 50
const PARAGRAPH_REPEATS = 170

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  aiLoggerSet: vi.fn(),
  activeFlags: new Set<string>(),
  historyMessages: [] as Array<Record<string, unknown>>,
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

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: vi.fn(async () => ({
    isFeatureActive: (flag: string) => mocks.activeFlags.has(flag),
  })),
}))

vi.mock('~~/server/utils/artifacts/blob-store', () => ({
  useArtifactBlobStore: () => ({}),
}))

vi.mock('~~/server/utils/artifacts/context', () => ({
  buildArtifactContextBlock: vi.fn(async () => null),
}))

vi.mock('~~/server/utils/artifacts/attachments', () => ({
  resolveArtifactAttachmentParts: vi.fn(
    async (input: { parts: unknown[] }) => input.parts,
  ),
}))

vi.mock('~~/server/utils/artifacts/chat-artifacts', () => ({
  listChatArtifactIds: vi.fn(async () => []),
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

function toolCall(
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

function text(value: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: value },
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

function createDocxSpec(paragraphCount = 1, repeats = 1) {
  const paragraphText = SECRET_PARAGRAPH.repeat(repeats)

  return {
    specVersion: 1,
    format: 'docx',
    title: 'Quarterly report',
    blocks: Array.from({ length: paragraphCount }, () => {
      return { type: 'paragraph', runs: [{ text: paragraphText }] }
    }),
  }
}

function isDocumentsTable(table: unknown): boolean {
  return getTableName(table as typeof schema.documents) === 'documents'
}

function createDb(documentsDb: MemoryExtractionTestDb['db']) {
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

  const db = {
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
          id: CHAT_ID,
          projectId: null,
          project: null,
          messages: mocks.historyMessages,
        })),
      },
      keys: {
        findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
      },
      messages: { findFirst: vi.fn(async () => undefined) },
    },
    insert: vi.fn((table: unknown) => {
      return isDocumentsTable(table)
        ? documentsDb.insert(table as typeof schema.documents)
        : { values: insertValues }
    }),
    update: vi.fn((table: unknown) => {
      return isDocumentsTable(table)
        ? documentsDb.update(table as typeof schema.documents)
        : { set: updateSet }
    }),
    delete: vi.fn((table: typeof schema.documents) => {
      return documentsDb.delete(table)
    }),
    select: vi.fn((fields?: Record<string, unknown>) => {
      return fields ? documentsDb.select(fields) : documentsDb.select()
    }),
  }

  return { db, insertValues }
}

function stubChatProvider(toolCallSupported: boolean) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'openai' },
    model: {
      id: MODEL_ID,
      name: 'GPT-5 mini',
      tools: ['web_search', 'image_generation'],
      toolCall: toolCallSupported,
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
}

async function runSend(input: {
  documentsDb: MemoryExtractionTestDb['db']
  steps: Array<Array<Record<string, unknown>>>
  tools?: string[]
  providerTools?: Record<string, unknown>
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: input.providerTools ?? {},
    providerOptions: {},
  })))

  const module = await import('../../../server/api/v1/chats/[slug]/index.post')
  const created = createDb(input.documentsDb)

  vi.stubGlobal('useDb', () => created.db)

  const result = await module.default({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: MODEL_ID,
      tools: input.tools ?? [],
      reasoning: 'off',
      messages: [{
        id: 'user-public-1',
        role: 'user',
        parts: [{
          type: 'text',
          text: 'Write a quarterly report as a Word document.',
        }],
      }],
    },
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]

  return { doStream, assistantInsert }
}

function readToolNames(callOptions: any): string[] {
  return (callOptions?.tools ?? []).map((declared: { name: string }) => {
    return declared.name
  })
}

function readPromptText(callOptions: any): string {
  return JSON.stringify(callOptions?.prompt ?? [])
}

describe('document tool on the chat send path', () => {
  let testDb: MemoryExtractionTestDb
  let storage: FakeDocumentStorage

  afterEach(() => {
    vi.useRealTimers()
    testDb.close()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    storage = createFakeDocumentStorage()
    mocks.mergedStreams = []
    mocks.historyMessages = []
    mocks.activeFlags = new Set(['documents', 'documents.docx'])

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
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
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useFileStorage', () => storage)
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

  it('stores the spec, persists a data-document reference and no spec text', async () => {
    const spec = createDocxSpec(PARAGRAPH_COUNT, PARAGRAPH_REPEATS)

    expect(JSON.stringify(spec).length).toBeGreaterThan(190_000)

    const { doStream, assistantInsert } = await runSend({
      documentsDb: testDb.db,
      steps: [
        toolCall('call-1', 'create_document', spec),
        text('Your report is ready.'),
      ],
    })
    const firstCall = doStream.mock.calls[0]?.[0] as any
    const rows = await testDb.db.select().from(schema.documents)
    const parts = assistantInsert?.parts ?? []
    const persisted = JSON.stringify(parts)

    expect(readToolNames(firstCall)).toContain('create_document')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 1,
      format: 'docx',
      title: 'Quarterly report',
      status: 'spec_ready',
      createdVia: 'chat',
      originChatId: CHAT_ID,
      originMessagePublicId: assistantInsert.publicId,
      originModel: MODEL_ID,
      specVersion: 1,
    })
    expect(storage.objects.get(rows[0]!.specR2Key!)).toContain(SECRET_PARAGRAPH)
    expect(parts.filter((part: any) => {
      return part.type === 'data-document'
    })).toEqual([{
      type: 'data-document',
      data: {
        documentId: rows[0]!.id,
        format: 'docx',
        title: 'Quarterly report',
        specVersion: 1,
        status: 'spec_ready',
      },
    }])
    expect(parts.some((part: any) => {
      return String(part.type).startsWith('tool-')
    })).toBe(false)
    expect(persisted).not.toContain('confidential-paragraph')
    expect(Buffer.byteLength(persisted)).toBeLessThan(15_000)
    expect(parts.at(-1)).toMatchObject({
      type: 'text',
      text: 'Your report is ready.',
    })
  })

  it('persists a document-only reply without the empty-answer notice', async () => {
    const { doStream, assistantInsert } = await runSend({
      documentsDb: testDb.db,
      steps: [
        toolCall('call-1', 'create_document', createDocxSpec()),
        [{
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: createUsage(),
        }],
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(parts.filter((part: any) => part.type !== 'step-start'))
      .toHaveLength(1)
    expect(parts.find((part: any) => part.type !== 'step-start'))
      .toMatchObject({ type: 'data-document' })
  })

  it('writes no row and no spec object for a rejected spec', async () => {
    const { assistantInsert } = await runSend({
      documentsDb: testDb.db,
      steps: [
        toolCall('call-1', 'create_document', {
          specVersion: 1,
          format: 'docx',
          title: SECRET_PARAGRAPH,
          blocks: [{ type: 'bogus' }],
        }),
        text('The document could not be created.'),
      ],
    })

    expect(await testDb.db.select().from(schema.documents)).toEqual([])
    expect(storage.objects.size).toBe(0)
    expect((assistantInsert?.parts ?? []).some((part: any) => {
      return part.type === 'data-document'
    })).toBe(false)
  })

  it('persists no spec text for a call the schema rejects',
    async () => {
      const { assistantInsert } = await runSend({
        documentsDb: testDb.db,
        steps: [
          toolCall('call-1', 'create_document', {
            specVersion: 1,
            format: 'docx',
            title: SECRET_PARAGRAPH,
            blocks: [{ type: 'bogus' }],
          }),
          text('The document could not be created.'),
        ],
      })

      expect(JSON.stringify(assistantInsert?.parts ?? []))
        .not.toContain('confidential-paragraph')
    })

  it('puts the documents line into the model instructions',
    async () => {
      await seedDocument(testDb.db, {
        userId: 1,
        originChatId: CHAT_ID,
        format: 'pdf',
        title: 'Earlier brochure',
      })

      const { doStream } = await runSend({
        documentsDb: testDb.db,
        steps: [text('Hello.')],
      })
      const promptText = readPromptText(doStream.mock.calls[0]?.[0])

      expect(promptText).toContain('Documents already created in this chat')
      expect(promptText).toContain('Earlier brochure')
    })

  it('adds no documents line when the chat holds none', async () => {
    const { doStream } = await runSend({
      documentsDb: testDb.db,
      steps: [text('Hello.')],
    })

    expect(readPromptText(doStream.mock.calls[0]?.[0]))
      .not.toContain('Documents already created in this chat')
  })

  it('runs a follow-up turn that still offers the tool after a document', async () => {
    const { doStream } = await runSend({
      documentsDb: testDb.db,
      steps: [
        toolCall('call-1', 'create_document', createDocxSpec()),
        text('Done.'),
      ],
    })

    expect(doStream).toHaveBeenCalledTimes(2)

    const followUpCall = doStream.mock.calls[1]?.[0] as any

    expect(readToolNames(followUpCall)).toContain('create_document')
  })

  it('offers only the enabled formats to the model', async () => {
    mocks.activeFlags = new Set(['documents', 'documents.pdf'])

    const { doStream } = await runSend({
      documentsDb: testDb.db,
      steps: [text('Hello.')],
    })
    const createTool = (doStream.mock.calls[0]?.[0] as any).tools.find(
      (declared: { name: string }) => declared.name === 'create_document',
    )
    const schemaText = JSON.stringify(createTool.inputSchema)

    expect(schemaText).toContain('"pdf"')
    expect(schemaText).not.toContain('"docx"')
    expect(schemaText).not.toContain('"xlsx"')
  })

  it.each([
    ['the documents flag is off', () => {
      mocks.activeFlags = new Set(['documents.docx'])
    }, {}, []],
    ['no format flag is on', () => {
      mocks.activeFlags = new Set(['documents'])
    }, {}, []],
    ['the model cannot call tools', () => {
      stubChatProvider(false)
    }, {}, []],
    ['image generation is requested', () => {}, {}, ['image_generation']],
    ['a tool choice is forced', () => {}, {
      tools: {
        generate_image: tool({
          description: 'Forced tool.',
          inputSchema: z.object({ prompt: z.string() }),
          async execute() {
            return { ok: true }
          },
        }),
      },
      toolChoice: { type: 'tool', toolName: 'generate_image' },
    }, []],
  ])('registers no document tool when %s', async (
    _label,
    arrange,
    providerTools,
    tools,
  ) => {
    arrange()

    const { doStream } = await runSend({
      documentsDb: testDb.db,
      tools: tools as string[],
      providerTools: providerTools as Record<string, unknown>,
      steps: [text('Hello.')],
    })
    const callOptions = doStream.mock.calls[0]?.[0]

    expect(readToolNames(callOptions)).not.toContain('create_document')
    expect(readPromptText(callOptions))
      .not.toContain('Documents already created in this chat')
    expect(await testDb.db.select().from(schema.documents)).toEqual([])
  })

  it('does not offer the tool when only the artifacts flag is on', async () => {
    mocks.activeFlags = new Set(['artifacts'])

    const { doStream } = await runSend({
      documentsDb: testDb.db,
      steps: [text('Hello.')],
    })
    const names = readToolNames(doStream.mock.calls[0]?.[0])

    expect(names).not.toContain('create_document')
    expect(names).toContain('create_artifact')
  })

  it('registers the document and artifact tools side by side', async () => {
    mocks.activeFlags = new Set(['artifacts', 'documents', 'documents.docx'])

    const { doStream } = await runSend({
      documentsDb: testDb.db,
      steps: [text('Hello.')],
    })
    const names = readToolNames(doStream.mock.calls[0]?.[0])

    expect(names).toEqual(expect.arrayContaining([
      'create_artifact',
      'create_document',
    ]))
  })
})
