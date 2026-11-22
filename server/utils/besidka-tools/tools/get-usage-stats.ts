import { z } from 'zod'
import {
  USAGE_STATS_DEFAULT_PERIOD,
  USAGE_STATS_PERIODS,
  formatUsageStatsReport,
  getUsageStats,
} from '~~/server/utils/usage/usage-stats'
import type { UsageStats } from '~~/server/utils/usage/usage-stats'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import type { BesidkaToolContext } from '~~/server/utils/besidka-tools/types'

const inputSchema = {
  period: z
    .enum(USAGE_STATS_PERIODS)
    .optional()
    .describe('7d, 30d or all. Defaults to 30d'),
}

type GetUsageStatsInput = z.infer<z.ZodObject<typeof inputSchema>>

const COUNT_SCOPES = {
  projects: 'projects:read',
  artifacts: 'artifacts:read',
  skills: 'skills:read',
  connectors: 'connectors:read',
} as const

/**
 * Inside Besidka (a chat or a built-in command) the user sees every count.
 * A connected app sees a count only when its token also holds the read
 * scope of that kind of item, so `chats:read` alone reveals no count of
 * projects, artifacts, skills or connectors.
 */
function maskCounts(
  stats: UsageStats,
  context: BesidkaToolContext,
): UsageStats {
  if (context.currentChatSlug !== undefined) {
    return stats
  }

  const counts = { ...stats.counts }

  for (const [kind, scope] of Object.entries(COUNT_SCOPES)) {
    if (!context.scopes.includes(scope)) {
      counts[kind as keyof typeof COUNT_SCOPES] = null
    }
  }

  return { ...stats, counts }
}

export const getUsageStatsBesidkaTool = defineBesidkaTool({
  name: 'get_usage_stats',
  title: 'Get usage stats',
  description: 'Your own Besidka usage for the last 7 or 30 days or all '
    + 'time: the favorite model by replies, tokens by kind, the estimated '
    + 'cost on your keys, chats, messages, active days, the most active day '
    + 'and the current and longest streak in UTC days. Counts chat replies '
    + 'only; copies a branch made are counted once. Counts of projects, '
    + 'artifacts, skills and connectors need the projects:read, '
    + 'artifacts:read, skills:read and connectors:read scopes. Returns the '
    + 'structured data and one plain-text report to show, refreshed at most '
    + 'every 15 minutes (an hour for all time). Requires signing in '
    + '(chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'Your usage stats for 7 days, 30 days or all time: '
    + 'favorite model, tokens, estimated cost, active days and streaks, plus '
    + 'a ready report. Show the report text to the user verbatim in one code '
    + 'block.',
  handler: async (input: GetUsageStatsInput, context) => {
    const period = input.period ?? USAGE_STATS_DEFAULT_PERIOD
    const result = await getUsageStats({
      db: context.db,
      kv: useKV(),
      userId: context.userId,
      period,
      logger: context.logger,
    })
    const stats = maskCounts(result.stats, context)

    context.log({ period, cached: result.isCached })

    return { report: formatUsageStatsReport(stats), ...stats }
  },
})
