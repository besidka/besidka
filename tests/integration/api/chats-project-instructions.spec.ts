import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  convertFilesForAICalls: [] as unknown[][],
  streamTextCalls: [] as unknown[],
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('ai', () => ({
  createUIMessageStream: ({ execute }: { execute: Function }) => {
    execute({
      writer: {
        write: vi.fn(),
        merge: vi.fn(),
      },
    })

    return { stream: true }
  },
  createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
  streamText: vi.fn((input) => {
    mocks.streamTextCalls.push(input)

    return {
      consumeStream: vi.fn(),
      toUIMessageStream: vi.fn(() => ({})),
    }
  }),
  smoothStream: vi.fn(() => undefined),
  convertToModelMessages: vi.fn(async messages => messages),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
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
    const insertValues = vi.fn(async () => undefined)
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({
      where: updateWhere,
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
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
          })),
        },
      },
      insert: vi.fn(() => ({
        values: insertValues,
      })),
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }

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
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
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
          })),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(async () => undefined),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }

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
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
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
          })),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(async () => undefined),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }

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
