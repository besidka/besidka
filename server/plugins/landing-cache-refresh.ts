import { createRequestLogger } from 'evlog'
import { cachedStats } from '~~/server/utils/landing/stats'
import { cachedGithubStars } from '~~/server/utils/landing/github-stars'

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

  // Invalidate cached entries so the next call fetches fresh data rather than
  // serving the stale SWR value from the previous warm cycle.
  // Key format: {group}:{name}:{getKey()}.json — accessed via the 'cache' mount
  const cache = useStorage('cache')

  await Promise.allSettled([
    cache.removeItem('landing:landing-stats:global.json'),
    cache.removeItem(
      'landing:landing-github-stars:besidka/besidka.json',
    ),
  ])

  const [statsResult, githubStarsResult] = await Promise.allSettled([
    cachedStats(undefined),
    cachedGithubStars(undefined, 'besidka/besidka'),
  ])

  logger.set({
    stats: statsResult.status === 'fulfilled'
      ? { updatedAt: statsResult.value.updatedAt }
      : {
        error: statsResult.reason instanceof Error
          ? statsResult.reason.message
          : String(statsResult.reason),
      },
    githubStars: githubStarsResult.status === 'fulfilled'
      ? { updatedAt: githubStarsResult.value.updatedAt }
      : {
        error: githubStarsResult.reason instanceof Error
          ? githubStarsResult.reason.message
          : String(githubStarsResult.reason),
      },
  })

  const status = statsResult.status === 'fulfilled'
    && githubStarsResult.status === 'fulfilled'
    ? 200
    : 500

  logger.emit({ status })
}
