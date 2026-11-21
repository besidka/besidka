import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import { formatMessageCost } from '#shared/utils/message-format'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  fitReportLine,
  formatReportCount,
  formatReportDate,
  formatReportDateTime,
  reportRow,
  reportRule,
} from '~~/server/utils/usage/report-text'

type DbClient = ReturnType<typeof useDb>

export const USAGE_STATS_PERIODS = ['7d', '30d', 'all'] as const
export type UsageStatsPeriod = typeof USAGE_STATS_PERIODS[number]
export const USAGE_STATS_DEFAULT_PERIOD: UsageStatsPeriod = '30d'

export const USAGE_STATS_CACHE_SECONDS: Record<UsageStatsPeriod, number> = {
  '7d': 15 * 60,
  '30d': 15 * 60,
  'all': 60 * 60,
}

export const USAGE_STATS_RUNS_WINDOW_SECONDS = 10 * 60
export const USAGE_STATS_RUNS_MAX = 20

const PERIOD_DAYS: Record<UsageStatsPeriod, number | null> = {
  '7d': 7,
  '30d': 30,
  'all': null,
}

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVITY_MARGIN_SECONDS = 24 * 60 * 60
const KV_KEY_PREFIX = 'usage-stats'
const RATE_LIMIT_KEY_PREFIX = 'usage-stats-runs'

export interface UsageStatsCounts {
  projects: number | null
  artifacts: number | null
  skills: number | null
  connectors: number | null
}

export interface UsageStatsModel {
  model: string
  replies: number
  cost: number
}

export interface UsageStats {
  period: UsageStatsPeriod
  since: string | null
  generatedAt: string
  replies: number
  messages: number
  chats: number
  tokens: {
    uncachedInput: number
    cacheRead: number
    cacheWrite: number
    output: number
    reasoning: number
    unsplit: number
  }
  cost: { amount: number, isEstimated: boolean } | null
  unpricedReplies: number
  models: UsageStatsModel[]
  activeDays: number
  periodDays: number
  mostActiveDay: { date: string, messages: number } | null
  currentStreak: number
  longestStreak: number
  counts: UsageStatsCounts
}

export interface UsageStatsGroupRow {
  day: string
  role: string
  model: string | null
  messages: number
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  total: number | null
  unsplit: number | null
  cost: number | null
  searchCost: number | null
  estimated: number | null
  unpriced: number | null
}

interface UsageStatsCountsRow {
  chats: number
  projects: number
  artifacts: number
  skills: number
  connectors: number
}

/**
 * One grouped statement over the user's chat messages in the period, by
 * UTC day, role and model. Messages created before their chat are left out:
 * those are copies a branch made (`server/utils/chats/branch.ts` copies the
 * usage of every copied message), so a branched chat is not counted twice.
 * `cost` follows the chat panel's rule: a gateway's blended `totalCost`
 * when it is set, otherwise input plus output cost. `c.activity_at` narrows
 * the chats through `idx_chats_user_activity` before their messages are
 * read: a chat with a message in the period was active in it. The bound is
 * one day earlier than the period (`ACTIVITY_MARGIN_SECONDS`), because a
 * reply can be stored a while after the send that moved `activity_at`.
 */
const GROUPED_STATEMENT = `SELECT
  strftime('%Y-%m-%d', m.created_at, 'unixepoch') AS day,
  m.role AS role,
  json_extract(m.usage, '$.model') AS model,
  COUNT(*) AS messages,
  SUM(json_extract(m.usage, '$.inputTokens')) AS input,
  SUM(json_extract(m.usage, '$.outputTokens')) AS output,
  SUM(json_extract(m.usage, '$.cachedInputTokens')) AS cacheRead,
  SUM(json_extract(m.usage, '$.cacheWriteTokens')) AS cacheWrite,
  SUM(json_extract(m.usage, '$.reasoningTokens')) AS reasoning,
  SUM(json_extract(m.usage, '$.totalTokens')) AS total,
  SUM(CASE
    WHEN json_extract(m.usage, '$.inputTokens') = 0
      AND json_extract(m.usage, '$.outputTokens') = 0
    THEN json_extract(m.usage, '$.totalTokens') ELSE 0 END) AS unsplit,
  SUM(COALESCE(
    json_extract(m.usage, '$.totalCost'),
    COALESCE(json_extract(m.usage, '$.inputCost'), 0)
      + COALESCE(json_extract(m.usage, '$.outputCost'), 0)
  )) AS cost,
  SUM(COALESCE(json_extract(m.usage, '$.searchCost'), 0)) AS searchCost,
  MAX(CASE
    WHEN json_extract(m.usage, '$.costEstimated') = 1
      OR json_extract(m.usage, '$.searchCost') IS NOT NULL
    THEN 1 ELSE 0 END) AS estimated,
  SUM(CASE
    WHEN m.usage IS NOT NULL
      AND json_extract(m.usage, '$.totalCost') IS NULL
      AND json_extract(m.usage, '$.inputCost') IS NULL
      AND json_extract(m.usage, '$.outputCost') IS NULL
    THEN 1 ELSE 0 END) AS unpriced
FROM messages m
JOIN chats c ON c.id = m.chat_id
WHERE c.user_id = ?
  AND c.activity_at >= ?
  AND m.role IN ('user', 'assistant')
  AND m.created_at >= c.created_at
  AND m.created_at >= ?
GROUP BY day, role, model`

/**
 * One row of counts. `chats` is the chats active in the period, read from
 * `idx_chats_user_activity` alone, so the messages are read only once, by
 * the grouped statement.
 */
const COUNTS_STATEMENT = `SELECT
  (SELECT COUNT(*) FROM chats
    WHERE user_id = ? AND activity_at >= ?) AS chats,
  (SELECT COUNT(*) FROM projects WHERE user_id = ?) AS projects,
  (SELECT COUNT(*) FROM artifacts
    WHERE user_id = ? AND takedown_at IS NULL) AS artifacts,
  (SELECT COUNT(*) FROM skills WHERE user_id = ?) AS skills,
  (SELECT COUNT(*) FROM connectors WHERE user_id = ?) AS connectors`

interface StatementResult<Row> {
  rows: Row[]
  rowsRead: number | null
}

interface PreparedLike {
  bind: (...values: unknown[]) => { all: () => unknown }
}

/**
 * Runs one statement on the database client under Drizzle. On D1 the
 * result carries `meta.rows_read`, which is logged; the local SQLite client
 * of the tests returns the rows only.
 */
async function runStatement<Row>(
  db: DbClient,
  statement: string,
  values: unknown[],
): Promise<StatementResult<Row>> {
  const client = (db as unknown as {
    $client: { prepare: (query: string) => PreparedLike }
  }).$client
  const result = await client.prepare(statement).bind(...values).all()

  if (Array.isArray(result)) {
    return { rows: result as Row[], rowsRead: null }
  }

  const d1Result = result as {
    results?: Row[]
    meta?: { rows_read?: number }
  }

  return {
    rows: d1Result.results ?? [],
    rowsRead: d1Result.meta?.rows_read ?? null,
  }
}

export function parseUsageStatsPeriod(
  value: string | null | undefined,
): UsageStatsPeriod | null {
  const normalized = (value ?? '').trim().toLowerCase()

  if (!normalized) {
    return USAGE_STATS_DEFAULT_PERIOD
  }

  return (USAGE_STATS_PERIODS as readonly string[]).includes(normalized)
    ? normalized as UsageStatsPeriod
    : null
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ))
}

/**
 * The first second a period covers: the start of the UTC day `days - 1`
 * days before today, so `7d` is today plus the six days before it.
 */
export function getUsageStatsSince(
  period: UsageStatsPeriod,
  now: Date,
): Date | null {
  const days = PERIOD_DAYS[period]

  if (days === null) {
    return null
  }

  return new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY_MS)
}

function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
}

/**
 * The current and the longest run of consecutive active UTC days. The
 * current run ends today, or yesterday when there is no activity yet today,
 * so a streak is not broken before the day is over.
 */
export function computeStreaks(
  activeDays: readonly string[],
  today: string,
): { current: number, longest: number } {
  const indexes = [...new Set(activeDays.map(dayIndex))]
    .sort((left, right) => left - right)
  let longest = 0
  let run = 0
  let previous: number | null = null

  for (const index of indexes) {
    run = previous !== null && index === previous + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = index
  }

  const active = new Set(indexes)
  const todayIndex = dayIndex(today)
  let cursor = active.has(todayIndex) ? todayIndex : todayIndex - 1
  let current = 0

  while (active.has(cursor)) {
    current += 1
    cursor -= 1
  }

  return { current, longest }
}

/**
 * Turns the grouped rows and the counts into the stats a report shows.
 * Pure, so the arithmetic is tested without a database.
 */
export function summarizeUsageStats(input: {
  period: UsageStatsPeriod
  now: Date
  since: Date | null
  rows: readonly UsageStatsGroupRow[]
  counts: UsageStatsCountsRow
}): UsageStats {
  const { rows } = input
  const today = formatReportDate(input.now)
  const messagesByDay = new Map<string, number>()
  const models = new Map<string, UsageStatsModel>()
  const tokens = {
    uncachedInput: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    unsplit: 0,
  }
  let replies = 0
  let messages = 0
  let costAmount = 0
  let hasCost = false
  let isEstimated = false
  let unpricedReplies = 0

  for (const row of rows) {
    const count = Number(row.messages) || 0

    messages += count
    messagesByDay.set(row.day, (messagesByDay.get(row.day) ?? 0) + count)

    if (row.role !== 'assistant' || row.model === null) {
      continue
    }

    replies += count

    const input = Number(row.input) || 0
    const cacheRead = Number(row.cacheRead) || 0
    const cacheWrite = Number(row.cacheWrite) || 0
    const cost = (Number(row.cost) || 0) + (Number(row.searchCost) || 0)

    tokens.uncachedInput += Math.max(0, input - cacheRead - cacheWrite)
    tokens.cacheRead += cacheRead
    tokens.cacheWrite += cacheWrite
    tokens.output += Number(row.output) || 0
    tokens.reasoning += Number(row.reasoning) || 0
    tokens.unsplit += Number(row.unsplit) || 0
    unpricedReplies += Number(row.unpriced) || 0
    isEstimated = isEstimated || Number(row.estimated) === 1

    if (count > (Number(row.unpriced) || 0)) {
      hasCost = true
      costAmount += cost
    }

    const model = models.get(row.model) ?? {
      model: row.model,
      replies: 0,
      cost: 0,
    }

    model.replies += count
    model.cost += cost
    models.set(row.model, model)
  }

  const activeDays = [...messagesByDay.keys()].sort()
  const busiest = [...messagesByDay.entries()].sort((left, right) => {
    return right[1] - left[1] || right[0].localeCompare(left[0])
  })[0]
  const streaks = computeStreaks(activeDays, today)
  const firstDay = input.since
    ? formatReportDate(input.since)
    : activeDays[0] ?? today

  return {
    period: input.period,
    since: input.since?.toISOString() ?? null,
    generatedAt: input.now.toISOString(),
    replies,
    messages,
    chats: Number(input.counts.chats) || 0,
    tokens,
    cost: hasCost ? { amount: costAmount, isEstimated } : null,
    unpricedReplies,
    models: [...models.values()].sort((left, right) => {
      return right.replies - left.replies
        || left.model.localeCompare(right.model)
    }),
    activeDays: activeDays.length,
    periodDays: dayIndex(today) - dayIndex(firstDay) + 1,
    mostActiveDay: busiest ? { date: busiest[0], messages: busiest[1] } : null,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    counts: {
      projects: Number(input.counts.projects) || 0,
      artifacts: Number(input.counts.artifacts) || 0,
      skills: Number(input.counts.skills) || 0,
      connectors: Number(input.counts.connectors) || 0,
    },
  }
}

function cacheKey(userId: number, period: UsageStatsPeriod): string {
  return `${KV_KEY_PREFIX}:${userId}:${period}`
}

/**
 * Deletes the user's cached stats of every period (`usage-stats:<userId>:*`),
 * for the account purge: the cache holds the user's model names, token and
 * cost totals and activity, and would otherwise sit until its TTL ends. One
 * delete after the other, since KV has no batch delete. A failure is logged
 * and never thrown, as the entries expire by themselves within the hour.
 */
export async function invalidateUsageStatsCache(
  kv: KVNamespace,
  userId: number,
  logger: LoggerLike,
): Promise<void> {
  for (const period of USAGE_STATS_PERIODS) {
    try {
      await kv.delete(cacheKey(userId, period))
    } catch (exception) {
      logger.set({
        attributes: {
          usageStats: { cacheDeleteError: exceptionMessage(exception) },
        },
      })
    }
  }
}

async function readCached(
  kv: KVNamespace,
  key: string,
  logger: LoggerLike,
): Promise<UsageStats | null> {
  try {
    const raw = await kv.get(key)

    return raw ? JSON.parse(raw) as UsageStats : null
  } catch (exception) {
    logger.set({
      attributes: {
        usageStats: { cacheReadError: exceptionMessage(exception) },
      },
    })

    return null
  }
}

async function assertRunAllowed(kv: KVNamespace, userId: number) {
  const storage = createAuthRateLimitStorage(kv, RATE_LIMIT_KEY_PREFIX)
  let isAllowed: boolean

  try {
    const result = await storage.consume(String(userId), {
      window: USAGE_STATS_RUNS_WINDOW_SECONDS,
      max: USAGE_STATS_RUNS_MAX,
    })

    isAllowed = result.allowed
  } catch {
    isAllowed = false
  }

  if (!isAllowed) {
    throw createError({
      message: 'Usage stats were worked out too often. Try again in a few '
        + 'minutes.',
      status: 429,
      why: 'Usage stats are limited per user to keep database reads low',
      fix: 'Wait a few minutes and ask again',
    })
  }
}

/**
 * The user's usage stats for a period, from the KV cache when a fresh copy
 * exists (15 minutes, one hour for `all`), otherwise from two statements
 * (one grouped read of the messages, one row of counts) under a per-user
 * limit of 20 runs in 10 minutes. Duration, grouped rows and D1 rows read
 * are logged under `attributes.usageStats`.
 */
export async function getUsageStats(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  period: UsageStatsPeriod
  logger: LoggerLike
  now?: Date
}): Promise<{ stats: UsageStats, isCached: boolean }> {
  const { db, kv, userId, period, logger } = input
  const key = cacheKey(userId, period)
  const cached = await readCached(kv, key, logger)

  if (cached) {
    logger.set({ attributes: { usageStats: { period, cached: true } } })

    return { stats: cached, isCached: true }
  }

  await assertRunAllowed(kv, userId)

  const startedAt = Date.now()
  const now = input.now ?? new Date()
  const since = getUsageStatsSince(period, now)
  const sinceSeconds = since ? Math.floor(since.getTime() / 1000) : 0
  const activeSinceSeconds = since
    ? sinceSeconds - ACTIVITY_MARGIN_SECONDS
    : 0
  const grouped = await runStatement<UsageStatsGroupRow>(
    db,
    GROUPED_STATEMENT,
    [userId, activeSinceSeconds, sinceSeconds],
  )
  const counts = await runStatement<UsageStatsCountsRow>(
    db,
    COUNTS_STATEMENT,
    [userId, sinceSeconds, userId, userId, userId, userId],
  )
  const stats = summarizeUsageStats({
    period,
    now,
    since,
    rows: grouped.rows,
    counts: counts.rows[0] ?? {
      chats: 0,
      projects: 0,
      artifacts: 0,
      skills: 0,
      connectors: 0,
    },
  })

  logger.set({
    attributes: {
      usageStats: {
        period,
        cached: false,
        durationMs: Date.now() - startedAt,
        groupedRows: grouped.rows.length,
        rowsRead: (grouped.rowsRead ?? 0) + (counts.rowsRead ?? 0),
      },
    },
  })

  try {
    await kv.put(key, JSON.stringify(stats), {
      expirationTtl: USAGE_STATS_CACHE_SECONDS[period],
    })
  } catch (exception) {
    logger.set({
      attributes: {
        usageStats: { cacheWriteError: exceptionMessage(exception) },
      },
    })
  }

  return { stats, isCached: false }
}

const PERIOD_LABELS: Record<UsageStatsPeriod, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  'all': 'all time',
}

function formatDays(count: number): string {
  return `${formatReportCount(count)} ${count === 1 ? 'day' : 'days'}`
}

/**
 * The `/stats` report: one plain-text block of rows at most 40 characters
 * wide. Counts the user's chat replies only; spend in the background (such
 * as memory updates) is not stored with messages and is not in it.
 */
export function formatUsageStatsReport(
  stats: UsageStats,
  options: { note?: string | null } = {},
): string {
  const lines: string[] = [
    `Usage stats, ${PERIOD_LABELS[stats.period]}`,
    reportRule(),
  ]
  const favorite = stats.models[0]

  if (options.note) {
    lines.push(options.note, '')
  }

  if (favorite) {
    lines.push('Favorite model', fitReportLine(`  ${favorite.model}`))
    lines.push(reportRow('Replies', formatReportCount(favorite.replies), 2))
  }

  lines.push(
    '',
    reportRow('Chats', formatReportCount(stats.chats)),
    reportRow('Messages', formatReportCount(stats.messages)),
    reportRow('Model replies', formatReportCount(stats.replies)),
    '',
    'Tokens',
    reportRow('Input', formatReportCount(stats.tokens.uncachedInput), 2),
    reportRow('Output', formatReportCount(stats.tokens.output), 2),
  )

  if (stats.tokens.reasoning > 0) {
    lines.push(reportRow(
      'incl. reasoning',
      formatReportCount(stats.tokens.reasoning),
      4,
    ))
  }

  lines.push(
    reportRow('Cache read', formatReportCount(stats.tokens.cacheRead), 2),
    reportRow('Cache write', formatReportCount(stats.tokens.cacheWrite), 2),
  )

  if (stats.tokens.unsplit > 0) {
    lines.push(reportRow(
      'No split',
      formatReportCount(stats.tokens.unsplit),
      2,
    ))
  }

  lines.push('', reportRow(
    'Cost (estimated)',
    stats.cost
      ? formatMessageCost(stats.cost.amount, stats.cost.isEstimated)
      : 'no price',
  ))

  if (stats.unpricedReplies > 0) {
    lines.push(reportRow(
      'Replies with no price',
      formatReportCount(stats.unpricedReplies),
      2,
    ))
  }

  lines.push(
    '',
    reportRow(
      'Active days',
      `${formatReportCount(stats.activeDays)} of ${
        formatReportCount(stats.periodDays)
      }`,
    ),
  )

  if (stats.mostActiveDay) {
    lines.push(reportRow(
      'Most active day',
      stats.mostActiveDay.date,
    ), reportRow(
      'Messages that day',
      formatReportCount(stats.mostActiveDay.messages),
      2,
    ))
  }

  lines.push(
    reportRow('Current streak', formatDays(stats.currentStreak)),
    reportRow('Longest streak', formatDays(stats.longestStreak)),
  )

  const countRows: Array<[string, number | null]> = [
    ['Projects', stats.counts.projects],
    ['Artifacts', stats.counts.artifacts],
    ['Skills', stats.counts.skills],
    ['Connectors', stats.counts.connectors],
  ]
  const shownCounts = countRows.filter(([, count]) => count !== null)

  if (shownCounts.length > 0) {
    lines.push('')

    for (const [label, count] of shownCounts) {
      lines.push(reportRow(label, formatReportCount(count ?? 0)))
    }
  }

  lines.push(
    '',
    'Chat replies only, days in UTC.',
    'Branch copies are not counted twice.',
    `As of ${formatReportDateTime(new Date(stats.generatedAt))} UTC.`,
    'The provider\'s bill is authoritative.',
  )

  return lines.join('\n')
}
