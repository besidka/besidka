/**
 * Plain-text helpers for the reports the built-in commands show (`/cost`,
 * `/stats`). A report is one code block that must fit a 390 px phone
 * without wrapping, so a row is at most `REPORT_WIDTH` characters: the
 * label on the left, the value right-aligned. A row that cannot fit keeps
 * one space between the two instead of cutting either.
 */
export const REPORT_WIDTH = 40

const DAY_SECONDS = 24 * 60 * 60

export function reportRow(label: string, value: string, indent = 0): string {
  const left = `${' '.repeat(indent)}${label}`
  const gap = REPORT_WIDTH - left.length - value.length

  return `${left}${' '.repeat(Math.max(1, gap))}${value}`
}

// eslint-disable-next-line no-control-regex
const REPORT_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]+/g

/**
 * One line of a report from text a user or a provider chose (a model id, a
 * connector title): control characters, line breaks and invisible direction
 * marks become a single space, so the text can never add a line or reorder
 * the ones around it.
 */
export function toReportLabel(text: string): string {
  return text.replace(REPORT_CONTROL_CHARACTERS, ' ').trim()
}

/**
 * A free-text line cut to the report width with an ellipsis, for names
 * (model ids) that can be longer than a phone line. The text is made a
 * single line first (`toReportLabel`).
 */
export function fitReportLine(text: string): string {
  const line = toReportLabel(text)

  return line.length > REPORT_WIDTH
    ? `${line.slice(0, REPORT_WIDTH - 1)}…`
    : line
}

export function reportRule(): string {
  return '-'.repeat(REPORT_WIDTH)
}

/**
 * A UTC date and time as `2026-11-20 14:05`, the one form every report uses,
 * so the reports read the same for every user and every time zone.
 */
export function formatReportDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

export function formatReportDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * A span of time as the two largest units: `3d 4h`, `5h 12m`, `40m`, `<1m`.
 */
export function formatReportSpan(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000)

  if (totalMinutes < 1) {
    return '<1m'
  }

  const days = Math.floor(totalMinutes / (DAY_SECONDS / 60))
  const hours = Math.floor((totalMinutes % (DAY_SECONDS / 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  return `${minutes}m`
}

const COUNT_FORMATTER = new Intl.NumberFormat('en-US')

export function formatReportCount(count: number): string {
  return COUNT_FORMATTER.format(Math.round(count))
}
