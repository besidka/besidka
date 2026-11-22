import type { LocalDateValue } from '~/utils/local-date'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', YEAR_MS],
  ['month', MONTH_MS],
  ['week', WEEK_MS],
  ['day', DAY_MS],
  ['hour', HOUR_MS],
  ['minute', MINUTE_MS],
]

/**
 * "2 hours ago" or "last week" for a past date. Under a minute reads "just
 * now". Rendered only after mount by the callers, because the result depends
 * on the clock and would not match the server render.
 */
export function formatRelativeTime(
  value: LocalDateValue,
  now: number = Date.now(),
): string {
  const timestamp = new Date(value).getTime()

  if (Number.isNaN(timestamp)) {
    return ''
  }

  const elapsed = Math.max(now - timestamp, 0)
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  for (const [unit, unitMs] of UNITS) {
    if (elapsed >= unitMs) {
      return formatter.format(-Math.floor(elapsed / unitMs), unit)
    }
  }

  return 'just now'
}
