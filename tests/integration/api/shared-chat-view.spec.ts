import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageUsage } from '#shared/types/message-usage.d'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/shared/[slug]/index.get'
  )

  return module.default
}

interface ShareFixture {
  id: string
  slug: string
  chatId: string
  revoked: boolean
  expiresAt: Date | null
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  showAuthorAvatar: boolean
  allowBranch: boolean
}

function createShareFixture(
  overrides: Partial<ShareFixture> = {},
): ShareFixture {
  return {
    id: 'share-1',
    slug: 'share-slug',
    chatId: 'chat-1',
    revoked: false,
    expiresAt: null,
    indexable: true,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    ...overrides,
  }
}

function matchesCondition(rowValue: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') {
    return rowValue === condition
  }

  const operators = condition as Record<string, unknown>

  if ('isNull' in operators) {
    return (rowValue === null) === operators.isNull
  }

  if ('gt' in operators) {
    return rowValue !== null
      && (rowValue as Date).getTime() > (operators.gt as Date).getTime()
  }

  return false
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      const subConditions = condition as Record<string, unknown>[]

      return subConditions.some((subCondition) => {
        return matchesWhere(row, subCondition)
      })
    }

    return matchesCondition(row[key], condition)
  })
}

interface MessageFixture {
  id: string
  publicId: string | null
  role: string
  parts: unknown[]
  reasoning: string | null
  createdAt: Date
  usage: MessageUsage | null
}

function createMessageFixture(
  overrides: Partial<MessageFixture> = {},
): MessageFixture {
  return {
    id: 'message-1',
    publicId: null,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Hello' }],
    reasoning: 'off',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    usage: null,
    ...overrides,
  }
}

function createDb(options: {
  shares: ShareFixture[]
  chat?: {
    title: string
    user: { name: string, image: string | null }
    messages: MessageFixture[]
  } | null
}) {
  const chatSharesFindFirst = vi.fn(async (
    { where }: { where: Record<string, unknown> },
  ) => {
    return options.shares.find((share) => {
      return matchesWhere(share as unknown as Record<string, unknown>, where)
    })
  })

  const chatsFindFirst = vi.fn(async () => options.chat ?? undefined)

  const db = {
    query: {
      chatShares: {
        findFirst: chatSharesFindFirst,
      },
      chats: {
        findFirst: chatsFindFirst,
      },
    },
  }

  return { db, chatSharesFindFirst, chatsFindFirst }
}

describe('public shared chat view API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getValidatedRouterParams', async (
      event: { params: unknown },
      parser: (params: unknown) => unknown,
    ) => {
      return parser(event.params)
    })
  })

  it('returns 404 for an unknown slug', async () => {
    const handler = await getHandler()
    const { db } = createDb({ shares: [], chat: null })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: 'unknown-slug' },
    } as never)).rejects.toThrow('Shared chat not found')
  })

  it('returns 404 for a revoked share', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({ slug: 'revoked-slug', revoked: true })],
      chat: null,
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: 'revoked-slug' },
    } as never)).rejects.toThrow('Shared chat not found')
  })

  it('returns 404 for an expired share', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({
        slug: 'expired-slug',
        expiresAt: new Date(Date.now() - 60_000),
      })],
      chat: null,
    })

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      params: { slug: 'expired-slug' },
    } as never)).rejects.toThrow('Shared chat not found')
  })

  it('serves a share whose expiry is still in the future', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({
        slug: 'future-slug',
        expiresAt: new Date(Date.now() + 60_000),
      })],
      chat: {
        title: 'Chat title',
        user: { name: 'Owner', image: null },
        messages: [createMessageFixture()],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'future-slug' },
    } as never)

    expect(response.title).toBe('Chat title')
  })

  it('strips file parts when showFiles is false', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({ slug: 'files-off', showFiles: false })],
      chat: {
        title: 'Chat title',
        user: { name: 'Owner', image: null },
        messages: [createMessageFixture({
          parts: [
            { type: 'text', text: 'Hello' },
            { type: 'file', url: '/files/a.png', mediaType: 'image/png' },
          ],
        })],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'files-off' },
    } as never)

    expect(response.messages[0]?.parts).toEqual([
      { type: 'text', text: 'Hello' },
    ])
  })

  it('keeps reasoning parts but strips createdAt and usage when showMetadata is false', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({
        slug: 'metadata-off',
        showMetadata: false,
      })],
      chat: {
        title: 'Chat title',
        user: { name: 'Owner', image: null },
        messages: [createMessageFixture({
          parts: [
            { type: 'text', text: 'Hello' },
            { type: 'reasoning', text: 'internal thought' },
          ],
          usage: {
            model: 'gpt-5.4',
            provider: 'openai',
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
        })],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'metadata-off' },
    } as never)

    expect(response.messages[0]?.parts).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'reasoning', text: 'internal thought' },
    ])
    expect(response.messages[0]).not.toHaveProperty('createdAt')
    expect(response.messages[0]).not.toHaveProperty('usage')
  })

  it('includes usage on messages when showMetadata is true', async () => {
    const handler = await getHandler()
    const usage: MessageUsage = {
      model: 'gpt-5.4',
      provider: 'openai',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    }
    const { db } = createDb({
      shares: [createShareFixture({ slug: 'metadata-on' })],
      chat: {
        title: 'Chat title',
        user: { name: 'Owner', image: null },
        messages: [createMessageFixture({ usage })],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'metadata-on' },
    } as never)

    expect(response.messages[0]).toHaveProperty('usage', usage)
  })

  it('always strips tool parts even with every option enabled', async () => {
    const handler = await getHandler()
    const { db } = createDb({
      shares: [createShareFixture({ slug: 'tools-present' })],
      chat: {
        title: 'Chat title',
        user: { name: 'Owner', image: null },
        messages: [createMessageFixture({
          parts: [
            { type: 'text', text: 'Hello' },
            {
              type: 'tool-search',
              toolCallId: 'call-1',
              state: 'output-available',
              input: {},
              output: {},
            },
          ],
        })],
      },
    })

    vi.stubGlobal('useDb', () => db)

    const response = await handler({
      params: { slug: 'tools-present' },
    } as never)

    expect(response.messages[0]?.parts).toEqual([
      { type: 'text', text: 'Hello' },
    ])
    expect(response.messages[0]).toHaveProperty('createdAt')
  })
})
