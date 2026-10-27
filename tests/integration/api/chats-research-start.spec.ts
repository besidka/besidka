import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_USER_MESSAGE_TEXT_LENGTH } from '~~/server/utils/chats/request-schema'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  startResearchJobForChat: vi.fn(async () => ({
    job: {
      publicId: 'job-1',
      status: 'running',
      provider: 'openai',
      level: 'quick',
      modelId: 'o4-mini-deep-research',
      startedAt: Date.now(),
      error: null,
      resultMessageId: null,
    },
  })),
  validateMessageFilePolicy: vi.fn(async () => undefined),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/research/start', () => ({
  startResearchJobForChat: mocks.startResearchJobForChat,
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: mocks.validateMessageFilePolicy,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

async function getStartHandler() {
  const module = await import(
    '../../../server/api/v1/chats/[slug]/research/index.post'
  )

  return module.default
}

function createDb(overrides: {
  messages?: Array<{
    id: string
    publicId: string
    role: string
    parts: unknown[]
    tools: string[]
    reasoning: string
  }>
} = {}) {
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: () => ({
      returning: () => ({
        get: vi.fn(async () => ({
          id: 'message-db-id',
          publicId: 'user-message-1',
        })),
      }),
    }),
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            projectId: null,
            messages: overrides.messages ?? [],
          })),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
    updateSet,
    updateWhere,
  }
}

describe('research start API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.startResearchJobForChat.mockResolvedValue({
      job: {
        publicId: 'job-1',
        status: 'running',
        provider: 'openai',
        level: 'quick',
        modelId: 'o4-mini-deep-research',
        startedAt: Date.now(),
        error: null,
        resultMessageId: null,
      },
    })
    mocks.validateMessageFilePolicy.mockResolvedValue(undefined)

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
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  it('persists the user message and starts a research job', async () => {
    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
      },
    } as any)

    expect(response).toEqual({
      job: expect.objectContaining({
        publicId: 'job-1',
        status: 'running',
      }),
    })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      parts: [{ type: 'text', text: 'Research this topic' }],
      publicId: 'user-message-1',
    }))
    expect(mocks.startResearchJobForChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        chat: expect.objectContaining({ id: 'chat-1' }),
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
        model: 'gpt-5.4',
        answers: undefined,
      }),
    )
  })

  it('passes clarification answers through to the start helper', async () => {
    const handler = await getStartHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
        answers: [
          { id: 'q1', question: 'Which region?', answer: 'Europe' },
        ],
      },
    } as any)

    expect(mocks.startResearchJobForChat).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: [{ id: 'q1', question: 'Which region?', answer: 'Europe' }],
      }),
    )
  })

  it('rejects a non-text part in the user message', async () => {
    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [
            { type: 'text', text: 'Research this topic' },
            {
              type: 'file',
              mediaType: 'application/pdf',
              url: 'https://example.com/file.pdf',
            },
          ],
        },
      },
    } as any)).rejects.toThrow(
      'Deep research only supports text-only prompts for now.',
    )
    expect(insertValues).not.toHaveBeenCalled()
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'text', text: 1 },
    { type: 'text', text: { nested: 'value' } },
    { type: 'text' },
    { type: 'unknown', text: 'Research this topic' },
  ])('rejects a malformed part %j with a 400 and persists nothing', async (part) => {
    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [
            { type: 'text', text: 'Research this topic' },
            part,
          ],
        },
      },
    } as any)).rejects.toMatchObject({
      message: 'Invalid request body',
      status: 400,
    })
    expect(insertValues).not.toHaveBeenCalled()
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('rejects a message whose only part has a non-string text', async () => {
    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 1 }],
        },
      },
    } as any)).rejects.toMatchObject({
      message: 'Invalid request body',
      status: 400,
    })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects an oversized text part', async () => {
    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [
            { type: 'text', text: 'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH + 1) },
          ],
        },
      },
    } as any)).rejects.toMatchObject({
      message: 'Invalid request body',
      status: 400,
    })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('404s when the chat does not belong to the user', async () => {
    const handler = await getStartHandler()
    const { db } = createDb()

    db.query.chats.findFirst = vi.fn(async () => null)
    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
      },
    } as any)).rejects.toThrow('Chat not found.')
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('propagates a file policy rejection before starting the research job', async () => {
    mocks.validateMessageFilePolicy.mockRejectedValue(
      Object.assign(new Error('You can attach a maximum of 5 files per message'), {
        statusCode: 400,
      }),
    )

    const handler = await getStartHandler()
    const { db, insertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
      },
    } as any)).rejects.toThrow(
      'You can attach a maximum of 5 files per message',
    )
    expect(insertValues).not.toHaveBeenCalled()
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('surfaces a 409 when the start helper reports an active job conflict', async () => {
    mocks.startResearchJobForChat.mockRejectedValue(
      Object.assign(new Error('A research job is already running for this chat.'), {
        statusCode: 409,
      }),
    )

    const handler = await getStartHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      body: {
        model: 'gpt-5.4',
        userMessage: {
          id: 'user-message-1',
          parts: [{ type: 'text', text: 'Research this topic' }],
        },
      },
    } as any)).rejects.toThrow(
      'A research job is already running for this chat.',
    )
  })
})
