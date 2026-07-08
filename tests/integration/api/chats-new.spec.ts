import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateMessageFilePolicy: vi.fn(async () => undefined),
  loggerSet: vi.fn(),
  markProjectsMemoryStale: vi.fn(async () => undefined),
  resolveResearchStartContext: vi.fn(async () => ({
    provider: { id: 'openai', name: 'OpenAI' },
    research: { assistModel: 'gpt-5.4-nano' },
    levelConfig: { modelId: 'o4-mini-deep-research' },
    supportedProviderId: 'openai',
    apiKey: 'decrypted-api-key',
  })),
  startResearchJobForChat: vi.fn(async () => ({
    jobId: 'job-1',
    status: 'running',
  })),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: mocks.validateMessageFilePolicy,
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: mocks.markProjectsMemoryStale,
}))

vi.mock('~~/server/utils/research/start', () => ({
  resolveResearchStartContext: mocks.resolveResearchStartContext,
  startResearchJobForChat: mocks.startResearchJobForChat,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      statusCode: input.status,
      why: input.why,
    })

    return exception
  },
}))

async function getNewChatHandler() {
  const module = await import('../../../server/api/v1/chats/new/index.put')

  return module.default
}

describe('new chat API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.validateMessageFilePolicy.mockResolvedValue(undefined)
    mocks.loggerSet.mockReset()
    mocks.markProjectsMemoryStale.mockResolvedValue(undefined)
    mocks.resolveResearchStartContext.mockReset()
    mocks.resolveResearchStartContext.mockResolvedValue({
      provider: { id: 'openai', name: 'OpenAI' },
      research: { assistModel: 'gpt-5.4-nano' },
      levelConfig: { modelId: 'o4-mini-deep-research' },
      supportedProviderId: 'openai',
      apiKey: 'decrypted-api-key',
    })
    mocks.startResearchJobForChat.mockReset()
    mocks.startResearchJobForChat.mockResolvedValue({
      jobId: 'job-1',
      status: 'running',
    })

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
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
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

  it('bumps project activity when creating a new chat inside a project', async () => {
    const handler = await getNewChatHandler()
    const chatsInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(() => ({
          id: 'chat-1',
          slug: 'chat-1',
        })),
      })),
    }))
    const messagesInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(async () => ({
          id: 'message-db-id',
          publicId: 'message-public-id',
        })),
      })),
    }))
    const projectUpdateWhere = vi.fn(async () => undefined)
    const projectUpdateSet = vi.fn(() => ({
      where: projectUpdateWhere,
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => ({ id: 'project-1' })),
        },
      },
      insert: vi.fn()
        .mockReturnValueOnce({
          values: chatsInsertValues,
        })
        .mockReturnValueOnce({
          values: messagesInsertValues,
        }),
      update: vi.fn(() => ({
        set: projectUpdateSet,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        parts: [{ type: 'text', text: 'Hello' }],
        tools: [],
        reasoning: 'off',
        projectId: 'project-1',
      },
    } as any)

    expect(response).toEqual({ slug: 'chat-1' })
    expect(mocks.validateMessageFilePolicy).toHaveBeenCalledWith(
      1,
      [{ type: 'text', text: 'Hello' }],
    )
    expect(chatsInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      projectId: 'project-1',
      activityAt: expect.any(Date),
    }))
    expect(projectUpdateSet).toHaveBeenCalledWith({
      activityAt: expect.any(Date),
    })
    expect(projectUpdateWhere).toHaveBeenCalledTimes(1)
    expect(mocks.markProjectsMemoryStale).toHaveBeenCalledWith(
      ['project-1'],
      1,
      db,
    )
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('starts a research job when research is requested', async () => {
    const handler = await getNewChatHandler()
    const chatsInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(() => ({
          id: 'chat-1',
          slug: 'chat-1',
        })),
      })),
    }))
    const messagesInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(async () => ({
          id: 'message-db-id',
          publicId: 'message-public-id',
        })),
      })),
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => null),
        },
      },
      insert: vi.fn()
        .mockReturnValueOnce({
          values: chatsInsertValues,
        })
        .mockReturnValueOnce({
          values: messagesInsertValues,
        }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        parts: [{ type: 'text', text: 'Research this' }],
        tools: [],
        reasoning: 'off',
        model: 'gpt-5.4-nano',
        research: {
          level: 'quick',
          answers: [{ id: 'q1', question: 'Scope?', answer: 'Global' }],
        },
      },
    } as any)

    expect(response).toEqual({ slug: 'chat-1' })
    expect(mocks.startResearchJobForChat).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        userId: 1,
        chat: { id: 'chat-1', slug: 'chat-1', projectId: null },
        userMessage: expect.objectContaining({
          id: expect.any(String),
          parts: [{ type: 'text', text: 'Research this' }],
        }),
        model: 'gpt-5.4-nano',
        level: 'quick',
        answers: [{ id: 'q1', question: 'Scope?', answer: 'Global' }],
      }),
    )
  })

  it('rejects a research request without a model', async () => {
    const handler = await getNewChatHandler()

    await expect(handler({
      body: {
        parts: [{ type: 'text', text: 'Research this' }],
        tools: [],
        reasoning: 'off',
        research: { level: 'quick' },
      },
    } as any)).rejects.toThrow(
      'A model is required to start deep research.',
    )
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })

  it('returns a soft researchError without failing the request when starting research fails', async () => {
    mocks.startResearchJobForChat.mockRejectedValue(
      Object.assign(new Error('Could not start the research job.'), {
        why: 'The research provider rejected the request.',
        fix: 'Try a different research level.',
      }),
    )

    const handler = await getNewChatHandler()
    const chatsInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(() => ({
          id: 'chat-1',
          slug: 'chat-1',
        })),
      })),
    }))
    const messagesInsertValues = vi.fn(() => ({
      returning: vi.fn(() => ({
        get: vi.fn(async () => ({
          id: 'message-db-id',
          publicId: 'message-public-id',
        })),
      })),
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => null),
        },
      },
      insert: vi.fn()
        .mockReturnValueOnce({ values: chatsInsertValues })
        .mockReturnValueOnce({ values: messagesInsertValues }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: {
        parts: [{ type: 'text', text: 'Research this' }],
        tools: [],
        reasoning: 'off',
        model: 'gpt-5.4-nano',
        research: { level: 'quick' },
      },
    } as any)

    expect(response).toEqual({
      slug: 'chat-1',
      researchError: {
        message: 'Could not start the research job.',
        why: 'The research provider rejected the request.',
        fix: 'Try a different research level.',
      },
    })
  })

  it('propagates a resolveResearchStartContext failure without inserting a chat row', async () => {
    mocks.resolveResearchStartContext.mockRejectedValue(
      Object.assign(
        new Error('This provider does not support deep research.'),
        { statusCode: 400 },
      ),
    )

    const handler = await getNewChatHandler()
    const chatsInsert = vi.fn()
    const db = {
      query: {
        projects: {
          findFirst: vi.fn(async () => null),
        },
      },
      insert: chatsInsert,
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      body: {
        parts: [{ type: 'text', text: 'Research this' }],
        tools: [],
        reasoning: 'off',
        model: 'gpt-5.4-nano',
        research: { level: 'quick' },
      },
    } as any)).rejects.toThrow(
      'This provider does not support deep research.',
    )
    expect(chatsInsert).not.toHaveBeenCalled()
    expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
  })
})
