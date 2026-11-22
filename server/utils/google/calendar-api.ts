import {
  GOOGLE_CALENDAR_FREE_BUSY_RESPONSE_MAX_BYTES,
  GOOGLE_CALENDAR_LIST_EVENTS_MAX,
  GOOGLE_CALENDAR_LIST_RESPONSE_MAX_BYTES,
} from '#shared/utils/google-calendar-tools'
import type {
  CalendarEventDateTime,
  CalendarInsertBody,
} from '#shared/utils/google-calendar-event'
import { readReason } from '~~/server/utils/google/drive'
import {
  GOOGLE_RESPONSE_TOO_LARGE_MESSAGE,
  googleFetchJson,
} from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'

const PRIMARY_EVENTS_URL
  = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const FREE_BUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'
const PRIMARY_CALENDAR_ID = 'primary'
const LIST_FIELDS = 'timeZone,nextPageToken,items(id,status,eventType,summary,'
  + 'description,location,start,end,htmlLink,transparency,'
  + 'organizer(self,displayName),attendees(self,responseStatus),hangoutLink,'
  + 'conferenceData(entryPoints(entryPointType)),attachments(fileId))'
const FREE_BUSY_FIELDS = 'calendars/*/busy,calendars/*/errors'
const INSERT_FIELDS = 'id,htmlLink,start,end'
const NO_GUEST_NOTIFICATIONS = 'none'
const BASE32_HEX_ALPHABET = '0123456789abcdefghijklmnopqrstuv'
const BITS_PER_BASE32_CHARACTER = 5
const EVENT_ID_SEED_PREFIX = 'besidka:calendar-event:'
const RANDOM_EVENT_ID_BYTES = 16
const SERVICE_DISABLED_REASON = 'SERVICE_DISABLED'
const DUPLICATE_REASON = 'duplicate'

export interface CalendarRequestContext {
  accessToken: string
  fetchImpl?: GoogleFetchImplementation
}

export type CalendarFailureCode
  = | 'reauthorize'
    | 'api_disabled'
    | 'no_access'
    | 'not_found'
    | 'rate_limited'
    | 'too_large'
    | 'bad_request'
    | 'already_exists'
    | 'calendar_not_found'
    | 'calendar_error'
    | 'failed'

export const CALENDAR_FAILURE_TEXT: Readonly<
  Record<CalendarFailureCode, string>
> = {
  reauthorize: 'Google no longer accepts the connection to your own Google '
    + 'client. Reconnect it on the API Keys page, Google tab.',
  api_disabled: 'The Google Calendar API is not turned on in the Google '
    + 'Cloud project of your own Google client. Turn it on there and try '
    + 'again.',
  no_access: 'Google Calendar refused the request. Reconnect your own Google '
    + 'client on the API Keys page and allow the Google Calendar access this '
    + 'tool needs.',
  not_found: 'Google Calendar has nothing for that request.',
  rate_limited: 'Google Calendar asked Besidka to slow down. Try again in a '
    + 'moment.',
  too_large: 'Google Calendar answered with more than fits here. Use a '
    + 'shorter window.',
  bad_request: 'Google Calendar did not accept the request. Check the times '
    + 'and try again.',
  already_exists: 'Google Calendar reported that an item with the same '
    + 'identifier already exists.',
  calendar_not_found: 'Google Calendar could not find the primary calendar '
    + 'of this account.',
  calendar_error: 'Google Calendar could not answer for the primary '
    + 'calendar. Try again in a moment.',
  failed: 'Google Calendar could not be reached or answered with an error. '
    + 'Try again in a moment.',
}

export const CALENDAR_CREATE_UNCONFIRMED_TEXT = 'Google Calendar did not '
  + 'confirm the event, so it may or may not have been created. Ask the user '
  + 'to check their calendar before trying again.'

export const CALENDAR_CREATE_NO_APPROVAL_TEXT = 'The event could not be '
  + 'created. Nothing was sent to Google Calendar.'

export type CalendarResult<Value>
  = | { ok: true, value: Value }
    | { ok: false, code: CalendarFailureCode }

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'calendarUsageLimitsExceeded',
])

/**
 * The reason of a Calendar error answer. A disabled API is reported twice by
 * Google: as `accessNotConfigured` in `error.errors` and, for Cloud-style
 * errors, as `SERVICE_DISABLED` in `error.details`, which `readReason` never
 * reads, so it is looked for here first.
 */
export function readCalendarReason(
  body: Record<string, unknown> | null,
): string | null {
  const error = body?.error
  const details = isRecord(error) ? error.details : undefined

  if (Array.isArray(details) && details.some((detail) => {
    return isRecord(detail) && detail.reason === SERVICE_DISABLED_REASON
  })) {
    return SERVICE_DISABLED_REASON
  }

  return readReason(body)
}

/**
 * Maps a Calendar answer that is not a success to one code with a fixed
 * sentence. Google's own message text is never forwarded: it can echo the
 * request.
 */
export function classifyCalendarFailure(
  status: number,
  reason: string | null,
): CalendarFailureCode {
  if (status === 401) {
    return 'reauthorize'
  }

  if (reason === 'accessNotConfigured' || reason === SERVICE_DISABLED_REASON) {
    return 'api_disabled'
  }

  if (status === 404) {
    return 'not_found'
  }

  if (status === 409) {
    return reason === DUPLICATE_REASON ? 'already_exists' : 'failed'
  }

  if (status === 429 || (reason && RATE_LIMIT_REASONS.has(reason))) {
    return 'rate_limited'
  }

  if (status === 403) {
    return 'no_access'
  }

  return status === 400 ? 'bad_request' : 'failed'
}

function classifyException(exception: unknown): CalendarFailureCode {
  const message = exception instanceof Error ? exception.message : ''

  return message === GOOGLE_RESPONSE_TOO_LARGE_MESSAGE ? 'too_large' : 'failed'
}

function queryOf(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries
    .map(([key, value]) => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')
}

function toFetchOptions(
  context: CalendarRequestContext,
  extra: GoogleFetchOptions,
): GoogleFetchOptions {
  return context.fetchImpl
    ? { ...extra, fetchImpl: context.fetchImpl }
    : extra
}

async function requestJson(
  url: string,
  request: Parameters<typeof googleFetchJson>[1],
  options: GoogleFetchOptions,
): Promise<CalendarResult<Record<string, unknown>>> {
  try {
    const response = await googleFetchJson(url, request, options)

    if (!response.ok || !response.body) {
      return {
        ok: false,
        code: response.ok
          ? 'failed'
          : classifyCalendarFailure(
            response.status,
            readCalendarReason(response.body),
          ),
      }
    }

    return { ok: true, value: response.body }
  } catch (exception) {
    return { ok: false, code: classifyException(exception) }
  }
}

function headersOf(context: CalendarRequestContext): Record<string, string> {
  return { authorization: `Bearer ${context.accessToken}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ListedCalendarEvents {
  events: Record<string, unknown>[]
  timeZone: unknown
  hasMore: boolean
}

/**
 * `events.list` on the owner's primary calendar for one window: recurring
 * events expanded (`singleEvents`), ordered by start, at most 50, with a
 * `fields` mask that leaves attendee addresses and names out of the answer.
 * The range comes from `validateCalendarWindow`.
 */
export async function listCalendarEvents(
  range: { timeMin: string, timeMax: string },
  context: CalendarRequestContext,
): Promise<CalendarResult<ListedCalendarEvents>> {
  const result = await requestJson(
    `${PRIMARY_EVENTS_URL}?${queryOf([
      ['timeMin', range.timeMin],
      ['timeMax', range.timeMax],
      ['singleEvents', 'true'],
      ['orderBy', 'startTime'],
      ['maxResults', String(GOOGLE_CALENDAR_LIST_EVENTS_MAX)],
      ['fields', LIST_FIELDS],
    ])}`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {
      maxResponseBytes: GOOGLE_CALENDAR_LIST_RESPONSE_MAX_BYTES,
    }),
  )

  if (!result.ok) {
    return result
  }

  const items = Array.isArray(result.value.items) ? result.value.items : []

  return {
    ok: true,
    value: {
      events: items.filter(isRecord),
      timeZone: result.value.timeZone,
      hasMore: typeof result.value.nextPageToken === 'string'
        && result.value.nextPageToken.length > 0,
    },
  }
}

function classifyFreeBusyError(errors: unknown[]): CalendarFailureCode {
  const isNotFound = errors.some((error) => {
    return isRecord(error) && error.reason === 'notFound'
  })

  return isNotFound ? 'calendar_not_found' : 'calendar_error'
}

/**
 * `freeBusy.query` for the primary calendar only. The answer holds the busy
 * intervals and nothing else: the calendar's key in the answer is never
 * read, because it can be the account's address.
 */
export async function getCalendarFreeBusy(
  range: { timeMin: string, timeMax: string },
  context: CalendarRequestContext,
): Promise<CalendarResult<{ busy: unknown[] }>> {
  const body = JSON.stringify({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    items: [{ id: PRIMARY_CALENDAR_ID }],
  })
  const result = await requestJson(
    `${FREE_BUSY_URL}?${queryOf([['fields', FREE_BUSY_FIELDS]])}`,
    {
      method: 'POST',
      headers: headersOf(context),
      rawBody: {
        contentType: 'application/json',
        data: new TextEncoder().encode(body) as Uint8Array<ArrayBuffer>,
      },
    },
    toFetchOptions(context, {
      maxResponseBytes: GOOGLE_CALENDAR_FREE_BUSY_RESPONSE_MAX_BYTES,
    }),
  )

  if (!result.ok) {
    return result
  }

  const calendars = isRecord(result.value.calendars)
    ? Object.values(result.value.calendars)
    : []
  const entry = calendars.length === 1 && isRecord(calendars[0])
    ? calendars[0]
    : null

  if (!entry) {
    return { ok: false, code: 'failed' }
  }

  if (Array.isArray(entry.errors) && entry.errors.length > 0) {
    return { ok: false, code: classifyFreeBusyError(entry.errors) }
  }

  return {
    ok: true,
    value: { busy: Array.isArray(entry.busy) ? entry.busy : [] },
  }
}

export interface CreatedCalendarEvent {
  id: string
  htmlLink: unknown
  start: unknown
  alreadyExisted: boolean
}

function encodeBase32Hex(bytes: Uint8Array): string {
  let buffer = 0
  let bufferedBits = 0
  let encoded = ''

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bufferedBits += 8

    while (bufferedBits >= BITS_PER_BASE32_CHARACTER) {
      bufferedBits -= BITS_PER_BASE32_CHARACTER
      encoded += BASE32_HEX_ALPHABET[(buffer >> bufferedBits) & 31]
    }

    buffer &= (1 << bufferedBits) - 1
  }

  if (bufferedBits > 0) {
    encoded += BASE32_HEX_ALPHABET[
      (buffer << (BITS_PER_BASE32_CHARACTER - bufferedBits)) & 31
    ]
  }

  return encoded
}

/**
 * The event id Besidka sends with an insert: base32hex characters (`a` to
 * `v` and `0` to `9`), 52 of them, which is inside Google's rule of 5 to
 * 1024. It is derived from the seed (the user and the tool call that was
 * approved), so a second run of the same approved call sends the same id and
 * Google answers 409 instead of creating a second event. Without a seed the
 * id is random, which is valid but not repeatable.
 */
export async function buildCalendarEventId(seed?: string): Promise<string> {
  if (seed === undefined) {
    return encodeBase32Hex(
      crypto.getRandomValues(new Uint8Array(RANDOM_EVENT_ID_BYTES)),
    )
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${EVENT_ID_SEED_PREFIX}${seed}`),
  )

  return encodeBase32Hex(new Uint8Array(digest))
}

function boundaryOf(boundary: CalendarEventDateTime): CalendarEventDateTime {
  return boundary.date !== undefined
    ? { date: boundary.date, timeZone: boundary.timeZone }
    : { dateTime: boundary.dateTime, timeZone: boundary.timeZone }
}

/**
 * The request body of an event, copied field by field from the validated
 * body: only the client-supplied `id`, a title, a description, a location, a
 * start and an end can ever be in it. There is no `attendees`,
 * `conferenceData`, `recurrence`, `reminders` or `attachments` here, so an
 * event made by Besidka invites nobody.
 */
export function buildCalendarInsertPayload(
  body: CalendarInsertBody,
  eventId: string,
): Record<string, unknown> {
  return {
    id: eventId,
    summary: body.summary,
    ...(body.description !== undefined
      ? { description: body.description }
      : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    start: boundaryOf(body.start),
    end: boundaryOf(body.end),
  }
}

/**
 * `events.insert` on the owner's primary calendar, the one write of the
 * Calendar tools. `sendUpdates=none` is always sent, no query parameter that
 * would turn on video calls or attachments is, and the body comes from
 * `buildCalendarInsertPayload`. The body carries the id the caller derived
 * from the approved call, and a 409 (the id already exists) means an earlier
 * run of the same call created the event, so it is a success. This module
 * has no function for any other write: no update, no delete, no move, no
 * other calendar.
 */
export async function createCalendarEvent(
  body: CalendarInsertBody,
  eventId: string,
  context: CalendarRequestContext,
): Promise<CalendarResult<CreatedCalendarEvent>> {
  const encoded = JSON.stringify(buildCalendarInsertPayload(body, eventId))
  const result = await requestJson(
    `${PRIMARY_EVENTS_URL}?${queryOf([
      ['sendUpdates', NO_GUEST_NOTIFICATIONS],
      ['fields', INSERT_FIELDS],
    ])}`,
    {
      method: 'POST',
      headers: headersOf(context),
      rawBody: {
        contentType: 'application/json',
        data: new TextEncoder().encode(encoded) as Uint8Array<ArrayBuffer>,
      },
    },
    toFetchOptions(context, {}),
  )

  if (!result.ok && result.code === 'already_exists') {
    return {
      ok: true,
      value: {
        id: eventId,
        htmlLink: undefined,
        start: body.start.dateTime ?? body.start.date,
        alreadyExisted: true,
      },
    }
  }

  if (!result.ok) {
    return result
  }

  if (typeof result.value.id !== 'string') {
    return { ok: false, code: 'failed' }
  }

  return {
    ok: true,
    value: {
      id: result.value.id,
      htmlLink: result.value.htmlLink,
      start: isRecord(result.value.start)
        ? result.value.start.dateTime ?? result.value.start.date
        : undefined,
      alreadyExisted: false,
    },
  }
}
