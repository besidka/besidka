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
  + 'description,location,start,end,htmlLink,organizer(self,displayName,email),'
  + 'attendees(responseStatus),hangoutLink,conferenceData(entryPoints('
  + 'entryPointType)),attachments(fileId))'
const FREE_BUSY_FIELDS = 'calendars/*/busy,calendars/*/errors'
const INSERT_FIELDS = 'id,htmlLink,start,end'
const NO_GUEST_NOTIFICATIONS = 'none'

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
  failed: 'Google Calendar could not be reached or answered with an error. '
    + 'Try again in a moment.',
}

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

  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return 'api_disabled'
  }

  if (status === 404) {
    return 'not_found'
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
            readReason(response.body),
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
    return { ok: false, code: 'failed' }
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
}

function boundaryOf(boundary: CalendarEventDateTime): CalendarEventDateTime {
  return boundary.date !== undefined
    ? { date: boundary.date, timeZone: boundary.timeZone }
    : { dateTime: boundary.dateTime, timeZone: boundary.timeZone }
}

/**
 * The request body of an event, copied field by field from the validated
 * body: only a title, a description, a location, a start and an end can
 * ever be in it. There is no `attendees`, `conferenceData`, `recurrence`,
 * `reminders` or `attachments` here, so an event made by Besidka invites
 * nobody.
 */
export function buildCalendarInsertPayload(
  body: CalendarInsertBody,
): Record<string, unknown> {
  return {
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
 * Calendar tools. `sendUpdates=none` is always sent, no `conferenceDataVersion`
 * or `supportsAttachments` is, and the body comes from
 * `buildCalendarInsertPayload`. This module has no function for any other
 * write: no update, no delete, no move, no other calendar.
 */
export async function createCalendarEvent(
  body: CalendarInsertBody,
  context: CalendarRequestContext,
): Promise<CalendarResult<CreatedCalendarEvent>> {
  const encoded = JSON.stringify(buildCalendarInsertPayload(body))
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
    },
  }
}
