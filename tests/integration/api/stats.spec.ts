import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cachedStats: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/landing/stats', () => ({
  cachedStats: mocks.cachedStats,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
}))

async function getStatsHandler() {
  const module = await import('../../../server/api/v1/stats/index.get')

  return module.default
}

describe('GET /api/v1/stats', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.cachedStats.mockReset()
    mocks.loggerSet.mockClear()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('setResponseHeaders', vi.fn())
  })

  it('returns the cached stats including the researches count', async () => {
    mocks.cachedStats.mockResolvedValue({
      users: 1,
      chats: 2,
      messages: 3,
      files: 4,
      sharedChats: 5,
      researches: 6,
      updatedAt: '2026-07-08T00:00:00.000Z',
    })

    const handler = await getStatsHandler()
    const result = await handler({} as any)

    expect(result).toEqual({
      users: 1,
      chats: 2,
      messages: 3,
      files: 4,
      sharedChats: 5,
      researches: 6,
      updatedAt: '2026-07-08T00:00:00.000Z',
      source: 'cache',
    })
  })

  it('falls back to a zeroed researches count when the cache read fails', async () => {
    mocks.cachedStats.mockRejectedValue(new Error('D1 unavailable'))

    const handler = await getStatsHandler()
    const result = await handler({} as any)

    expect(result).toMatchObject({
      users: 0,
      chats: 0,
      messages: 0,
      files: 0,
      sharedChats: 0,
      researches: 0,
      source: 'fallback',
    })
  })
})
