import { beforeEach, describe, expect, it, vi } from 'vitest'

function createChat(overrides: Partial<{
  id: string
  slug: string
  title: string | null
  projectId: string | null
  branchedFromShareSlug: string | null
  messages: unknown[]
}> = {}) {
  return {
    id: 'chat-1',
    slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    title: 'Test chat',
    projectId: null,
    branchedFromShareSlug: null,
    messages: [],
    ...overrides,
  }
}

function createMessage(overrides: Partial<{
  id: string
  publicId: string | null
  role: 'user' | 'assistant'
  parts: unknown[]
  tools: unknown[]
  reasoning: 'off' | 'low' | 'medium' | 'high'
  createdAt: Date
  usage: unknown
}> = {}) {
  return {
    id: 'message-1',
    publicId: null,
    role: 'assistant' as const,
    parts: [],
    tools: [],
    reasoning: 'off' as const,
    createdAt: new Date(),
    usage: null,
    ...overrides,
  }
}

interface FileFixture {
  id: string
  userId: number
  storageKey: string
  name: string
  size: number
  type: string
  source: 'upload' | 'assistant'
  originProvider: string | null
  originModel: string | null
}

function createJob(overrides: Partial<{
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  resultMessageId: string | null
  completedAt: Date | null
}> = {}) {
  return {
    id: 'job-1',
    chatId: 'chat-1',
    userId: 1,
    provider: 'openai' as const,
    level: 'quick' as const,
    modelId: 'o4-mini-deep-research',
    providerJobId: 'resp_abc123',
    status: 'running' as const,
    resultMessageId: null,
    error: null,
    usage: null,
    answers: null,
    userMessageId: 'user-message-1',
    startedAt: new Date(),
    createdAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function createDb(input: {
  chat?: ReturnType<typeof createChat> | null
  latestJob?: ReturnType<typeof createJob> | null
  files?: FileFixture[]
} = {}) {
  const chatsFindFirst = vi.fn(async () => (
    input.chat === undefined ? createChat() : input.chat
  ))
  const researchJobsFindFirst = vi.fn(async () => (
    input.latestJob === undefined ? null : input.latestJob
  ))
  const fileFixtures = input.files ?? []
  const filesFindMany = vi.fn(async (query: {
    where: {
      userId: number
      source: string
      storageKey: { in: string[] }
    }
  }) => {
    return fileFixtures.filter((file) => {
      return file.userId === query.where.userId
        && file.source === query.where.source
        && query.where.storageKey.in.includes(file.storageKey)
    })
  })

  return {
    db: {
      query: {
        chats: { findFirst: chatsFindFirst },
        researchJobs: { findFirst: researchJobsFindFirst },
        files: { findMany: filesFindMany },
      },
    },
    chatsFindFirst,
    researchJobsFindFirst,
    filesFindMany,
  }
}

async function getChatHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/index.get')

  return module.default
}

describe('chat detail API — activeResearchJob visibility', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('includes a pending job as the active research job', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({ status: 'pending' }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toEqual(expect.objectContaining({
      publicId: 'job-1',
      status: 'pending',
    }))
  })

  it('includes a failed job completed within the last 24 hours', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'failed',
        completedAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toEqual(expect.objectContaining({
      publicId: 'job-1',
      status: 'failed',
    }))
  })

  it('excludes a failed job completed more than 24 hours ago', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'failed',
        completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('excludes a cancelled job even when it is recent', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'cancelled',
        completedAt: new Date(),
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('excludes a completed job since its report message already exists', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({
      latestJob: createJob({
        status: 'completed',
        completedAt: new Date(),
        resultMessageId: 'assistant-1',
      }),
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })

  it('returns null when the chat has no research jobs', async () => {
    const handler = await getChatHandler()
    const { db } = createDb({ latestJob: null })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.activeResearchJob).toBeNull()
  })
})

describe('chat detail API — generated image reconstruction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
    }) => {
      const exception = new Error(input.statusMessage || 'Error')

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('replaces a persisted generated image file part with a tool-generate_image part', async () => {
    const handler = await getChatHandler()
    const message = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here you go' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'sunset.png',
          url: '/files/generated-key.png?generated=1',
        },
      ],
    })
    const { db } = createDb({
      chat: createChat({ messages: [message] }),
      files: [
        {
          id: 'file-1',
          userId: 1,
          storageKey: 'generated-key.png',
          name: 'sunset.png',
          size: 2048,
          type: 'image/png',
          source: 'assistant',
          originProvider: 'openai',
          originModel: 'gpt-image-1',
        },
      ],
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.messages[0].parts[1]).toEqual({
      type: 'tool-generate_image',
      toolCallId: 'reconstructed-file-1',
      state: 'output-available',
      input: {},
      output: {
        status: 'ready',
        provider: 'openai',
        model: 'gpt-image-1',
        file: {
          id: 'file-1',
          storageKey: 'generated-key.png',
          name: 'sunset.png',
          size: 2048,
          type: 'image/png',
          source: 'assistant',
          url: '/files/generated-key.png',
          downloadUrl: '/files/generated-key.png?download=1',
        },
      },
    })
  })

  it('leaves a legacy generated file part untouched when origin metadata is missing', async () => {
    const handler = await getChatHandler()
    const message = createMessage({
      id: 'assistant-2',
      role: 'assistant',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'legacy.png',
          url: '/files/legacy-key.png',
        },
      ],
    })
    const { db } = createDb({
      chat: createChat({ messages: [message] }),
      files: [
        {
          id: 'file-3',
          userId: 1,
          storageKey: 'legacy-key.png',
          name: 'legacy.png',
          size: 4096,
          type: 'image/png',
          source: 'assistant',
          originProvider: 'openai',
          originModel: null,
        },
      ],
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.messages[0].parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'legacy.png',
      url: '/files/legacy-key.png',
    })
  })

  it('leaves an uploaded file part untouched', async () => {
    const handler = await getChatHandler()
    const message = createMessage({
      id: 'user-1',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'photo.png',
          url: '/files/uploaded-key.png',
        },
      ],
    })
    const { db } = createDb({
      chat: createChat({ messages: [message] }),
      files: [
        {
          id: 'file-2',
          userId: 1,
          storageKey: 'uploaded-key.png',
          name: 'photo.png',
          size: 1024,
          type: 'image/png',
          source: 'upload',
          originProvider: null,
          originModel: null,
        },
      ],
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.messages[0].parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'photo.png',
      url: '/files/uploaded-key.png',
    })
  })

  it('does not trust the spoofable generated marker without a matching files row', async () => {
    const handler = await getChatHandler()
    const message = createMessage({
      id: 'user-2',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'spoofed.png',
          url: '/files/spoofed-key.png?generated=1',
        },
      ],
    })
    const { db } = createDb({
      chat: createChat({ messages: [message] }),
      files: [],
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response.messages[0].parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'spoofed.png',
      url: '/files/spoofed-key.png?generated=1',
    })
  })
})
