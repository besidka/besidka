import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
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
const QUIZ = [
  '<h1>Photosynthesis quiz</h1>',
  '<p>Question 1: What do plants need?</p>',
  '<p>Question 2: Where does it happen?</p>',
  '<p>Question 3: What is produced?</p>',
].join('\n')
const CONTEXT_BLOCK = '<chat_artifacts>\nstub artifact context\n</chat_artifacts>'

interface StoredArtifact {
  kind: string
  title: string
  versions: string[]
  originChatId: string | null
  originMessageId: string | null
}

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  aiLoggerSet: vi.fn(),
  activeFlags: new Set<string>(),
  artifacts: new Map<string, StoredArtifact>(),
  createArtifact: vi.fn(),
  appendArtifactVersion: vi.fn(),
  readArtifactVersion: vi.fn(),
  buildArtifactContextBlock: vi.fn(),
  resolveArtifactAttachmentParts: vi.fn(),
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
  buildArtifactContextBlock: mocks.buildArtifactContextBlock,
}))

vi.mock('~~/server/utils/artifacts/attachments', () => ({
  resolveArtifactAttachmentParts: mocks.resolveArtifactAttachmentParts,
}))

vi.mock('~~/server/utils/artifacts/chat-artifacts', () => ({
  listChatArtifactIds: vi.fn(async (input: {
    chatId: string
    attachedArtifactIds?: string[]
  }) => {
    return [...mocks.artifacts.entries()]
      .filter(([artifactId, artifact]) => {
        return artifact.originChatId === input.chatId
          || input.attachedArtifactIds?.includes(artifactId)
      })
      .map(([artifactId]) => artifactId)
  }),
}))

vi.mock('~~/server/utils/artifacts/store', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/artifacts/store')
  >()

  return {
    ...actual,
    createArtifact: mocks.createArtifact,
    appendArtifactVersion: mocks.appendArtifactVersion,
    readArtifactVersion: mocks.readArtifactVersion,
  }
})

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

function installArtifactStore() {
  let nextId = 1

  mocks.createArtifact.mockImplementation(async (
    input: Record<string, any>,
  ) => {
    const { encodeArtifactContent } = await import(
      '~~/server/utils/artifacts/store'
    )

    encodeArtifactContent(input.content)

    const artifactId = `art-${nextId++}`

    mocks.artifacts.set(artifactId, {
      kind: input.kind,
      title: input.title,
      versions: [input.content],
      originChatId: input.originChatId ?? null,
      originMessageId: input.originMessageId ?? null,
    })

    return { artifactId, version: 1, kind: input.kind, title: input.title }
  })
  mocks.readArtifactVersion.mockImplementation(async (input: {
    artifactId: string
  }) => {
    const artifact = mocks.artifacts.get(input.artifactId)

    if (!artifact) {
      throw Object.assign(new Error('Artifact not found'), {
        status: 404,
        code: 'artifact_not_found',
      })
    }

    return {
      artifactId: input.artifactId,
      kind: artifact.kind,
      title: artifact.title,
      version: artifact.versions.length,
      content: artifact.versions.at(-1),
      sizeBytes: 1,
      createdAt: new Date(0).toISOString(),
    }
  })
  mocks.appendArtifactVersion.mockImplementation(async (input: {
    artifactId: string
    content: string
    title?: string
  }) => {
    const artifact = mocks.artifacts.get(input.artifactId)!

    artifact.versions.push(input.content)
    artifact.title = input.title ?? artifact.title

    return {
      artifactId: input.artifactId,
      version: artifact.versions.length,
      kind: artifact.kind,
      title: artifact.title,
    }
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
            id: 'chat-1',
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
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
  }
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

function createAttachmentPart(artifactId: string, version = 1) {
  return {
    type: 'data-artifact-attachment',
    data: { artifactId, version, kind: 'html', title: 'Library quiz' },
  }
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  tools?: string[]
  parts?: Array<Record<string, unknown>>
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))

  const module = await import('../../../server/api/v1/chats/[slug]/index.post')
  const created = createDb()

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
        parts: input.parts ?? [{
          type: 'text',
          text: 'Make a quiz about photosynthesis.',
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

function readSystemPrompt(callOptions: any): string {
  const systemMessage = callOptions?.prompt?.find((message: any) => {
    return message.role === 'system'
  })

  return String(systemMessage?.content ?? '')
}

function readLastUserText(callOptions: any): string {
  const userMessage = (callOptions?.prompt ?? []).filter((message: any) => {
    return message.role === 'user'
  }).at(-1)

  return (userMessage?.content ?? []).map((part: any) => {
    return part.text ?? ''
  }).join('\n')
}

function readKindEnum(callOptions: any): string[] {
  const createTool = (callOptions?.tools ?? []).find((declared: any) => {
    return declared.name === 'create_artifact'
  })

  return createTool?.inputSchema?.properties?.kind?.enum ?? []
}

describe('artifact tools on the chat send path', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.artifacts.clear()
    mocks.historyMessages = []
    mocks.activeFlags = new Set(['artifacts', 'artifacts.react'])
    mocks.buildArtifactContextBlock.mockResolvedValue(null)
    mocks.resolveArtifactAttachmentParts.mockImplementation(
      async (input: { parts: unknown[] }) => input.parts,
    )
    installArtifactStore()

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

  it('creates and edits an artifact and persists only data-artifact parts', async () => {
    const { doStream, assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'create_artifact', {
          kind: 'html',
          title: 'Photosynthesis quiz',
          content: QUIZ,
        }),
        toolCall('call-2', 'update_artifact', {
          artifactId: 'art-1',
          edits: [{
            old_string: 'Question 3: What is produced?',
            new_string: 'Question 3: Which gas is released?',
          }],
        }),
        text('Your quiz is ready, and question 3 is updated.'),
      ],
    })
    const firstCall = doStream.mock.calls[0]?.[0] as any
    const parts = assistantInsert?.parts ?? []

    expect(readToolNames(firstCall)).toEqual(
      expect.arrayContaining(['create_artifact', 'update_artifact']),
    )
    expect(readSystemPrompt(firstCall)).toContain('`create_artifact`')
    expect(mocks.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      originChatId: 'chat-1',
      originMessageId: assistantInsert.publicId,
      createdVia: 'chat',
      createdBy: 'model',
      modelId: MODEL_ID,
    }))
    expect(mocks.artifacts.get('art-1')?.versions[1])
      .toContain('Which gas is released?')
    expect(parts.filter((part: any) => {
      return part.type === 'data-artifact'
    })).toEqual([
      {
        type: 'data-artifact',
        data: {
          artifactId: 'art-1',
          version: 1,
          kind: 'html',
          title: 'Photosynthesis quiz',
        },
      },
      {
        type: 'data-artifact',
        data: {
          artifactId: 'art-1',
          version: 2,
          kind: 'html',
          title: 'Photosynthesis quiz',
        },
      },
    ])
    expect(parts.some((part: any) => {
      return String(part.type).startsWith('tool-')
    })).toBe(false)
    expect(JSON.stringify(parts)).not.toContain('Question 1')
    expect(parts.at(-1)).toMatchObject({ type: 'text' })
  })

  it('keeps a failed edit as a reduced tool part and writes nothing', async () => {
    mocks.artifacts.set('art-7', {
      kind: 'html',
      title: 'Earlier quiz',
      versions: [QUIZ],
      originChatId: 'chat-1',
      originMessageId: 'old',
    })
    mocks.historyMessages = [
      {
        id: 'm-1',
        publicId: 'p-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Make a quiz.' }],
        tools: [],
        reasoning: 'off',
      },
      {
        id: 'm-2',
        publicId: 'p-2',
        role: 'assistant',
        parts: [
          {
            type: 'data-artifact',
            data: {
              artifactId: 'art-7',
              version: 1,
              kind: 'html',
              title: 'Earlier quiz',
            },
          },
          { type: 'text', text: 'Done.' },
        ],
        tools: [],
        reasoning: 'off',
      },
    ]
    mocks.buildArtifactContextBlock.mockResolvedValue(CONTEXT_BLOCK)

    const { doStream, assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'update_artifact', {
          artifactId: 'art-7',
          edits: [{ old_string: 'Question', new_string: 'Q' }],
        }),
        text('That edit was ambiguous, so nothing changed.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const firstCall = doStream.mock.calls[0]?.[0]

    expect(mocks.buildArtifactContextBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        chatId: 'chat-1',
        artifactIds: ['art-7'],
      }),
    )
    expect(readSystemPrompt(firstCall)).toContain('`create_artifact`')
    expect(readSystemPrompt(firstCall)).not.toContain(CONTEXT_BLOCK)
    expect(readLastUserText(firstCall)).toContain(CONTEXT_BLOCK)
    expect(mocks.appendArtifactVersion).not.toHaveBeenCalled()
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-update_artifact',
      state: 'output-error',
      input: {},
    }))
    expect(JSON.stringify(parts)).not.toContain('"edits"')
  })

  it('fails a 600 KB artifact with a tool error and still persists the reply', async () => {
    const { assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'create_artifact', {
          kind: 'markdown',
          title: 'Too big',
          content: 'a'.repeat(600 * 1024),
        }),
        text('The artifact was too large to save.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(mocks.artifacts.size).toBe(0)
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-create_artifact',
      state: 'output-error',
      input: { kind: 'markdown', title: 'Too big' },
    }))
    expect(JSON.stringify(parts).length).toBeLessThan(10_000)
    expect(parts.at(-1)).toMatchObject({
      type: 'text',
      text: 'The artifact was too large to save.',
    })
  })

  it('persists an artifact-only reply without the empty-answer notice', async () => {
    const { doStream, assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'create_artifact', {
          kind: 'svg',
          title: 'Leaf',
          content: '<svg/>',
        }),
        [{
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: createUsage(),
        }],
      ],
    })
    const parts = assistantInsert?.parts ?? []

    expect(doStream).toHaveBeenCalledTimes(2)
    expect(parts.filter((part: any) => part.type !== 'step-start')).toEqual([{
      type: 'data-artifact',
      data: { artifactId: 'art-1', version: 1, kind: 'svg', title: 'Leaf' },
    }])
  })

  it('drops react from the kind enum when artifacts.react is off', async () => {
    mocks.activeFlags = new Set(['artifacts'])

    const { doStream } = await runSend({ steps: [text('Hello.')] })
    const kinds = readKindEnum(doStream.mock.calls[0]?.[0])

    expect(kinds).toEqual(['html', 'svg', 'mermaid', 'markdown'])
  })

  it.each([
    ['the flag is off', () => {
      mocks.activeFlags = new Set()
    }, []],
    ['the model cannot call tools', () => {
      stubChatProvider(false)
    }, []],
    ['image generation is requested', () => {}, ['image_generation']],
  ])('registers no artifact tools when %s', async (_label, arrange, tools) => {
    arrange()

    const { doStream } = await runSend({
      tools: tools as string[],
      steps: [text('Hello.')],
    })
    const names = readToolNames(doStream.mock.calls[0]?.[0])

    expect(names).not.toContain('create_artifact')
    expect(names).not.toContain('update_artifact')
    expect(readSystemPrompt(doStream.mock.calls[0]?.[0]))
      .not.toContain('`create_artifact`')
  })
  describe('attached artifacts', () => {
    const attachedQuiz = {
      kind: 'html',
      title: 'Library quiz',
      versions: [QUIZ],
      originChatId: 'other-chat',
      originMessageId: 'old',
    }

    function sendWithAttachment(steps: Array<Array<Record<string, unknown>>>) {
      return runSend({
        steps,
        parts: [
          { type: 'text', text: 'Change question 3 of the attached quiz.' },
          createAttachmentPart('art-9'),
        ],
      })
    }

    it('validates the new message and hands the attached ids to the context',
      async () => {
        mocks.artifacts.set('art-9', { ...attachedQuiz })

        await sendWithAttachment([text('Done.')])

        expect(mocks.resolveArtifactAttachmentParts).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 1,
            onUnavailable: 'throw',
            parts: [
              expect.objectContaining({ type: 'text' }),
              createAttachmentPart('art-9'),
            ],
          }),
        )
        expect(mocks.buildArtifactContextBlock).toHaveBeenCalledWith(
          expect.objectContaining({
            chatId: 'chat-1',
            attachedArtifactIds: ['art-9'],
          }),
        )
      })

    it('lets update_artifact edit an attached artifact from another chat',
      async () => {
        mocks.artifacts.set('art-9', { ...attachedQuiz })

        const { assistantInsert } = await sendWithAttachment([
          toolCall('call-1', 'update_artifact', {
            artifactId: 'art-9',
            edits: [{
              old_string: 'Question 3: What is produced?',
              new_string: 'Question 3: Which gas is released?',
            }],
          }),
          text('Question 3 is updated.'),
        ])

        expect(mocks.artifacts.get('art-9')?.versions[1])
          .toContain('Which gas is released?')
        expect(assistantInsert?.parts.filter((part: any) => {
          return part.type === 'data-artifact'
        })).toEqual([{
          type: 'data-artifact',
          data: {
            artifactId: 'art-9',
            version: 2,
            kind: 'html',
            title: 'Library quiz',
          },
        }])
      })

    it('still refuses an artifact that is neither from this chat nor attached',
      async () => {
        mocks.artifacts.set('art-9', { ...attachedQuiz })

        const { assistantInsert } = await runSend({
          steps: [
            toolCall('call-1', 'update_artifact', {
              artifactId: 'art-9',
              edits: [{ old_string: 'Question', new_string: 'Q' }],
            }),
            text('I could not change that.'),
          ],
        })

        expect(mocks.appendArtifactVersion).not.toHaveBeenCalled()
        expect(assistantInsert?.parts).toContainEqual(expect.objectContaining({
          type: 'tool-update_artifact',
          state: 'output-error',
        }))
      })

    it('drops unavailable attachments instead of failing a stored message',
      async () => {
        mocks.artifacts.set('art-9', { ...attachedQuiz })
        mocks.historyMessages = [{
          id: 'm-1',
          publicId: 'user-public-1',
          role: 'user',
          parts: [
            { type: 'text', text: 'Change question 3.' },
            createAttachmentPart('art-9'),
          ],
          tools: [],
          reasoning: 'off',
        }]

        await sendWithAttachment([text('Done.')])

        expect(mocks.resolveArtifactAttachmentParts).toHaveBeenCalledWith(
          expect.objectContaining({ onUnavailable: 'drop' }),
        )
      })

    it('rejects the send before any model call when the user has no access',
      async () => {
        mocks.resolveArtifactAttachmentParts.mockRejectedValue(
          Object.assign(new Error('Not found'), {
            status: 404,
            why: 'feature_unavailable',
          }),
        )

        await expect(sendWithAttachment([text('Done.')])).rejects.toMatchObject({
          status: 404,
          why: 'feature_unavailable',
        })
        expect(mocks.buildArtifactContextBlock).not.toHaveBeenCalled()
      })

    it('adds no attached ids when the message has no attachments',
      async () => {
        await runSend({ steps: [text('Hello.')] })

        expect(mocks.buildArtifactContextBlock).toHaveBeenCalledWith(
          expect.objectContaining({ attachedArtifactIds: [] }),
        )
      })
  })
})
