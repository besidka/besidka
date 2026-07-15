import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cachedStats: vi.fn(),
  loggerSet: vi.fn(),
  setResponseHeaders: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/landing/stats', () => ({
  cachedStats: mocks.cachedStats,
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/stats/index.get')

  return module.default
}

describe('landing stats API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setResponseHeaders', mocks.setResponseHeaders)
  })

  it('returns and logs aggregate file provenance counts', async () => {
    const stats = {
      users: 111,
      chats: 1300,
      messages: 7200,
      files: 245,
      uploadedFiles: 205,
      generatedImages: 40,
      sharedChats: 5,
      updatedAt: '2026-07-15T12:00:00.000Z',
    }

    mocks.cachedStats.mockResolvedValue(stats)

    const handler = await getHandler()
    const result = await handler({} as never)

    expect(result).toEqual({ ...stats, source: 'cache' })
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      stats: {
        source: 'cache',
        updatedAt: stats.updatedAt,
        files: 245,
        uploadedFiles: 205,
        generatedImages: 40,
      },
    })
  })

  it('keeps every count defined when the aggregate query fails', async () => {
    mocks.cachedStats.mockRejectedValue(new Error('D1 unavailable'))

    const handler = await getHandler()
    const result = await handler({} as never)

    expect(result).toMatchObject({
      files: 0,
      uploadedFiles: 0,
      generatedImages: 0,
      source: 'fallback',
    })
  })

  it('excludes query-bearing stats requests from session enrichment',
    async () => {
      const getSession = vi.fn()

      vi.stubGlobal('useServerAuth', vi.fn(() => ({
        api: { getSession },
      })))

      const module = await import('../../../server/middleware/evlog-auth')

      await module.default({
        headers: new Headers({
          cookie: 'better-auth.session_token=secret',
        }),
        path: '/api/v1/stats?v=3',
      } as never)

      expect(getSession).not.toHaveBeenCalled()
    })
})
