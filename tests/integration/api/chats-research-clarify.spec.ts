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

function researchCapableModel() {
  return {
    id: 'o4-mini-deep-research',
    name: 'o4-mini Deep Research',
    research: {
      tier: 'quick' as const,
      assistModel: 'gpt-5.4-nano',
      costEstimate: '~$1 / task',
      timeEstimate: '5–15 min',
      maxToolCalls: 30,
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
      provider: { id: 'openai', name: 'OpenAI', models: [] },
      model: researchCapableModel(),
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
    useRuntimeConfig().researchMockEnabled = false
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

  it('rejects a model that is not a dedicated deep research model', async () => {
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

  it('returns canned questions in mock mode without calling the model', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const handler = await getClarifyHandler()

    const response = await handler({
      body: { model: 'gpt-5.4', topic: 'mock: best espresso machines' },
    } as any)

    expect(response).toEqual({
      questions: [
        {
          id: 'mock-scope',
          question: 'How deep should the mock report go?',
          kind: 'choice',
          options: ['Quick overview', 'Standard depth', 'Exhaustive'],
        },
        {
          id: 'mock-focus',
          question: 'Any specific angle to emphasize? (optional)',
          kind: 'text',
          placeholder: 'e.g. cost, performance, adoption',
        },
      ],
    })
    expect(mocks.buildResearchAssistModelInstance).not.toHaveBeenCalled()
    expect(mocks.generateResearchClarifications).not.toHaveBeenCalled()
  })

  it('does not use the mock path when the topic has no mock: prefix, even with mock mode enabled', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const handler = await getClarifyHandler()

    await handler({
      body: { model: 'gpt-5.4', topic: 'The future of renewable energy' },
    } as any)

    expect(mocks.buildResearchAssistModelInstance).toHaveBeenCalledTimes(1)
    expect(mocks.generateResearchClarifications).toHaveBeenCalledTimes(1)
  })

  it('does not use the mock path when mock mode is disabled, even with a mock: prefixed topic', async () => {
    useRuntimeConfig().researchMockEnabled = false

    const handler = await getClarifyHandler()

    await handler({
      body: { model: 'gpt-5.4', topic: 'mock: best espresso machines' },
    } as any)

    expect(mocks.buildResearchAssistModelInstance).toHaveBeenCalledTimes(1)
    expect(mocks.generateResearchClarifications).toHaveBeenCalledTimes(1)
  })
})
