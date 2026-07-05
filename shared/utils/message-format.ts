const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat('en-US')

const COST_ABOVE_CENT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
  useGrouping: false,
})

const COST_BELOW_CENT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
  useGrouping: false,
})

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatTokenCount(
  count: number | undefined | null,
): string {
  if (count === undefined || count === null) {
    return '—'
  }

  return TOKEN_COUNT_FORMATTER.format(count)
}

/**
 * Formats a US dollar cost for display.
 *
 * Contract:
 * - `undefined`/`null` renders as an em-dash.
 * - `0` renders as `$0.00`.
 * - Values below one hundredth of a cent (`0.0001`) render as
 *   `< $0.0001` instead of misleadingly rounding down to `$0.0000`.
 * - Values at or above one cent (`0.01`) render with 2 to 4 decimals,
 *   always keeping at least 2 decimals.
 * - Smaller positive values render with up to 6 decimals.
 * - In both cases, trailing zeros beyond the minimum are trimmed.
 */
export function formatMessageCost(
  cost: number | undefined | null,
): string {
  if (cost === undefined || cost === null) {
    return '—'
  }

  if (cost === 0) {
    return '$0.00'
  }

  if (cost > 0 && cost < 0.0001) {
    return '< $0.0001'
  }

  const formatter = cost >= 0.01
    ? COST_ABOVE_CENT_FORMATTER
    : COST_BELOW_CENT_FORMATTER

  return `$${formatter.format(cost)}`
}

export function formatMessageDateTime(
  value: string | number | Date | undefined | null,
): { date: string, time: string } {
  const empty = { date: '', time: '' }

  if (value === undefined || value === null) {
    return empty
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return empty
  }

  return {
    date: DATE_FORMATTER.format(parsedDate),
    time: TIME_FORMATTER.format(parsedDate),
  }
}
