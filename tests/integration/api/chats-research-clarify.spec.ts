import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    generateObject: mocks.generateObject,
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

async function getClarifyHandler() {
  const module = await import(
    '../../../server/api/v1/chats/research/clarify.post'
  )

  return module.default
}

function stubProviderForModel(modelId: string, tools: string[]) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'openai' },
    model: { id: modelId, tools },
  })))
}

describe('research clarify API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn(() => {
      throw new Error('Unauthorized')
    }))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      instance: { modelId: 'openai-instance' },
    })))
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: { modelId: 'google-instance' },
    })))
  })

  it('returns clarifying questions for a model that supports deep research', async () => {
    stubProviderForModel('gpt-5', ['web_search', 'deep_research'])
    mocks.generateObject.mockResolvedValue({
      object: {
        questions: [
          {
            id: 'audience',
            question: 'Who is this for?',
            kind: 'choice',
            options: ['Founders', 'Engineers'],
          },
        ],
        note: 'Quick scoping questions.',
      },
    })

    const handler = await getClarifyHandler()
    const response = await handler({
      body: {
        model: 'openai:gpt-5',
        topic: 'the future of remote work',
      },
    } as any)

    expect(response).toEqual({
      questions: [
        {
          id: 'audience',
          question: 'Who is this for?',
          kind: 'choice',
          options: ['Founders', 'Engineers'],
        },
      ],
      note: 'Quick scoping questions.',
    })
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: 'openai-instance' },
        schemaName: 'ResearchClarifications',
      }),
    )
    expect(mocks.generateObject.mock.calls[0][0].prompt).toContain(
      'the future of remote work',
    )
  })

  it('returns unauthorized before touching the model when there is no session', async () => {
    stubProviderForModel('gpt-5', ['deep_research'])
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getClarifyHandler()

    await expect(handler({
      body: {
        model: 'openai:gpt-5',
        topic: 'the future of remote work',
      },
    } as any)).rejects.toThrow('Unauthorized')

    expect(mocks.generateObject).not.toHaveBeenCalled()
    expect((globalThis as any).useChatProvider).not.toHaveBeenCalled()
    expect((globalThis as any).useOpenAI).not.toHaveBeenCalled()
    expect((globalThis as any).useGoogle).not.toHaveBeenCalled()
  })

  it('returns 400 when the model does not support deep research', async () => {
    stubProviderForModel('gpt-5-nano', [])

    const handler = await getClarifyHandler()

    await expect(handler({
      body: {
        model: 'openai:gpt-5-nano',
        topic: 'the future of remote work',
      },
    } as any)).rejects.toMatchObject({
      status: 400,
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    stubProviderForModel('gpt-5', ['deep_research'])

    const handler = await getClarifyHandler()

    await expect(handler({
      body: {
        model: 'openai:gpt-5',
        topic: '',
      },
    } as any)).rejects.toMatchObject({
      status: 400,
    })
    expect(mocks.generateObject).not.toHaveBeenCalled()
  })

  it('normalizes a provider failure into a structured chat error', async () => {
    stubProviderForModel('gpt-5', ['deep_research'])
    mocks.generateObject.mockRejectedValue(new Error('The model timed out'))

    const handler = await getClarifyHandler()

    await expect(handler({
      body: {
        model: 'openai:gpt-5',
        topic: 'the future of remote work',
      },
    } as any)).rejects.toMatchObject({
      status: 500,
      message: 'Could not prepare research questions.',
      why: 'The model timed out',
    })
  })

  it('preserves recognized provider error classification', async () => {
    stubProviderForModel('gpt-5', ['deep_research'])

    const rateLimitError = new Error('Rate limit exceeded')

    Object.assign(rateLimitError, { statusCode: 429 })
    mocks.generateObject.mockRejectedValue(rateLimitError)

    const handler = await getClarifyHandler()

    await expect(handler({
      body: {
        model: 'openai:gpt-5',
        topic: 'the future of remote work',
      },
    } as any)).rejects.toMatchObject({
      status: 429,
      message: 'The provider is rate limiting requests right now.',
    })
  })
})
