import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateChatTitle: vi.fn(async () => 'Generated title'),
}))

async function getTitleHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/title.patch')

  return module.default
}

async function getBuildMockChatTitle() {
  const module = await import('../../../server/api/v1/chats/[slug]/title.patch')

  return module.buildMockChatTitle
}

describe('chat title API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.generateChatTitle.mockResolvedValue('Generated title')

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
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useChatProvider', () => ({
      provider: { id: 'openai' },
      model: { id: 'gpt-4.1-mini' },
    }))
    vi.stubGlobal('useOpenAI', vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    })))
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    })))
    useRuntimeConfig().researchMockEnabled = false
  })

  it('saves a generated title without bumping chat activity', async () => {
    const handler = await getTitleHandler()
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({
          get: vi.fn(() => ({
            title: 'Generated title',
          })),
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: 'project-1',
            messages: [
              {
                parts: [{ text: 'Create a roadmap for Q2' }],
              },
            ],
          })),
        },
      },
      update: vi.fn(() => ({
        set,
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: { model: 'openai:gpt-4.1-mini' },
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response).toBe('Generated title')
    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      'Create a roadmap for Q2',
    )
    expect(set).toHaveBeenCalledWith({
      title: 'Generated title',
    })
  })

  it('substitutes the research assist model so titling never triggers a real research run', async () => {
    vi.stubGlobal('useChatProvider', () => ({
      provider: { id: 'openai' },
      model: {
        id: 'o4-mini-deep-research',
        research: {
          tier: 'quick',
          assistModel: 'gpt-5.4-nano',
          costEstimate: '~$1 / task',
          timeEstimate: '5-15 min',
          maxToolCalls: 30,
        },
      },
    }))

    const useOpenAiMock = vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    }))

    vi.stubGlobal('useOpenAI', useOpenAiMock)

    const handler = await getTitleHandler()
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({
          get: vi.fn(() => ({
            title: 'Generated title',
          })),
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: 'project-1',
            messages: [
              { parts: [{ text: 'Research the best espresso machines' }] },
            ],
          })),
        },
      },
      update: vi.fn(() => ({ set })),
    }

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: { model: 'openai:o4-mini-deep-research' },
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(useOpenAiMock).toHaveBeenCalledWith('1', 'gpt-5.4-nano', [], 'off')
  })

  it('substitutes the research assist model for the google provider too', async () => {
    vi.stubGlobal('useChatProvider', () => ({
      provider: { id: 'google' },
      model: {
        id: 'deep-research-preview-04-2026',
        research: {
          tier: 'thorough',
          assistModel: 'gemini-flash-lite',
          costEstimate: '~$3 / task',
          timeEstimate: '15-30 min',
        },
      },
    }))

    const useGoogleMock = vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    }))

    vi.stubGlobal('useGoogle', useGoogleMock)

    const handler = await getTitleHandler()
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({
          get: vi.fn(() => ({
            title: 'Generated title',
          })),
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: 'project-1',
            messages: [
              { parts: [{ text: 'Research the best espresso machines' }] },
            ],
          })),
        },
      },
      update: vi.fn(() => ({ set })),
    }

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: { model: 'google:deep-research-preview-04-2026' },
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(useGoogleMock).toHaveBeenCalledWith(
      '1',
      'gemini-flash-lite',
      [],
      'off',
    )
  })

  it('titles a mock research chat from the topic without calling a model', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const useOpenAiMock = vi.fn(async () => ({
      generateChatTitle: mocks.generateChatTitle,
    }))

    vi.stubGlobal('useOpenAI', useOpenAiMock)

    const handler = await getTitleHandler()
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({
          get: vi.fn(() => ({
            title: 'Best espresso machines',
          })),
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: 'project-1',
            messages: [
              { parts: [{ text: 'mock: best espresso machines' }] },
            ],
          })),
        },
      },
      update: vi.fn(() => ({ set })),
    }

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      body: { model: 'openai:o4-mini-deep-research' },
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(response).toBe('Best espresso machines')
    expect(set).toHaveBeenCalledWith({ title: 'best espresso machines' })
    expect(useOpenAiMock).not.toHaveBeenCalled()
    expect(mocks.generateChatTitle).not.toHaveBeenCalled()
  })

  it('does not use the mock title path when the topic has no mock: prefix', async () => {
    useRuntimeConfig().researchMockEnabled = true

    const handler = await getTitleHandler()
    const set = vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => ({
          get: vi.fn(() => ({
            title: 'Generated title',
          })),
        })),
      })),
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            projectId: 'project-1',
            messages: [
              { parts: [{ text: 'Create a roadmap for Q2' }] },
            ],
          })),
        },
      },
      update: vi.fn(() => ({ set })),
    }

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: { model: 'openai:gpt-4.1-mini' },
      params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    } as any)

    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      'Create a roadmap for Q2',
    )
  })
})

describe('buildMockChatTitle', () => {
  it('strips the mock: prefix and collapses whitespace', async () => {
    const buildMockChatTitle = await getBuildMockChatTitle()

    expect(buildMockChatTitle('mock:   best   espresso machines')).toBe(
      'best espresso machines',
    )
  })

  it('is case-insensitive on the prefix', async () => {
    const buildMockChatTitle = await getBuildMockChatTitle()

    expect(buildMockChatTitle('MOCK: Best Espresso Machines')).toBe(
      'Best Espresso Machines',
    )
  })

  it('truncates topics longer than 60 characters with an ellipsis', async () => {
    const buildMockChatTitle = await getBuildMockChatTitle()
    const longTopic = `mock: ${'x'.repeat(80)}`

    const title = buildMockChatTitle(longTopic)

    expect(title.length).toBe(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title.startsWith('x'.repeat(60))).toBe(true)
  })

  it('returns a fallback title when the topic is only the prefix', async () => {
    const buildMockChatTitle = await getBuildMockChatTitle()

    expect(buildMockChatTitle('mock:')).toBe('Mock research')
    expect(buildMockChatTitle('mock:   ')).toBe('Mock research')
  })
})
