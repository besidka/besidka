import { beforeEach, describe, expect, it, vi } from 'vitest'

function createMockUIMessageStream(messageId: string) {
  return new ReadableStream({
    start(controller) {
      const chunks = [
        {
          type: 'start',
          messageId,
        },
        {
          type: 'text-start',
          id: 'text-1',
        },
        {
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hi',
        },
        {
          type: 'text-end',
          id: 'text-1',
        },
        {
          type: 'finish',
        },
      ]

      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

const mocks = vi.hoisted(() => ({
  convertFilesForAICalls: [] as unknown[][],
  streamTextCalls: [] as unknown[],
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      return new ReadableStream({
        start(controller) {
          const pendingMerges: Array<Promise<void>> = []
          const writer = {
            write: vi.fn((chunk: unknown) => {
              controller.enqueue(chunk)
            }),
            merge: vi.fn((stream: ReadableStream<unknown>) => {
              const pendingMerge = (async () => {
                const reader = stream.getReader()

                try {
                  while (true) {
                    const { done, value } = await reader.read()

                    if (done) {
                      break
                    }

                    controller.enqueue(value)
                  }
                } finally {
                  reader.releaseLock()
                }
              })()

              pendingMerges.push(pendingMerge)
            }),
          }

          Promise.resolve(execute({ writer }))
            .then(async () => {
              await Promise.all(pendingMerges)
              controller.close()
            })
            .catch((exception) => {
              controller.error(exception)
            })
        },
      })
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
    streamText: vi.fn((input) => {
      mocks.streamTextCalls.push(input)

      return {
        consumeStream: vi.fn(),
        toUIMessageStream: vi.fn((options) => {
          return createMockUIMessageStream(options.generateMessageId())
        }),
      }
    }),
    smoothStream: vi.fn(() => undefined),
    convertToModelMessages: vi.fn(async messages => messages),
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: {
    status?: number
    message?: string
    why?: string
    fix?: string
    code?: string
    providerRequestId?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  sanitizeMessagesForModelContext: vi.fn(messages => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(async (input) => {
    return input.parts
  }),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/index.post')

  return module.default
}

function createMessage(text: string) {
  return {
    id: 'message-1',
    role: 'user',
    parts: [
      {
        type: 'text',
        text,
      },
    ],
  }
}

function createDb(chat: {
  id: string
  projectId: string | null
  project: {
    id: string
    name: string
    instructions: string | null
    memory: string | null
    memoryStatus: string
  } | null
  messages: unknown[]
}) {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }))
  const insertCall = vi.fn(() => ({
    values: insertValues,
  }))
  const transaction = vi.fn(async (callback) => {
    return await callback({
      insert: insertCall,
      update: vi.fn(() => ({
        set: updateSet,
      })),
    })
  })

  insertValues.mockImplementation(() => ({
    returning: () => ({
      get: insertGet,
    }),
  }))

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => chat),
        },
      },
      insert: insertCall,
      transaction,
      update: vi.fn(() => ({
        set: updateSet,
      })),
    },
    insertValues,
    transaction,
    updateSet,
  }
}

describe('chat project instructions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.convertFilesForAICalls.length = 0
    mocks.streamTextCalls.length = 0

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      data?: unknown
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

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
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('validateMessageFilePolicy', vi.fn(async () => undefined))
    vi.stubGlobal('convertFilesForAI', vi.fn(async (messages) => {
      mocks.convertFilesForAICalls.push(messages)

      return {
        messages,
        missingFiles: [],
      }
    }))
    vi.stubGlobal('useChatProvider', vi.fn(() => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-5-mini' },
      modelName: 'GPT-5 mini',
    })))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: {},
      tools: {},
      providerOptions: {},
    })))
  })

  it('prepends project instructions to model context without persisting them', async () => {
    const handler = await getHandler()
    const { db, insertValues } = createDb({
      id: 'chat-1',
      projectId: 'project-1',
      project: {
        id: 'project-1',
        name: 'Roadmap',
        instructions: 'Stay focused on milestone decisions',
        memory: null,
        memoryStatus: 'idle',
      },
      messages: [],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    const convertMessages = mocks.convertFilesForAICalls[0] as Array<any>

    expect(convertMessages[0]).toMatchObject({
      role: 'system',
      parts: [
        {
          type: 'text',
        },
      ],
    })
    expect(convertMessages[0]?.parts[0]?.text).toContain(
      'Stay focused on milestone decisions',
    )
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
    }))
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({
      role: 'system',
    }))
    expect(mocks.markProjectsMemoryStale).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
  })

  it('does not prepend a system message when the project has no instructions', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      id: 'chat-1',
      projectId: 'project-1',
      project: {
        id: 'project-1',
        name: 'Roadmap',
        instructions: null,
        memory: null,
        memoryStatus: 'idle',
      },
      messages: [],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    const convertMessages = mocks.convertFilesForAICalls[0] as Array<any>

    expect(convertMessages).toHaveLength(1)
    expect(convertMessages[0]).toMatchObject({
      role: 'user',
    })
  })

  it('prepends ready project memory to model context', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      id: 'chat-1',
      projectId: 'project-1',
      project: {
        id: 'project-1',
        name: 'Roadmap',
        instructions: null,
        memory: 'User prefers milestone-based updates.',
        memoryStatus: 'ready',
      },
      messages: [],
    })

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5-mini',
        tools: [],
        reasoning: 'off',
        messages: [createMessage('Hello')],
      },
    } as any)

    const convertMessages = mocks.convertFilesForAICalls[0] as Array<any>

    expect(convertMessages[0]?.parts[0]?.text).toContain('Project memory:')
    expect(convertMessages[0]?.parts[0]?.text).toContain(
      'milestone-based updates',
    )
  })
})
