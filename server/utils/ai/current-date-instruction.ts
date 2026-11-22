import { isKnownTimeZone } from '#shared/utils/google-calendar-event'

const FALLBACK_TIME_ZONE = 'UTC'
const RELATIVE_DATE_RULE = 'Use this for "today", "tomorrow", "this week" and '
  + 'every other relative date. Never take the current date from your own '
  + 'knowledge.'

export const CURRENT_DATE_SEARCH_HINT = 'Use the current date given in '
  + 'these instructions for "latest" questions and for freshness '
  + 'filters; do not search for the current date.'

interface LocalDay {
  weekday: string
  isoDate: string
}

function readLocalDay(now: Date, timeZone: string): LocalDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  function readPart(type: Intl.DateTimeFormatPartTypes): string {
    return parts.find((part) => {
      return part.type === type
    })?.value ?? ''
  }

  return {
    weekday: readPart('weekday'),
    isoDate: `${readPart('year')}-${readPart('month')}-${readPart('day')}`,
  }
}

/**
 * The last line of every chat system text: the user's calendar day, to the
 * day and no finer, so the line changes once a day and the provider's
 * prompt cache over everything before it stays valid. The time zone comes
 * from the request and is echoed only when it is a known IANA name; anything
 * else falls back to UTC and never reaches the text.
 */
export function buildCurrentDateInstruction(
  now: Date,
  timeZone?: unknown,
): string {
  if (!isKnownTimeZone(timeZone)) {
    const { weekday, isoDate } = readLocalDay(now, FALLBACK_TIME_ZONE)

    return `Today is ${weekday}, ${isoDate} (UTC; the user's time zone is `
      + `unknown). ${RELATIVE_DATE_RULE}`
  }

  const { weekday, isoDate } = readLocalDay(now, timeZone)

  return `Today is ${weekday}, ${isoDate} in the user's time zone `
    + `(${timeZone}). ${RELATIVE_DATE_RULE}`
}
