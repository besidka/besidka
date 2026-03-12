import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshFolderActivityAt: vi.fn(async () => undefined),
  generateChatTitle: vi.fn(async () => 'Generated title'),
}))

vi.mock('~~/server/utils/folders/activity', () => ({
  refreshFolderActivityAt: mocks.refreshFolderActivityAt,
}))

async function getTitleHandler() {
  const module = await import('../../../server/api/v1/chats/[slug]/title.patch')

  return module.default
}

describe('chat title API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.refreshFolderActivityAt.mockResolvedValue(undefined)
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
  })

  it('refreshes folder activity after generating a title for a folder chat', async () => {
    const handler = await getTitleHandler()
    const updateGet = vi.fn(() => ({
      title: 'Generated title',
    }))
    const db = {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            title: null,
            folderId: 'folder-1',
            messages: [
              {
                parts: [{ text: 'Create a roadmap for Q2' }],
              },
            ],
          })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              get: updateGet,
            })),
          })),
        })),
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
    expect(mocks.refreshFolderActivityAt).toHaveBeenCalledWith(
      ['folder-1'],
      1,
      db,
    )
  })
})
