import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cachedStats: vi.fn(),
  cachedGithubStars: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock('evlog', () => ({
  createRequestLogger: vi.fn(),
}))

vi.mock('~~/server/utils/landing/stats', () => ({
  cachedStats: mocks.cachedStats,
  LANDING_STATS_CACHE_NAME: 'landing-stats-image-generation-v1',
}))

vi.mock('~~/server/utils/landing/github-stars', () => ({
  cachedGithubStars: mocks.cachedGithubStars,
}))

vi.mock('~~/server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: vi.fn(),
}))

describe('landing cache refresh job', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useStorage', () => ({ removeItem: mocks.removeItem }))
  })

  it('warms isolated stats and ships safe aggregate counts to Axiom',
    async () => {
      const wideEvent = { message: 'landing cache refreshed' }
      const logger = {
        set: vi.fn(),
        emit: vi.fn(() => wideEvent),
      }
      const createLogger = vi.fn(() => logger)
      const shipWideEvent = vi.fn(async () => undefined)

      mocks.cachedStats.mockResolvedValue({
        users: 111,
        chats: 1300,
        messages: 7200,
        files: 245,
        uploadedFiles: 205,
        generatedImages: 40,
        sharedChats: 5,
        updatedAt: '2026-07-15T03:00:00.000Z',
      })
      mocks.cachedGithubStars.mockResolvedValue({
        stars: 25,
        updatedAt: '2026-07-15T03:00:00.000Z',
      })

      const { runLandingCacheRefreshJob } = await import(
        '../../../server/plugins/landing-cache-refresh'
      )

      await runLandingCacheRefreshJob({
        controller: {
          cron: '0 * * * *',
          scheduledTime: Date.parse('2026-07-15T03:00:00.000Z'),
        },
        createLogger: createLogger as never,
        shipWideEvent: shipWideEvent as never,
      })

      expect(mocks.removeItem).toHaveBeenCalledWith(
        'landing:landing-stats-image-generation-v1:global.json',
      )
      expect(logger.set).toHaveBeenCalledWith({
        stats: {
          updatedAt: '2026-07-15T03:00:00.000Z',
          files: 245,
          uploadedFiles: 205,
          generatedImages: 40,
        },
        githubStars: {
          updatedAt: '2026-07-15T03:00:00.000Z',
        },
      })
      expect(logger.emit).toHaveBeenCalledWith({ status: 200 })
      expect(shipWideEvent).toHaveBeenCalledWith(wideEvent)
    })
})
