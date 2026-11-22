import { describe, expect, it } from 'vitest'
import {
  buildCalendarEventId,
  classifyCalendarFailure,
  readCalendarReason,
} from '~~/server/utils/google/calendar-api'
import { GOOGLE_CALENDAR_CLIENT_EVENT_ID_SHAPE } from '#shared/utils/google-calendar-tools'

describe('buildCalendarEventId', () => {
  it('uses only base32hex characters and is 52 long, inside Google\'s '
    + 'rule of 5 to 1024 characters of a to v and 0 to 9', async () => {
    for (const seed of ['1:call-1', '2:toolu_01ABC', '3:call_ÿ💥', '']) {
      const eventId = await buildCalendarEventId(seed)

      expect(eventId).toMatch(/^[a-v0-9]{52}$/)
      expect(GOOGLE_CALENDAR_CLIENT_EVENT_ID_SHAPE.test(eventId)).toBe(true)
    }
  })

  it('is the same for the same seed and different for another', async () => {
    expect(await buildCalendarEventId('1:call-1'))
      .toBe(await buildCalendarEventId('1:call-1'))
    expect(await buildCalendarEventId('1:call-1'))
      .not.toBe(await buildCalendarEventId('1:call-2'))
    expect(await buildCalendarEventId('1:call-1'))
      .not.toBe(await buildCalendarEventId('2:call-1'))
  })

  it('is random, and still valid, without a seed', async () => {
    const first = await buildCalendarEventId()
    const second = await buildCalendarEventId()

    expect(first).toMatch(GOOGLE_CALENDAR_CLIENT_EVENT_ID_SHAPE)
    expect(second).toMatch(GOOGLE_CALENDAR_CLIENT_EVENT_ID_SHAPE)
    expect(first).not.toBe(second)
  })
})

describe('classifyCalendarFailure', () => {
  it.each([
    [401, null, 'reauthorize'],
    [403, 'accessNotConfigured', 'api_disabled'],
    [403, 'SERVICE_DISABLED', 'api_disabled'],
    [403, 'rateLimitExceeded', 'rate_limited'],
    [403, 'userRateLimitExceeded', 'rate_limited'],
    [403, 'quotaExceeded', 'rate_limited'],
    [403, 'forbidden', 'no_access'],
    [404, null, 'not_found'],
    [409, 'duplicate', 'already_exists'],
    [429, null, 'rate_limited'],
    [400, null, 'bad_request'],
    [500, null, 'failed'],
  ] as const)('maps %i %s to %s', (status, reason, expected) => {
    expect(classifyCalendarFailure(status, reason)).toBe(expected)
  })
})

describe('readCalendarReason', () => {
  it('reads the reason of the errors list', () => {
    expect(readCalendarReason({
      error: { errors: [{ reason: 'rateLimitExceeded' }] },
    })).toBe('rateLimitExceeded')
  })

  it('reaches SERVICE_DISABLED in the details, which the errors list lacks',
    () => {
      expect(readCalendarReason({
        error: {
          code: 403,
          details: [{
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            'reason': 'SERVICE_DISABLED',
          }],
        },
      })).toBe('SERVICE_DISABLED')
      expect(classifyCalendarFailure(403, readCalendarReason({
        error: { details: [{ reason: 'SERVICE_DISABLED' }] },
      }))).toBe('api_disabled')
    })

  it.each([
    null,
    {},
    { error: 'text' },
    { error: { details: 'text' } },
    { error: { details: [null, 5, { reason: 'other' }] } },
  ])('is null for %j', (body) => {
    expect(readCalendarReason(body as Record<string, unknown> | null))
      .toBeNull()
  })
})
