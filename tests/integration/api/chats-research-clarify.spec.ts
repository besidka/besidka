import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useChatProvider: vi.fn(),
  buildResearchAssistModelInstance: vi.fn(async () => ({})),
  generateResearchClarifications: vi.fn(async () => ({
    questions: [
      { id: 'q1', question: 'Which region?', kind: 'text' },
      { id: 'q2', question: 'How deep?', kind: 'choice', options: ['Quick', 'Deep'] },
    ],
  })),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/chats/provider', () => ({
  useChatProvider: mocks.useChatProvider,
}))

vi.mock('~~/server/utils/research/assist-model', () => ({
  buildResearchAssistModelInstance: mocks.buildResearchAssistModelInstance,
}))

vi.mock('~~/server/utils/research/clarify', () => ({
  generateResearchClarifications: mocks.generateResearchClarifications,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
  createError: (input: {
    message?: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

function researchCapableProvider() {
  return {
    id: 'openai',
    name: 'OpenAI',
    models: [],
    research: {
      assistModel: 'gpt-5.4-nano',
      levels: {
        quick: {
          modelId: 'o4-mini-deep-research',
          label: 'Quick',
          costEstimate: '~$1',
          timeEstimate: '5-15 min',
        },
        thorough: {
          modelId: 'o3-deep-research',
          label: 'Thorough',
          costEstimate: '~$10',
          timeEstimate: '10-30 min',
        },
      },
    },
  }
}

async function getClarifyHandler() {
  const module = await import(
    '../../../server/api/v1/chats/research/clarify.post'
  )

  return module.default
}

describe('research clarify API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.buildResearchAssistModelInstance.mockResolvedValue({})
    mocks.generateResearchClarifications.mockResolvedValue({
      questions: [
        { id: 'q1', question: 'Which region?', kind: 'text' },
      ],
    })
    mocks.useChatProvider.mockReturnValue({
      provider: researchCapableProvider(),
      model: { id: 'gpt-5.4' },
    })

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

  it('returns clarification questions for a research-capable model', async () => {
    const handler = await getClarifyHandler()

    const response = await handler({
      body: { model: 'gpt-5.4', topic: 'The future of renewable energy' },
    } as any)

    expect(response).toEqual({
      questions: [
        { id: 'q1', question: 'Which region?', kind: 'text' },
      ],
    })
    expect(mocks.buildResearchAssistModelInstance).toHaveBeenCalledWith(
      1,
      'openai',
      'gpt-5.4-nano',
    )
    expect(mocks.generateResearchClarifications).toHaveBeenCalledWith({
      instance: {},
      topic: 'The future of renewable energy',
    })
  })

  it('rejects a model whose provider has no research capability', async () => {
    mocks.useChatProvider.mockReturnValue({
      provider: { id: 'google', name: 'Google', models: [] },
      model: { id: 'gemini-2.5-flash' },
    })

    const handler = await getClarifyHandler()

    await expect(handler({
      body: { model: 'gemini-2.5-flash', topic: 'Topic' },
    } as any)).rejects.toThrow(
      'This model does not support deep research.',
    )
    expect(mocks.generateResearchClarifications).not.toHaveBeenCalled()
  })

  it('rejects a topic that is too long', async () => {
    const handler = await getClarifyHandler()

    await expect(handler({
      body: { model: 'gpt-5.4', topic: 'x'.repeat(2001) },
    } as any)).rejects.toThrow('Invalid request body')
  })

  it('maps a clarification failure to a structured error', async () => {
    mocks.generateResearchClarifications.mockRejectedValue(
      new Error('model refused'),
    )

    const handler = await getClarifyHandler()

    await expect(handler({
      body: { model: 'gpt-5.4', topic: 'Topic' },
    } as any)).rejects.toThrow('Could not prepare research questions.')
  })
})
