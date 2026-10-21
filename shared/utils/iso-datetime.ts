const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const DATETIME_WITH_OFFSET_PATTERN
  = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

function isRealCalendarDate(
  year: string,
  month: string,
  day: string,
): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))

  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
}

/**
 * Normalise a date value for structured data that Google requires to carry a
 * timezone. A date-only `YYYY-MM-DD` becomes `YYYY-MM-DDT00:00:00+00:00`; a
 * full datetime that already has a `Z` or `±hh:mm` offset passes through
 * unchanged. Anything else, including a datetime without an offset or an
 * impossible calendar date, returns null so callers can omit the field
 * instead of emitting an invalid value.
 */
export function toIsoDateTimeWithOffset(value: string): string | null {
  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(value)

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch

    return isRealCalendarDate(year!, month!, day!)
      ? `${value}T00:00:00+00:00`
      : null
  }

  const dateTimeMatch = DATETIME_WITH_OFFSET_PATTERN.exec(value)

  if (!dateTimeMatch) {
    return null
  }

  const [, year, month, day] = dateTimeMatch

  return isRealCalendarDate(year!, month!, day!) ? value : null
}
