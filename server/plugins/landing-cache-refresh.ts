import { createRequestLogger } from 'evlog'
import { readStatsFromDb } from '~~/server/utils/landing/stats'
import { fetchGithubStars } from '~~/server/utils/landing/github-stars'
import { CACHE_TTL_DAY } from '~~/server/utils/cache-or-fetch'

const REFRESH_UTC_HOUR = 3

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    await runLandingCacheRefreshJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

interface RunLandingCacheRefreshJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
}

export async function runLandingCacheRefreshJob(
  input: RunLandingCacheRefreshJobInput,
): Promise<void> {
  const utcHour = new Date(input.controller.scheduledTime).getUTCHours()

  if (utcHour !== REFRESH_UTC_HOUR) {
    return
  }

  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/landing-cache-refresh',
    requestId: `landing-cache-refresh-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()

  logger.set({
    landingCacheRefreshJob: {
      job: 'landing-cache-refresh',
      cron: input.controller.cron,
      scheduledTime,
    },
  })

  const [statsResult, githubStarsResult] = await Promise.allSettled([
    cacheOrFetch({
      key: 'landing:stats:v1',
      ttlSeconds: CACHE_TTL_DAY,
      fetcher: readStatsFromDb,
      force: true,
    }),
    cacheOrFetch({
      key: 'landing:github-stars:v1',
      ttlSeconds: CACHE_TTL_DAY,
      fetcher: () => fetchGithubStars('besidka/besidka'),
      force: true,
    }),
  ])

  logger.set({
    stats: statsResult.status === 'fulfilled'
      ? {
        source: statsResult.value.source,
        updatedAt: statsResult.value.updatedAt,
      }
      : { error: statsResult.reason instanceof Error
        ? statsResult.reason.message
        : String(statsResult.reason) },
    githubStars: githubStarsResult.status === 'fulfilled'
      ? {
        source: githubStarsResult.value.source,
        updatedAt: githubStarsResult.value.updatedAt,
      }
      : { error: githubStarsResult.reason instanceof Error
        ? githubStarsResult.reason.message
        : String(githubStarsResult.reason) },
  })

  const status = statsResult.status === 'fulfilled'
    && githubStarsResult.status === 'fulfilled'
    ? 200
    : 500

  logger.emit({ status })
}
