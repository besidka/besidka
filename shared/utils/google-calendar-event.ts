import {
  collapseBlankLinesForCard,
  countBodyLines,
} from '#shared/utils/google-gmail-draft-view'
import {
  hasUnsafeBodyCharacter,
  hasUnsafeHeaderCharacter,
} from '#shared/utils/mail-address'

export const GOOGLE_CALENDAR_TITLE_MAX_CHARACTERS = 200
export const GOOGLE_CALENDAR_DESCRIPTION_MAX_CHARACTERS = 4000
export const GOOGLE_CALENDAR_LOCATION_MAX_CHARACTERS = 300
export const GOOGLE_CALENDAR_WINDOW_MAX_DAYS = 31

const MINUTE_MILLISECONDS = 60_000
const DAY_MILLISECONDS = 86_400_000
const MINIMUM_YEAR = 1000
const MAXIMUM_OFFSET_HOURS = 23
const MAXIMUM_OFFSET_MINUTES = 59
const TIME_ZONE_MAX_LENGTH = 64
const ALIAS_SHOUTED_SEGMENT_MIN_LENGTH = 3
const EVENT_LINK_MAX_LENGTH = 600
const WINDOW_CLOCK_CHANGE_ALLOWANCE_MILLISECONDS = 60 * MINUTE_MILLISECONDS
const HOUR_MINUTES = 60
const DAY_MINUTES = 1440
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_PATTERN
  = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const TIME_ZONE_PATTERN
  = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/
const EVENT_LINK_PATTERN
  = /^https:\/\/(?:www\.google\.com|calendar\.google\.com)\/calendar\/event\?eid=[A-Za-z0-9_-]{1,512}$/

export interface CalendarEventInput {
  title: string
  start: string
  end: string
  timeZone: string
  description?: string
  location?: string
}

export interface CalendarEventDateTime {
  dateTime?: string
  date?: string
  timeZone: string
}

/**
 * The only fields a Besidka calendar request can carry. There is no
 * `attendees`, `conferenceData`, `recurrence`, `reminders` or `attachments`
 * key anywhere in the type, so an event made here invites nobody.
 */
export interface CalendarInsertBody {
  summary: string
  description?: string
  location?: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
}

export type CalendarEventValidation
  = | { ok: true, body: CalendarInsertBody }
    | { ok: false, message: string }

export interface CalendarEventApprovalView {
  title: string
  isAllDay: boolean
  start: string
  end: string
  lastDay: string | null
  startLabel: string
  endLabel: string
  lastDayLabel: string | null
  durationLabel: string
  timeZone: string
  description: string
  cardDescription: string
  descriptionLineCount: number
  location: string
}

interface ParsedDate {
  year: number
  month: number
  day: number
}

interface ParsedDateTime {
  instantMilliseconds: number
  offsetMinutes: number
  hasFraction: boolean
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function parseDate(value: string): ParsedDate | null {
  const match = DATE_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const moment = new Date(Date.UTC(year, month - 1, day))
  const isReal = year >= MINIMUM_YEAR
    && moment.getUTCFullYear() === year
    && moment.getUTCMonth() === month - 1
    && moment.getUTCDate() === day

  return isReal ? { year, month, day } : null
}

function parseDateTime(value: string): ParsedDateTime | null {
  const match = DATE_TIME_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`)
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const zone = match[8]!

  if (!date || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  let offsetMinutes = 0

  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3))
    const offsetRest = Number(zone.slice(4, 6))

    if (
      offsetHours > MAXIMUM_OFFSET_HOURS
      || offsetRest > MAXIMUM_OFFSET_MINUTES
    ) {
      return null
    }

    offsetMinutes = (zone.startsWith('-') ? -1 : 1)
      * (offsetHours * 60 + offsetRest)
  }

  const milliseconds = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    second,
  )

  return {
    instantMilliseconds: milliseconds - offsetMinutes * MINUTE_MILLISECONDS,
    offsetMinutes,
    hasFraction: match[7] !== undefined,
  }
}

function resolveTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions().timeZone
  } catch {
    return null
  }
}

function isShoutedSegment(segment: string): boolean {
  return segment.length > ALIAS_SHOUTED_SEGMENT_MIN_LENGTH
    && segment === segment.toUpperCase()
}

/**
 * Whether a string is an IANA time zone name the runtime knows, in the
 * letter case people write it (`Europe/Kyiv`, `America/New_York`, `UTC`).
 * A name the runtime resolves to the same name only in another letter case
 * is refused, and so are a name it does not know and an offset such as
 * `+02:00`. A newer name the runtime resolves to an older one (the
 * runtime's own list has `Asia/Calcutta` for `Asia/Kolkata`) is accepted
 * when every part starts with a capital letter and none is shouted.
 */
export function isKnownTimeZone(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length > TIME_ZONE_MAX_LENGTH
    || !TIME_ZONE_PATTERN.test(value)
  ) {
    return false
  }

  const resolved = resolveTimeZone(value)

  if (resolved === null) {
    return false
  }

  if (resolved.toLowerCase() === value.toLowerCase()) {
    return resolved === value
  }

  const segments = value.split('/')

  return segments.every((segment) => {
    return /^[A-Z]/.test(segment) && !isShoutedSegment(segment)
  })
}

/**
 * The offset of a time zone at one instant, in minutes east of UTC, from the
 * runtime's own time zone data.
 */
export function getTimeZoneOffsetMinutes(
  timeZone: string,
  instantMilliseconds: number,
): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMilliseconds))
  const read = (type: string): number => {
    return Number(parts.find(part => part.type === type)?.value ?? 0)
  }
  const wallMilliseconds = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  )
  const instantSeconds = Math.floor(instantMilliseconds / 1000) * 1000

  return Math.round(
    (wallMilliseconds - instantSeconds) / MINUTE_MILLISECONDS,
  )
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)

  return `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`
}

function dayNumber(date: ParsedDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MILLISECONDS
}

function formatDayNumber(days: number): string {
  const moment = new Date(days * DAY_MILLISECONDS)

  return `${pad(moment.getUTCFullYear(), 4)}-${
    pad(moment.getUTCMonth() + 1, 2)}-${pad(moment.getUTCDate(), 2)}`
}

interface WallClock {
  date: ParsedDate
  hour: number
  minute: number
  offsetMinutes: number
  isUtcDesignator: boolean
}

function readWallClock(value: string): WallClock | null {
  const parsed = parseDateTime(value)
  const match = DATE_TIME_PATTERN.exec(value)

  if (!parsed || !match) {
    return null
  }

  return {
    date: {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    },
    hour: Number(match[4]),
    minute: Number(match[5]),
    offsetMinutes: parsed.offsetMinutes,
    isUtcDesignator: match[8] === 'Z',
  }
}

function formatDayLabel(date: ParsedDate, withWeekday: boolean): string {
  const weekday = WEEKDAY_NAMES[
    new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  ]
  const text = `${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`

  return withWeekday ? `${weekday}, ${text}` : text
}

function formatClock(clock: WallClock): string {
  return `${pad(clock.hour, 2)}:${pad(clock.minute, 2)}`
}

function formatZone(clock: WallClock): string {
  if (clock.isUtcDesignator) {
    return 'UTC'
  }

  return `UTC${formatOffset(clock.offsetMinutes)}`
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

function formatDuration(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / DAY_MINUTES)
  const hours = Math.floor((totalMinutes % DAY_MINUTES) / HOUR_MINUTES)
  const minutes = totalMinutes % HOUR_MINUTES
  const parts = [
    ...(days > 0 ? [pluralize(days, 'day')] : []),
    ...(hours > 0 ? [pluralize(hours, 'hour')] : []),
    ...(minutes > 0 ? [pluralize(minutes, 'minute')] : []),
  ]

  return parts.length > 0 ? parts.join(' ') : 'Under a minute'
}

function formatTimedLabel(clock: WallClock | null, fallback: string): string {
  if (!clock) {
    return fallback
  }

  return `${formatDayLabel(clock.date, true)}, ${formatClock(clock)} (${
    formatZone(clock)})`
}

function formatEventDuration(
  start: string,
  end: string,
  startDate: ParsedDate | null,
  endDate: ParsedDate | null,
): string {
  if (startDate && endDate) {
    return pluralize(dayNumber(endDate) - dayNumber(startDate), 'day')
  }

  const startMilliseconds = parseDateTime(start)?.instantMilliseconds
  const endMilliseconds = parseDateTime(end)?.instantMilliseconds

  if (startMilliseconds === undefined || endMilliseconds === undefined) {
    return ''
  }

  return formatDuration(
    Math.round((endMilliseconds - startMilliseconds) / MINUTE_MILLISECONDS),
  )
}

function refuse(message: string): CalendarEventValidation {
  return { ok: false, message }
}

function hasEdgeWhitespace(value: string): boolean {
  return value.trim() !== value
}

function checkTimedEnd(
  input: CalendarEventInput,
  start: ParsedDateTime,
  end: ParsedDateTime,
  checkTimeZoneData: boolean,
): string | null {
  if (start.hasFraction || end.hasFraction) {
    return 'start and end must not have fractions of a second'
  }

  const boundaries = checkTimeZoneData
    ? [
      ['start', input.start, start],
      ['end', input.end, end],
    ] as const
    : []

  for (const [name, value, parsed] of boundaries) {
    const zoneOffset = getTimeZoneOffsetMinutes(
      input.timeZone,
      parsed.instantMilliseconds,
    )

    if (zoneOffset !== parsed.offsetMinutes) {
      return `The ${name} time ${value} does not exist in ${input.timeZone}: `
        + `the offset there at that moment is ${formatOffset(zoneOffset)}. `
        + 'Use that offset, and a time that exists on that day.'
    }
  }

  return end.instantMilliseconds > start.instantMilliseconds
    ? null
    : 'The end must be after the start.'
}

/**
 * Checks one event input and, only when it is entirely valid, turns it into
 * the request body. Nothing is repaired: an invalid time, an offset that is
 * not the one the time zone has at that moment (a stale offset after a
 * daylight saving change, or a time that falls in the spring gap), mixed
 * date and date-time forms, an end that is not after the start, padded text
 * or an unsafe character is a refusal with one fixed sentence. For an
 * all-day event the end date is exclusive (Google's meaning): one day on
 * 2026-12-01 is start 2026-12-01 and end 2026-12-02. With
 * `checkTimeZoneData: false` the two checks that need the runtime's time zone
 * data (the name is known, the offset is the zone's at that instant) are
 * skipped and only the shape of the name is checked: the approval card uses
 * that, because the server already enforced them before the approval was
 * asked and a browser's time zone data must not turn a valid card into raw
 * arguments.
 */
export function validateCalendarEvent(
  value: unknown,
  options: { checkTimeZoneData?: boolean } = {},
): CalendarEventValidation {
  const checkTimeZoneData = options.checkTimeZoneData !== false
  const input = value as Partial<CalendarEventInput> | null

  if (
    typeof input !== 'object'
    || input === null
    || typeof input.title !== 'string'
    || typeof input.start !== 'string'
    || typeof input.end !== 'string'
    || typeof input.timeZone !== 'string'
  ) {
    return refuse('The event needs a title, a start, an end and a time zone.')
  }

  const title: string = input.title
  const start: string = input.start
  const end: string = input.end
  const timeZone: string = input.timeZone
  const description = typeof input.description === 'string' && input.description
    ? input.description
    : undefined
  const location = typeof input.location === 'string' && input.location
    ? input.location
    : undefined

  if (
    !title
    || title.length > GOOGLE_CALENDAR_TITLE_MAX_CHARACTERS
    || hasEdgeWhitespace(title)
    || hasUnsafeHeaderCharacter(title)
  ) {
    return refuse(
      `The title must be 1 to ${GOOGLE_CALENDAR_TITLE_MAX_CHARACTERS} `
      + 'characters on one line, without spaces at its start or end and '
      + 'without control or invisible characters.',
    )
  }

  if (
    description !== undefined
    && (
      description.length > GOOGLE_CALENDAR_DESCRIPTION_MAX_CHARACTERS
      || hasUnsafeBodyCharacter(description)
    )
  ) {
    return refuse(
      `The description must be at most ${
        GOOGLE_CALENDAR_DESCRIPTION_MAX_CHARACTERS} characters of plain text `
        + 'without control or invisible characters.',
    )
  }

  if (
    location !== undefined
    && (
      location.length > GOOGLE_CALENDAR_LOCATION_MAX_CHARACTERS
      || hasEdgeWhitespace(location)
      || hasUnsafeHeaderCharacter(location)
    )
  ) {
    return refuse(
      `The location must be at most ${GOOGLE_CALENDAR_LOCATION_MAX_CHARACTERS} `
      + 'characters on one line, without spaces at its start or end and '
      + 'without control or invisible characters.',
    )
  }

  const hasValidTimeZone = checkTimeZoneData
    ? isKnownTimeZone(timeZone)
    : timeZone.length <= TIME_ZONE_MAX_LENGTH
      && TIME_ZONE_PATTERN.test(timeZone)

  if (!hasValidTimeZone) {
    return refuse(
      'timeZone must be an IANA time zone name in its usual letter case, '
      + 'such as Europe/Kyiv or America/New_York, or UTC.',
    )
  }

  const startDate = parseDate(start)
  const endDate = parseDate(end)
  const startDateTime = parseDateTime(start)
  const endDateTime = parseDateTime(end)
  const isAllDay = startDate !== null && endDate !== null
  const isTimed = startDateTime !== null && endDateTime !== null

  if (!isAllDay && !isTimed) {
    return refuse(
      'start and end must both be real dates (YYYY-MM-DD, for an all-day '
      + 'event) or both be RFC 3339 date-times with an explicit offset, such '
      + 'as 2026-12-01T10:00:00+01:00.',
    )
  }

  if (isAllDay) {
    if (dayNumber(endDate) <= dayNumber(startDate)) {
      return refuse(
        'For an all-day event the end date is exclusive and must be after '
        + 'the start date: one day on 2026-12-01 is start 2026-12-01 and end '
        + '2026-12-02.',
      )
    }
  } else {
    const message = checkTimedEnd(
      { title, start, end, timeZone },
      startDateTime!,
      endDateTime!,
      checkTimeZoneData,
    )

    if (message) {
      return refuse(message)
    }
  }

  const toBoundary = (boundary: string): CalendarEventDateTime => {
    return isAllDay
      ? { date: boundary, timeZone }
      : { dateTime: boundary, timeZone }
  }

  return {
    ok: true,
    body: {
      summary: title,
      ...(description !== undefined ? { description } : {}),
      ...(location !== undefined ? { location } : {}),
      start: toBoundary(start),
      end: toBoundary(end),
    },
  }
}

/**
 * What an approval card shows for a create-event input. It is read from the
 * request body that `validateCalendarEvent` builds, which is the body the
 * tool sends, so the card cannot differ from what runs. Null for an input
 * that is not a valid event. It does not repeat the two checks that need the
 * runtime's time zone data (the server ran them before the approval).
 */
export function readCalendarEventApprovalView(
  input: unknown,
): CalendarEventApprovalView | null {
  const validation = validateCalendarEvent(input, { checkTimeZoneData: false })

  if (!validation.ok) {
    return null
  }

  const { body } = validation
  const isAllDay = body.start.date !== undefined
  const start = body.start.date ?? body.start.dateTime ?? ''
  const end = body.end.date ?? body.end.dateTime ?? ''
  const startDate = isAllDay ? parseDate(start) : null
  const endDate = isAllDay ? parseDate(end) : null
  const lastDay = endDate ? formatDayNumber(dayNumber(endDate) - 1) : null
  const startClock = isAllDay ? null : readWallClock(start)
  const endClock = isAllDay ? null : readWallClock(end)
  const lastDayDate = lastDay ? parseDate(lastDay) : null
  const description = body.description ?? ''

  return {
    title: body.summary,
    isAllDay,
    start,
    end,
    lastDay,
    startLabel: startDate
      ? formatDayLabel(startDate, true)
      : formatTimedLabel(startClock, start),
    endLabel: endDate
      ? formatDayLabel(endDate, true)
      : formatTimedLabel(endClock, end),
    lastDayLabel: lastDayDate ? formatDayLabel(lastDayDate, true) : null,
    durationLabel: formatEventDuration(start, end, startDate, endDate),
    timeZone: body.start.timeZone,
    description,
    cardDescription: collapseBlankLinesForCard(description),
    descriptionLineCount: description ? countBodyLines(description) : 0,
    location: body.location ?? '',
  }
}

export type CalendarWindowValidation
  = | { ok: true, timeMin: string, timeMax: string }
    | { ok: false, message: string }

/**
 * A reading window: two RFC 3339 date-times with an explicit offset, the
 * end after the start and at most 31 calendar days apart. The span is
 * compared in real time, so one hour is allowed on top of 31 days: a whole
 * month that contains the clocks going back is 31 days and one hour long.
 */
export function validateCalendarWindow(
  from: unknown,
  to: unknown,
): CalendarWindowValidation {
  const start = typeof from === 'string' ? parseDateTime(from) : null
  const end = typeof to === 'string' ? parseDateTime(to) : null

  if (
    !start
    || !end
    || start.hasFraction
    || end.hasFraction
  ) {
    return {
      ok: false,
      message: 'from and to must be RFC 3339 date-times with an explicit '
        + 'offset and no fraction of a second, such as '
        + '2026-12-01T00:00:00+01:00.',
    }
  }

  if (end.instantMilliseconds <= start.instantMilliseconds) {
    return { ok: false, message: 'to must be after from.' }
  }

  const span = end.instantMilliseconds - start.instantMilliseconds

  if (
    span > GOOGLE_CALENDAR_WINDOW_MAX_DAYS * DAY_MILLISECONDS
    + WINDOW_CLOCK_CHANGE_ALLOWANCE_MILLISECONDS
  ) {
    return {
      ok: false,
      message: `The window must be at most ${
        GOOGLE_CALENDAR_WINDOW_MAX_DAYS} days long.`,
    }
  }

  return { ok: true, timeMin: from as string, timeMax: to as string }
}

/**
 * A time Google returned for an event or a busy interval, only when it has
 * exactly the shape of a date or an RFC 3339 date-time. Anything else is
 * null, so no free text from a response reaches the model through a time.
 */
export function readCalendarResponseTime(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  return parseDate(value) !== null || parseDateTime(value) !== null
    ? value
    : null
}

/**
 * The instant of an RFC 3339 date-time, in milliseconds since the epoch, or
 * null for anything else (a bare date, free text, a non-string).
 */
export function readCalendarInstantMilliseconds(
  value: unknown,
): number | null {
  return typeof value === 'string'
    ? parseDateTime(value)?.instantMilliseconds ?? null
    : null
}

/**
 * The day before a real `YYYY-MM-DD` date, which is the last day of an
 * all-day event whose end date is exclusive. Null for anything else.
 */
export function getCalendarDayBefore(value: string): string | null {
  const date = parseDate(value)

  return date ? formatDayNumber(dayNumber(date) - 1) : null
}

function isMidnight(clock: WallClock): boolean {
  return clock.hour === 0 && clock.minute === 0
}

/**
 * A reading window the way the owner would say it: "from Dec 1, 2026 to
 * Dec 7, 2026" for a window of whole days (the exclusive end is shown as
 * the last day that is read) and the times as well when one is not
 * midnight. Null for a value that is not a pair of date-times.
 */
export function describeCalendarWindow(
  from: unknown,
  to: unknown,
): string | null {
  const start = typeof from === 'string' ? readWallClock(from) : null
  const end = typeof to === 'string' ? readWallClock(to) : null

  if (!start || !end) {
    return null
  }

  if (isMidnight(start) && isMidnight(end)) {
    const lastDay = parseDate(
      formatDayNumber(dayNumber(end.date) - 1),
    )

    return `from ${formatDayLabel(start.date, false)} to ${
      formatDayLabel(lastDay ?? end.date, false)}`
  }

  return `from ${formatDayLabel(start.date, false)}, ${formatClock(start)} to ${
    formatDayLabel(end.date, false)}, ${formatClock(end)}`
}

/**
 * The calendar day (`YYYY-MM-DD`) a response time falls on in its own
 * offset, or null for a value that is not a time.
 */
export function readCalendarDay(value: unknown): string | null {
  const time = readCalendarResponseTime(value)

  return time ? time.slice(0, 10) : null
}

/**
 * The link stored for an event: Google's own `htmlLink` only in exactly its
 * known shape (`/calendar/event?eid=<token>` on `www.google.com` or
 * `calendar.google.com`), otherwise the day view of the event's start day,
 * otherwise Google Calendar itself.
 */
export function buildCalendarEventLink(
  htmlLink: unknown,
  day: string | null,
): string {
  if (
    typeof htmlLink === 'string'
    && htmlLink.length <= EVENT_LINK_MAX_LENGTH
    && EVENT_LINK_PATTERN.test(htmlLink)
  ) {
    return htmlLink
  }

  return buildCalendarDayLink(day)
}

export function buildCalendarDayLink(day: string | null): string {
  const date = typeof day === 'string' ? parseDate(day) : null

  return date
    ? `https://calendar.google.com/calendar/r/day/${date.year}/${
      date.month}/${date.day}`
    : 'https://calendar.google.com/calendar/'
}
