import { z } from 'zod'

const MILLISECONDS_PER_DAY = 86_400_000

const FRESHNESS_WINDOW_DAYS = {
  day: 1,
  week: 7,
  month: 31,
  year: 365,
} as const

const BRAVE_FRESHNESS_CODES = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
} as const

export type SearchFreshness = keyof typeof FRESHNESS_WINDOW_DAYS

export const searchFreshnessSchema = z
  .enum(['day', 'week', 'month', 'year'])
  .optional()
  .describe(
    'Restrict results to the last day, week, month or year. Set it for '
    + 'news and recent-events queries; omit it for evergreen topics.',
  )

export function toBraveFreshnessCode(freshness: SearchFreshness): string {
  return BRAVE_FRESHNESS_CODES[freshness]
}

export function toExaStartPublishedDate(
  freshness: SearchFreshness,
  now: Date = new Date(),
): string {
  const windowMilliseconds = FRESHNESS_WINDOW_DAYS[freshness]
    * MILLISECONDS_PER_DAY

  return new Date(now.getTime() - windowMilliseconds).toISOString()
}
