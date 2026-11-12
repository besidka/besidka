import { beforeEach, describe, expect, it, vi } from 'vitest'
import anthropicChart from '../../fixtures/code-execution/anthropic-chart.json'
import openaiCsv from '../../fixtures/code-execution/openai-csv.json'
import googleStdout from '../../fixtures/code-execution/google-stdout.json'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  streamTextOptions: [] as Array<Record<string, any>>,
  uiChunks: undefined as Array<Record<string, unknown>> | undefined,
  activeFlags: new Set<string>(),
  persistContainerFiles: vi.fn(),
  deleteCalls: [] as string[],
  uploadCalls: [] as string[],
  ownedFiles: vi.fn(),
  conversions: [] as Array<{ messages: any[] }>,
}))

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      const chunks = mocks.uiChunks ?? [
        { type: 'start', messageId },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Hi' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish' },
      ]

      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      const writer = { write: vi.fn(), merge: vi.fn() }
      const ready = execute({ writer })

      return { writer, ready }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
    streamText: vi.fn((options: Record<string, any>) => {
      mocks.streamTextOptions.push(options)
      options.onEnd?.({ usage: { inputTokens: 1 }, steps: [] })

      return {
        consumeStream: vi.fn(),
        stream: new ReadableStream({ start(c) {
          c.close()
        } }),
        usage: Promise.resolve({ inputTokens: 1 }),
        steps: Promise.resolve([{ usage: { inputTokens: 1 } }]),
        finalStep: Promise.resolve({}),
      }
    }),
    toUIMessageStream: vi.fn((options) => {
      return createMockUIMessageStream(options.generateMessageId())
    }),
    smoothStream: vi.fn(() => undefined),
    convertToModelMessages: vi.fn(async (messages: Array<{ role: string }>) => {
      return messages.map((message) => {
        return { role: message.role, content: [{ type: 'text', text: 'x' }] }
      })
    }),
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
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createError: (input: { status?: number, message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  getModelContextFileStorageKeys: vi.fn(() => []),
  getGeneratedImageFileIds: vi.fn(() => []),
  isKnownImageGenerationModel: vi.fn(() => true),
  buildModelContextMessages: vi.fn(
    (messages: unknown) => ({ messages, omittedFiles: [] }),
  ),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown[] }) => input.parts,
  ),
  persistGatewayGeneratedImageParts: vi.fn(
    async (input: { parts: unknown }) => ({
      parts: input.parts,
      fileIds: [],
    }),
  ),
  isPersistedOversizedResponseFailureText: vi.fn(() => false),
  stripUndeliveredInlineDataParts: vi.fn((parts: unknown) => parts),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/file-governance')
  >()

  return {
    ...actual,
    getOwnedFilesByStorageKeys: mocks.ownedFiles,
    validateMessageFilePolicy: vi.fn(async () => undefined),
  }
})

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: vi.fn(async () => ({
    isFeatureActive: (flag: string) => mocks.activeFlags.has(flag),
  })),
}))

vi.mock('~~/server/utils/code-execution/persist-container-files', () => ({
  persistContainerFiles: mocks.persistContainerFiles,
}))

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
  const keysFindFirst = vi.fn(async () => ({ apiKey: 'encrypted-key' }))

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
            messages: [],
          })),
        },
        keys: { findFirst: keysFindFirst },
        messages: { findFirst: vi.fn(async () => ({ usage: undefined })) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    },
    insertValues,
    keysFindFirst,
  }
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-haiku-5-5',
    tools: ['code_execution'],
    reasoning: 'off',
    messages: [{
      id: 'user-public-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Plot it' }],
    }],
    ...overrides,
  }
}

function getAssistantInsert(insertValues: ReturnType<typeof vi.fn>) {
  return insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]
}

async function runHandler(body: Record<string, unknown>) {
  const handler = await getHandler()
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await handler({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body,
  } as any)

  await result.ready

  return created
}

function withMessageId(chunks: unknown[]) {
  return chunks.map((chunk) => {
    return (chunk as { type: string }).type === 'start'
      ? { type: 'start', messageId: 'assistant-1' }
      : chunk
  }) as Array<Record<string, unknown>>
}

function stubProvider(providerId: string, tools: string[], modelId: string) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: providerId },
    model: {
      id: modelId,
      name: modelId,
      tools,
      toolCall: true,
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
}

describe('chat send pipeline: provider code execution', () => {
  const useAnthropic = vi.fn()
  const useOpenAI = vi.fn()
  const useGoogle = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const { convertFilesForAI } = await import(
      '~~/server/utils/files/convert-files-for-ai'
    )

    mocks.streamTextOptions = []
    mocks.conversions = []
    mocks.uiChunks = undefined
    mocks.activeFlags = new Set(['code-execution', 'code-execution.files'])
    mocks.deleteCalls = []
    mocks.uploadCalls = []
    mocks.ownedFiles.mockResolvedValue(
      new Map([['key1.csv', {
        id: 'f1',
        storageKey: 'key1.csv',
        size: 4,
        type: 'text/csv',
      }]]),
    )
    mocks.persistContainerFiles.mockResolvedValue({
      saved: [{
        fileId: 'file-row-1',
        url: '/files/abc.png?generated=1',
        filename: 'chart.png',
        mediaType: 'image/png',
        bytes: 10,
      }],
      skipped: [],
      provenanceMissing: 0,
    })

    useAnthropic.mockImplementation(async (
      _userId: string,
      _model: string,
      tools: string[],
    ) => ({
      instance: {},
      tools: tools.includes('code_execution')
        ? { tools: { code_execution: { id: 'anthropic.code_execution' } } }
        : {},
      providerOptions: {},
    }))
    useOpenAI.mockResolvedValue({
      instance: {},
      tools: { tools: { code_execution: { id: 'openai.code_interpreter' } } },
      providerOptions: {},
    })
    useGoogle.mockResolvedValue({
      instance: {},
      tools: { tools: { code_execution: { id: 'google.code_execution' } } },
      providerOptions: {},
    })

    vi.stubGlobal('useAnthropic', useAnthropic)
    vi.stubGlobal('useOpenAI', useOpenAI)
    vi.stubGlobal('useGoogle', useGoogle)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        mocks.deleteCalls.push(String(url))
      }

      if (init?.method === 'POST') {
        mocks.uploadCalls.push(String(url))

        return new Response(JSON.stringify({ id: 'file_in_1' }), {
          status: 200,
        })
      }

      return new Response(null, { status: 200 })
    }))
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn(async (key: string) => ({
        arrayBuffer: async () => (
          key.endsWith('.text.md')
            ? new TextEncoder().encode('Quarterly numbers').buffer
            : new ArrayBuffer(4)
        ),
        text: async () => 'a,b',
      })),
    }))
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
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal(
      'useUserSession',
      vi.fn().mockResolvedValue({ user: { id: '1' } }),
    )
    vi.stubGlobal('validateMessageFilePolicy', vi.fn(async () => undefined))
    vi.stubGlobal('convertFilesForAI', async (
      messages: Parameters<typeof convertFilesForAI>[0],
      options: Parameters<typeof convertFilesForAI>[1],
    ) => {
      const result = await convertFilesForAI(messages, options)

      mocks.conversions.push(result)

      return result
    })
    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('getModelCostMap', vi.fn(() => ({})))
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('buildPersistedAssistantReplayChunks', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
      public: {
        openaiCodeInterpreterCostPerSessionUsd: '0.03',
      },
    })))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
  })

  it('registers the tool for Anthropic, saves the files, persists a compact part and deletes provider copies', async () => {
    stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
    mocks.uiChunks = withMessageId(anthropicChart)

    const { insertValues } = await runHandler(baseBody())

    expect(useAnthropic).toHaveBeenCalledWith(
      '1',
      'claude-haiku-5-5',
      ['code_execution'],
      'off',
    )
    expect(mocks.streamTextOptions[0]?.tools).toEqual({
      code_execution: expect.anything(),
    })
    expect(mocks.streamTextOptions[0]?.toolChoice).toBeUndefined()

    const assistant = getAssistantInsert(insertValues)
    const serialized = JSON.stringify(assistant?.parts)

    expect(assistant?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-code_execution',
        state: 'output-available',
        input: expect.objectContaining({ language: 'python' }),
        output: { stdout: '', stderr: '', returnCode: 0 },
      }),
      expect.objectContaining({
        type: 'file',
        url: '/files/abc.png?generated=1',
        filename: 'chart.png',
      }),
    ]))
    expect(serialized).not.toContain('file_chart')
    expect(serialized).not.toContain('ENCRYPTED-PAYLOAD-MUST-NOT-LEAK')
    expect(mocks.deleteCalls).toEqual([
      'https://api.anthropic.com/v1/files/file_chart',
      'https://api.anthropic.com/v1/files/file_archive',
    ])
  })

  it('keeps OpenAI container ids out of the stored message and deletes the container', async () => {
    stubProvider('openai', ['code_execution'], 'gpt-6-luna')
    mocks.uiChunks = withMessageId(openaiCsv)

    const { insertValues } = await runHandler(baseBody({
      model: 'gpt-6-luna',
    }))
    const serialized = JSON.stringify(
      getAssistantInsert(insertValues)?.parts,
    )

    expect(serialized).not.toContain('cntr_01')
    expect(serialized).not.toContain('cfile_01')
    expect(serialized).not.toContain('container_file_citation')
    expect(mocks.deleteCalls).toEqual([
      'https://api.openai.com/v1/containers/cntr_01',
    ])
  })

  it('shows Gemini output and never touches provider files', async () => {
    stubProvider('google', ['code_execution'], 'gemini-3.8-flash')
    mocks.uiChunks = withMessageId(googleStdout)

    const { insertValues } = await runHandler(baseBody({
      model: 'gemini-3.8-flash',
    }))

    expect(getAssistantInsert(insertValues)?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-code_execution',
          output: { stdout: '45\n', stderr: '', returnCode: 0 },
        }),
      ]),
    )
    expect(mocks.persistContainerFiles).not.toHaveBeenCalled()
    expect(mocks.deleteCalls).toEqual([])
  })

  it('drops the tool, starts no session and spends nothing while the feature is off for the user', async () => {
    stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
    mocks.activeFlags = new Set()

    const { keysFindFirst } = await runHandler(baseBody())

    expect(useAnthropic).toHaveBeenCalledWith(
      '1',
      'claude-haiku-5-5',
      [],
      'off',
    )
    expect(mocks.streamTextOptions[0]?.tools).toBeUndefined()
    expect(keysFindFirst).not.toHaveBeenCalled()
    expect(mocks.deleteCalls).toEqual([])
  })

  it('refuses the tool on a model that does not advertise it', async () => {
    stubProvider('anthropic', [], 'claude-haiku-5-5')

    await expect(runHandler(baseBody())).rejects.toMatchObject({
      status: 400,
    })
    expect(useAnthropic).not.toHaveBeenCalled()
  })

  it.each(['deepseek', 'moonshotai', 'qwen', 'xai'])(
    'refuses the tool for %s even if a model were to advertise it',
    async (providerId) => {
      stubProvider(providerId, ['code_execution'], 'some-model')

      await expect(runHandler(baseBody({ model: 'some-model' })))
        .rejects.toMatchObject({ status: 400 })
      expect(mocks.streamTextOptions).toHaveLength(0)
    },
  )

  it('rejects the tool for every gateway model', async () => {
    await expect(runHandler(baseBody({
      model: 'vercel:anthropic/claude-haiku-4.5',
    }))).rejects.toMatchObject({ status: 400 })
    expect(mocks.streamTextOptions).toHaveLength(0)
  })

  it('deletes the provider copies even when the stream fails before it finishes', async () => {
    stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
    mocks.uiChunks = withMessageId(
      anthropicChart.filter((chunk) => {
        return chunk.type !== 'finish-step' && chunk.type !== 'finish'
      }),
    )
    mocks.uiChunks.push({ type: 'error', errorText: 'provider failed' })

    await runHandler(baseBody())

    expect(mocks.persistContainerFiles).not.toHaveBeenCalled()
    expect(mocks.deleteCalls).toEqual([
      'https://api.anthropic.com/v1/files/file_chart',
      'https://api.anthropic.com/v1/files/file_archive',
    ])
  })

  describe('Office and JSON files with Run code', () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    function stubOwned(
      key: string,
      type: string,
      overrides: Record<string, unknown> = {},
    ) {
      mocks.ownedFiles.mockResolvedValue(new Map([[key, {
        id: 'f1',
        storageKey: key,
        size: 4,
        type,
        textStatus: null,
        textBytes: null,
        textVersion: null,
        ...overrides,
      }]]))
    }

    function bodyWith(
      key: string,
      mediaType: string,
      filename: string,
      overrides: Record<string, unknown> = {},
    ) {
      return baseBody({
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [
            { type: 'text', text: 'Use it' },
            { type: 'file', mediaType, filename, url: `/files/${key}` },
          ],
        }],
        ...overrides,
      })
    }

    function getModelContainerUploads() {
      const messages = mocks.streamTextOptions[0]?.messages as Array<{
        content: unknown
      }>

      return messages.flatMap((message) => {
        return Array.isArray(message.content) ? message.content : []
      }).filter((part: any) => part.providerOptions?.anthropic?.containerUpload)
    }

    function getConvertedParts() {
      return mocks.conversions[0]?.messages.flatMap((message) => {
        return message.parts
      }) as Array<Record<string, any>>
    }

    function getConvertedFileParts() {
      return getConvertedParts().filter(part => part.type === 'file')
    }

    function getConvertedText() {
      return getConvertedParts()
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
    }

    it('uploads an Office file with no readable text on Anthropic and sends no raw part', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      stubOwned('plan.docx', DOCX, { textStatus: 'failed' })

      await runHandler(bodyWith('plan.docx', DOCX, 'plan.docx'))

      expect(mocks.uploadCalls).toEqual(['https://api.anthropic.com/v1/files'])
      expect(getConvertedFileParts()).toEqual([])
      expect(getConvertedText()).toContain('Available in the code sandbox')
      expect(getModelContainerUploads()).toHaveLength(1)
    })

    it('gives the model the extracted text and still uploads the file', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      stubOwned('plan.docx', DOCX, {
        textStatus: 'ready',
        textBytes: 17,
        textVersion: 1,
      })

      await runHandler(bodyWith('plan.docx', DOCX, 'plan.docx'))

      expect(mocks.uploadCalls).toEqual(['https://api.anthropic.com/v1/files'])
      expect(getConvertedText()).toContain('Quarterly numbers')
      expect(getConvertedFileParts()).toEqual([])
      expect(getModelContainerUploads()).toHaveLength(1)
    })

    it('uploads a re-attached JSON output for OpenAI and sends no raw part', async () => {
      stubProvider('openai', ['code_execution'], 'gpt-6-luna')
      stubOwned('out.json', 'application/json')

      await runHandler({
        ...bodyWith('out.json', 'application/json', 'out.json'),
        model: 'gpt-6-luna',
      })

      expect(mocks.uploadCalls).toEqual(['https://api.openai.com/v1/files'])
      expect(useOpenAI).toHaveBeenCalledWith(
        '1',
        'gpt-6-luna',
        ['code_execution'],
        'off',
        expect.any(String),
        ['file_in_1'],
      )
      expect(getConvertedFileParts()).toEqual([])
    })

    it('keeps the Office part inline for Gemini, which takes attachments inline', async () => {
      stubProvider('google', ['code_execution'], 'gemini-3.1-pro')
      stubOwned('plan.docx', DOCX, { textStatus: 'failed' })

      await runHandler({
        ...bodyWith('plan.docx', DOCX, 'plan.docx'),
        model: 'gemini-3.1-pro',
      })

      expect(mocks.uploadCalls).toEqual([])
      expect(getConvertedFileParts()).toEqual([
        expect.objectContaining({ mediaType: DOCX }),
      ])
    })

    it('refuses an unreadable Office file when the sandbox gets no files', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      stubOwned('plan.docx', DOCX, { textStatus: 'failed' })
      mocks.activeFlags = new Set(['code-execution'])

      await expect(runHandler(bodyWith('plan.docx', DOCX, 'plan.docx')))
        .rejects.toMatchObject({ status: 400 })
      expect(mocks.uploadCalls).toEqual([])
    })

    it('refuses a JSON file without Run code', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      stubOwned('out.json', 'application/json')

      await expect(runHandler(bodyWith(
        'out.json',
        'application/json',
        'out.json',
        { tools: [] },
      ))).rejects.toMatchObject({
        status: 400,
        message: 'out.json cannot be sent to claude-haiku-5-5.',
      })
    })
  })

  describe('with an attached file', () => {
    function bodyWithAttachment() {
      return baseBody({
        messages: [{
          id: 'user-public-1',
          role: 'user',
          parts: [
            { type: 'text', text: 'Plot it' },
            {
              type: 'file',
              mediaType: 'text/csv',
              filename: 'data.csv',
              url: '/files/key1.csv',
            },
          ],
        }],
      })
    }

    it('uploads it for the container, hands it over as a container upload and deletes it after the turn', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')

      await runHandler(bodyWithAttachment())

      expect(mocks.uploadCalls).toEqual(['https://api.anthropic.com/v1/files'])

      const messages = mocks.streamTextOptions[0]?.messages as Array<{
        role: string
        content: Array<Record<string, any>>
      }>
      const lastContent = messages.at(-1)?.content

      expect(lastContent).toContainEqual(expect.objectContaining({
        type: 'file',
        data: { anthropic: 'file_in_1' },
        providerOptions: { anthropic: { containerUpload: true } },
      }))
      expect(mocks.deleteCalls).toContain(
        'https://api.anthropic.com/v1/files/file_in_1',
      )
      expect(String(mocks.streamTextOptions[0]?.instructions)).toContain(
        'attached files are available inside the sandbox: data.csv',
      )
    })

    it('uploads nothing while code-execution.files is off', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      mocks.activeFlags = new Set(['code-execution'])

      await runHandler(bodyWithAttachment())

      expect(mocks.uploadCalls).toEqual([])
      expect(mocks.deleteCalls).toEqual([])
    })

    it('deletes the upload when provider setup fails after it', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      useAnthropic.mockRejectedValueOnce(new Error('provider setup failed'))

      await runHandler(bodyWithAttachment())

      expect(mocks.uploadCalls).toHaveLength(1)
      expect(mocks.streamTextOptions).toHaveLength(0)
      expect(mocks.deleteCalls).toEqual([
        'https://api.anthropic.com/v1/files/file_in_1',
      ])
    })

    it('deletes the upload when the send fails after the stream started', async () => {
      stubProvider('anthropic', ['code_execution'], 'claude-haiku-5-5')
      mocks.uiChunks = [
        { type: 'start', messageId: 'assistant-1' },
        { type: 'error', errorText: 'provider failed' },
      ]

      await runHandler(bodyWithAttachment())

      expect(mocks.deleteCalls).toContain(
        'https://api.anthropic.com/v1/files/file_in_1',
      )
    })

    it('hands OpenAI the uploaded id as a container file and deletes it', async () => {
      stubProvider('openai', ['code_execution'], 'gpt-6-luna')

      await runHandler({ ...bodyWithAttachment(), model: 'gpt-6-luna' })

      expect(mocks.uploadCalls).toEqual(['https://api.openai.com/v1/files'])
      expect(useOpenAI).toHaveBeenCalledWith(
        '1',
        'gpt-6-luna',
        ['code_execution'],
        'off',
        expect.any(String),
        ['file_in_1'],
      )
      expect(mocks.deleteCalls).toContain(
        'https://api.openai.com/v1/files/file_in_1',
      )
    })
  })
})
