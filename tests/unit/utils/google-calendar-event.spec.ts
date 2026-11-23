import { describe, expect, it } from 'vitest'
import {
  buildCalendarDayLink,
  buildCalendarEventLink,
  describeCalendarWindow,
  getCalendarDayBefore,
  getTimeZoneOffsetMinutes,
  isKnownTimeZone,
  readCalendarDay,
  readCalendarEventApprovalView,
  readCalendarInstantMilliseconds,
  readCalendarResponseTime,
  validateCalendarEvent,
  validateCalendarWindow,
} from '#shared/utils/google-calendar-event'

const TIMED = {
  title: 'Planning',
  start: '2026-12-01T10:00:00+01:00',
  end: '2026-12-01T11:00:00+01:00',
  timeZone: 'Europe/Berlin',
}

function refusalOf(input: unknown): string {
  const result = validateCalendarEvent(input)

  if (result.ok) {
    throw new Error('Expected a refusal')
  }

  return result.message
}

describe('isKnownTimeZone', () => {
  it.each([
    'UTC',
    'Europe/Berlin',
    'America/New_York',
    'Asia/Kolkata',
    'America/Argentina/Buenos_Aires',
    'Europe/Kyiv',
    'Europe/Kiev',
    'Etc/GMT+1',
  ])('accepts %s', (zone) => {
    expect(isKnownTimeZone(zone)).toBe(true)
  })

  it.each([
    '',
    'Mars/Phobos',
    'europe/berlin',
    'Europe/berlin',
    'EUROPE/BERLIN',
    'Europe/BERLIN',
    'asia/kolkata',
    'ASIA/KOLKATA',
    'utc',
    '+02:00',
    'GMT+2',
    'Europe/Berlin ',
    'Europe/../Berlin',
    'x'.repeat(80),
    42,
    null,
  ])('refuses %s', (zone) => {
    expect(isKnownTimeZone(zone)).toBe(false)
  })
})

describe('getTimeZoneOffsetMinutes', () => {
  it('follows the daylight saving rules of the runtime', () => {
    const winter = Date.UTC(2026, 0, 15, 12)
    const summer = Date.UTC(2026, 6, 15, 12)

    expect(getTimeZoneOffsetMinutes('Europe/Berlin', winter)).toBe(60)
    expect(getTimeZoneOffsetMinutes('Europe/Berlin', summer)).toBe(120)
    expect(getTimeZoneOffsetMinutes('America/New_York', winter)).toBe(-300)
    expect(getTimeZoneOffsetMinutes('America/New_York', summer)).toBe(-240)
    expect(getTimeZoneOffsetMinutes('UTC', summer)).toBe(0)
    expect(getTimeZoneOffsetMinutes('Asia/Kolkata', summer)).toBe(330)
  })
})

describe('validateCalendarEvent: timed events', () => {
  it('builds the request body from a valid event', () => {
    expect(validateCalendarEvent({
      ...TIMED,
      description: 'Agenda',
      location: 'Room 4',
    })).toEqual({
      ok: true,
      body: {
        summary: 'Planning',
        description: 'Agenda',
        location: 'Room 4',
        start: { dateTime: TIMED.start, timeZone: 'Europe/Berlin' },
        end: { dateTime: TIMED.end, timeZone: 'Europe/Berlin' },
      },
    })
  })

  it('leaves out an empty description and location', () => {
    const result = validateCalendarEvent({
      ...TIMED,
      description: '',
      location: '',
    })

    expect(result.ok && Object.keys(result.body).sort())
      .toEqual(['end', 'start', 'summary'])
  })

  it('accepts a time that spans the spring forward change', () => {
    expect(validateCalendarEvent({
      title: 'Overnight',
      start: '2026-03-28T23:00:00+01:00',
      end: '2026-03-29T05:00:00+02:00',
      timeZone: 'Europe/Berlin',
    }).ok).toBe(true)
  })

  it('refuses a stale offset after the spring forward change', () => {
    const message = refusalOf({
      title: 'Brunch',
      start: '2026-03-29T10:00:00+01:00',
      end: '2026-03-29T11:00:00+01:00',
      timeZone: 'Europe/Berlin',
    })

    expect(message).toContain('+02:00')
    expect(message).toContain('Europe/Berlin')
  })

  it.each([
    ['+01:00', '2026-03-29T02:30:00+01:00'],
    ['+02:00', '2026-03-29T02:30:00+02:00'],
  ])('refuses a time inside the spring gap with offset %s',
    (_offset, start) => {
      refusalOf({
        title: 'Gap',
        start,
        end: '2026-03-29T04:30:00+02:00',
        timeZone: 'Europe/Berlin',
      })
    })

  it('accepts both occurrences of a time after the fall back change', () => {
    const result = validateCalendarEvent({
      title: 'Twice',
      start: '2026-10-25T02:30:00+02:00',
      end: '2026-10-25T02:30:00+01:00',
      timeZone: 'Europe/Berlin',
    })

    expect(result.ok).toBe(true)
  })

  it('refuses the first offset after the fall back change on the wrong side',
    () => {
      refusalOf({
        title: 'Wrong',
        start: '2026-10-25T04:00:00+02:00',
        end: '2026-10-25T05:00:00+02:00',
        timeZone: 'Europe/Berlin',
      })
    })

  it('applies the same rules in a zone west of UTC', () => {
    expect(validateCalendarEvent({
      title: 'Standup',
      start: '2026-03-08T09:00:00-04:00',
      end: '2026-03-08T09:30:00-04:00',
      timeZone: 'America/New_York',
    }).ok).toBe(true)

    refusalOf({
      title: 'Stale',
      start: '2026-03-08T09:00:00-05:00',
      end: '2026-03-08T09:30:00-05:00',
      timeZone: 'America/New_York',
    })
    refusalOf({
      title: 'Gap',
      start: '2026-03-08T02:30:00-05:00',
      end: '2026-03-08T03:30:00-04:00',
      timeZone: 'America/New_York',
    })
  })

  it('accepts a Z offset only for UTC', () => {
    expect(validateCalendarEvent({
      title: 'Utc',
      start: '2026-12-01T10:00:00Z',
      end: '2026-12-01T11:00:00Z',
      timeZone: 'UTC',
    }).ok).toBe(true)

    refusalOf({ ...TIMED, start: '2026-12-01T10:00:00Z' })
  })

  it('refuses an end before the start and an empty event', () => {
    expect(refusalOf({ ...TIMED, end: '2026-12-01T09:00:00+01:00' }))
      .toContain('after the start')
    expect(refusalOf({ ...TIMED, end: TIMED.start })).toContain('after')
  })

  it('compares the end and the start as instants, not as text', () => {
    expect(validateCalendarEvent({
      title: 'Across offsets',
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T09:30:00Z',
      timeZone: 'UTC',
    }).ok).toBe(false)
    expect(validateCalendarEvent({
      title: 'Across offsets',
      start: '2026-12-01T09:00:00Z',
      end: '2026-12-01T10:30:00+01:00',
      timeZone: 'UTC',
    }).ok).toBe(false)
  })

  it.each([
    '2026-12-01 10:00:00+01:00',
    '2026-12-01T10:00+01:00',
    '2026-12-01T10:00:00',
    '2026-12-01T10:00:00+0100',
    '2026-12-01t10:00:00+01:00',
    '2026-12-01T10:00:00.500+01:00',
    '2026-02-30T10:00:00+01:00',
    '2026-13-01T10:00:00+01:00',
    '2026-12-01T24:00:00+01:00',
    '2026-12-01T10:60:00+01:00',
    '2026-12-01T10:00:60+01:00',
    '2026-12-01T10:00:00+24:00',
    '2026-12-01T10:00:00+01:60',
    '0099-12-01T10:00:00+01:00',
    ' 2026-12-01T10:00:00+01:00',
  ])('refuses the start %s', (start) => {
    refusalOf({ ...TIMED, start })
  })

  it('refuses mixed date and date-time forms', () => {
    refusalOf({ ...TIMED, start: '2026-12-01' })
    refusalOf({ ...TIMED, end: '2026-12-02' })
  })

  it.each([
    'Mars/Phobos',
    'europe/berlin',
    '+01:00',
    '',
  ])('refuses the time zone %s', (timeZone) => {
    expect(refusalOf({ ...TIMED, timeZone })).toContain('timeZone')
  })
})

describe('validateCalendarEvent: all-day events', () => {
  const ALL_DAY = {
    title: 'Holiday',
    start: '2026-12-24',
    end: '2026-12-26',
    timeZone: 'Europe/Berlin',
  }

  it('sends dates and keeps the time zone', () => {
    expect(validateCalendarEvent(ALL_DAY)).toEqual({
      ok: true,
      body: {
        summary: 'Holiday',
        start: { date: '2026-12-24', timeZone: 'Europe/Berlin' },
        end: { date: '2026-12-26', timeZone: 'Europe/Berlin' },
      },
    })
  })

  it('treats the end date as exclusive', () => {
    expect(refusalOf({ ...ALL_DAY, end: '2026-12-24' })).toContain('exclusive')
    refusalOf({ ...ALL_DAY, end: '2026-12-23' })
    expect(validateCalendarEvent({ ...ALL_DAY, end: '2026-12-25' }).ok)
      .toBe(true)
  })

  it('works across the daylight saving change day', () => {
    expect(validateCalendarEvent({
      title: 'Change day',
      start: '2026-03-29',
      end: '2026-03-30',
      timeZone: 'Europe/Berlin',
    }).ok).toBe(true)
  })

  it.each([
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-12-32',
    '2026-1-1',
    '20261201',
  ])('refuses the date %s', (start) => {
    refusalOf({ ...ALL_DAY, start })
  })

  it('accepts a leap day only in a leap year', () => {
    expect(validateCalendarEvent({
      ...ALL_DAY,
      start: '2028-02-29',
      end: '2028-03-01',
    }).ok).toBe(true)
  })
})

describe('validateCalendarEvent: text', () => {
  it.each([
    ['an empty title', ''],
    ['a padded title', ' Planning'],
    ['a trailing space', 'Planning '],
    ['a line break', 'Planning\nBudget'],
    ['a tab', 'Plan\tning'],
    ['a zero width space', 'Plan​ning'],
    ['a right to left override', 'Plan‮ning'],
    ['a lone surrogate', 'Plan\uD800ning'],
    ['a line separator', 'Plan ning'],
    ['201 characters', 'x'.repeat(201)],
  ])('refuses a title with %s', (_name, title) => {
    refusalOf({ ...TIMED, title })
  })

  it('accepts a title at the limit and with an emoji', () => {
    expect(validateCalendarEvent({ ...TIMED, title: 'x'.repeat(200) }).ok)
      .toBe(true)
    expect(validateCalendarEvent({ ...TIMED, title: 'Party 🎉' }).ok)
      .toBe(true)
    expect(validateCalendarEvent({ ...TIMED, title: 'Зустріч' }).ok)
      .toBe(true)
  })

  it('allows line breaks in a description and refuses unsafe characters', () => {
    expect(validateCalendarEvent({
      ...TIMED,
      description: 'one\ntwo\r\nthree\tfour',
    }).ok).toBe(true)
    refusalOf({ ...TIMED, description: 'a​b' })
    refusalOf({ ...TIMED, description: 'a\rb' })
    refusalOf({ ...TIMED, description: 'a\u0000b' })
    refusalOf({ ...TIMED, description: 'x'.repeat(4001) })
    expect(validateCalendarEvent({
      ...TIMED,
      description: 'x'.repeat(4000),
    }).ok).toBe(true)
  })

  it.each([
    ['a link', '<a href="https://example.test">x</a>'],
    ['a tag', '<b>bold</b>'],
    ['a closing tag', 'text</p>'],
    ['a comment', '<!-- note -->'],
    ['a processing instruction', '<?php x ?>'],
    ['a tag on a later line', 'line one\n<img src=x>'],
    ['an upper case tag', '<SCRIPT>x</SCRIPT>'],
  ])('refuses a description with %s and never repairs it', (_name, text) => {
    expect(refusalOf({ ...TIMED, description: text }))
      .toContain('plain text')
    expect(readCalendarEventApprovalView({ ...TIMED, description: text }))
      .toBeNull()
  })

  it.each([
    'a < b and 3 < 4',
    'I <3 this',
    'price <10',
    'a<\nb',
    'x &lt;b&gt; y',
    'a > b',
  ])('keeps a description with a lone "<" that opens no markup: %s', (text) => {
    expect(validateCalendarEvent({ ...TIMED, description: text }).ok)
      .toBe(true)
  })

  it('refuses a location with a line break, padding or over 300 characters',
    () => {
      refusalOf({ ...TIMED, location: 'Room\n4' })
      refusalOf({ ...TIMED, location: ' Room 4' })
      refusalOf({ ...TIMED, location: 'x'.repeat(301) })
      expect(validateCalendarEvent({
        ...TIMED,
        location: 'x'.repeat(300),
      }).ok).toBe(true)
    })

  it.each([
    null,
    'text',
    {},
    { title: 'x' },
    { ...TIMED, title: 5 },
    { ...TIMED, start: 5 },
  ])('refuses a value that is not an event: %j', (value) => {
    refusalOf(value)
  })
})

describe('the request body', () => {
  it('has only the whitelisted keys and never an attendee', () => {
    const hostile = {
      ...TIMED,
      description: 'Agenda',
      attendees: [{ email: 'mallory@evil.example' }],
      conferenceData: { createRequest: { requestId: 'x' } },
      recurrence: ['RRULE:FREQ=DAILY'],
      reminders: { useDefault: false },
      attachments: [{ fileUrl: 'https://evil.example' }],
      guestsCanInviteOthers: true,
      sendUpdates: 'all',
      organizer: { email: 'mallory@evil.example' },
    }
    const result = validateCalendarEvent(hostile)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(Object.keys(result.body).sort()).toEqual([
      'description',
      'end',
      'start',
      'summary',
    ])
    expect(Object.keys(result.body.start).sort()).toEqual([
      'dateTime',
      'timeZone',
    ])
    expect(JSON.stringify(result.body)).not.toMatch(
      /attendees|conferenceData|recurrence|reminders|attachments|guests|sendUpdates|organizer|mallory/,
    )
  })
})

describe('readCalendarEventApprovalView', () => {
  it('shows exactly the fields of the request body', () => {
    const input = {
      ...TIMED,
      description: 'Agenda\nItem 2',
      location: 'Room 4',
    }
    const view = readCalendarEventApprovalView(input)
    const validation = validateCalendarEvent(input)

    expect(validation.ok).toBe(true)

    if (!validation.ok) {
      return
    }

    expect(view).toMatchObject({
      title: validation.body.summary,
      isAllDay: false,
      start: validation.body.start.dateTime,
      end: validation.body.end.dateTime,
      lastDay: null,
      timeZone: validation.body.start.timeZone,
      description: validation.body.description,
      cardDescription: 'Agenda\nItem 2',
      descriptionLineCount: 2,
      location: validation.body.location,
    })
  })

  it('names the last day of an all-day event', () => {
    expect(readCalendarEventApprovalView({
      title: 'Holiday',
      start: '2026-12-24',
      end: '2026-12-26',
      timeZone: 'Europe/Berlin',
    })).toMatchObject({
      isAllDay: true,
      start: '2026-12-24',
      end: '2026-12-26',
      lastDay: '2026-12-25',
    })
  })

  it('finds the last day across a month and a year', () => {
    expect(readCalendarEventApprovalView({
      title: 'New year',
      start: '2026-12-31',
      end: '2027-01-01',
      timeZone: 'UTC',
    })?.lastDay).toBe('2026-12-31')
    expect(readCalendarEventApprovalView({
      title: 'Leap',
      start: '2028-02-28',
      end: '2028-03-01',
      timeZone: 'UTC',
    })?.lastDay).toBe('2028-02-29')
  })

  it('collapses long runs of blank lines on the card only', () => {
    const description = `top${'\n'.repeat(8)}bottom`
    const view = readCalendarEventApprovalView({ ...TIMED, description })

    expect(view?.description).toBe(description)
    expect(view?.cardDescription).toContain('[7 blank lines]')
    expect(view?.cardDescription).toContain('bottom')
    expect(view?.descriptionLineCount).toBe(9)
  })

  it('does not depend on the runtime\'s time zone data, which the server '
    + 'already checked', () => {
    const input = {
      title: 'Planning',
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T11:00:00+01:00',
      timeZone: 'Atlantis/Lost_City',
    }

    expect(validateCalendarEvent(input).ok).toBe(false)
    expect(readCalendarEventApprovalView(input)).toMatchObject({
      title: 'Planning',
      start: '2026-12-01T10:00:00+01:00',
      timeZone: 'Atlantis/Lost_City',
    })
    expect(readCalendarEventApprovalView({
      ...input,
      start: '2026-03-29T10:00:00+01:00',
      end: '2026-03-29T11:00:00+01:00',
      timeZone: 'Europe/Berlin',
    })).not.toBeNull()
  })

  it('still refuses what needs no time zone data', () => {
    const base = {
      title: 'Planning',
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T11:00:00+01:00',
      timeZone: 'Europe/Berlin',
    }

    for (const input of [
      { ...base, end: base.start },
      { ...base, start: '2026-02-30T10:00:00+01:00' },
      { ...base, timeZone: '+01:00' },
      { ...base, title: 'a\nb' },
      { ...base, start: '2026-12-01' },
    ]) {
      expect(readCalendarEventApprovalView(input)).toBeNull()
    }
  })

  it('is null for an input that cannot run', () => {
    expect(readCalendarEventApprovalView({ ...TIMED, end: TIMED.start }))
      .toBeNull()
    expect(readCalendarEventApprovalView('text')).toBeNull()
    expect(readCalendarEventApprovalView(null)).toBeNull()
  })
})

describe('validateCalendarWindow', () => {
  it('accepts a window of up to 31 days', () => {
    expect(validateCalendarWindow(
      '2026-12-01T00:00:00+01:00',
      '2027-01-01T00:00:00+01:00',
    )).toEqual({
      ok: true,
      timeMin: '2026-12-01T00:00:00+01:00',
      timeMax: '2027-01-01T00:00:00+01:00',
    })
  })

  it('refuses a window over 31 days and one hour by one second', () => {
    expect(validateCalendarWindow(
      '2026-12-01T00:00:00Z',
      '2027-01-01T01:00:00Z',
    )).toMatchObject({ ok: true })
    expect(validateCalendarWindow(
      '2026-12-01T00:00:00Z',
      '2027-01-01T01:00:01Z',
    )).toMatchObject({ ok: false })
  })

  it('refuses exactly 31 days and 61 minutes', () => {
    expect(validateCalendarWindow(
      '2026-12-01T00:00:00Z',
      '2027-01-01T01:01:00Z',
    )).toMatchObject({ ok: false })
  })

  it.each([
    ['October in Europe/Warsaw', '2026-10-01T00:00:00+02:00',
      '2026-11-01T00:00:00+01:00'],
    ['March in Europe/Warsaw', '2026-03-01T00:00:00+01:00',
      '2026-04-01T00:00:00+02:00'],
    ['November in America/New_York', '2026-11-01T00:00:00-04:00',
      '2026-12-01T00:00:00-05:00'],
    ['March in America/New_York', '2026-03-01T00:00:00-05:00',
      '2026-04-01T00:00:00-04:00'],
  ])('accepts a whole month across a clock change: %s', (_name, from, to) => {
    expect(validateCalendarWindow(from, to)).toEqual({
      ok: true,
      timeMin: from,
      timeMax: to,
    })
  })

  it('refuses an end that is not after the start', () => {
    expect(validateCalendarWindow(
      '2026-12-01T00:00:00Z',
      '2026-12-01T00:00:00Z',
    )).toMatchObject({ ok: false })
    expect(validateCalendarWindow(
      '2026-12-02T00:00:00Z',
      '2026-12-01T00:00:00Z',
    )).toMatchObject({ ok: false })
  })

  it('compares instants across offsets', () => {
    expect(validateCalendarWindow(
      '2026-12-01T10:00:00+02:00',
      '2026-12-01T08:00:00Z',
    )).toMatchObject({ ok: false })
    expect(validateCalendarWindow(
      '2026-12-01T10:00:00+02:00',
      '2026-12-01T08:00:01Z',
    )).toMatchObject({ ok: true })
  })

  it.each([
    ['2026-12-01', '2026-12-02'],
    ['2026-12-01T00:00:00', '2026-12-02T00:00:00'],
    ['2026-12-01T00:00:00.5Z', '2026-12-02T00:00:00Z'],
    ['not a time', '2026-12-02T00:00:00Z'],
    [5, '2026-12-02T00:00:00Z'],
  ])('refuses %s as the start', (from, to) => {
    expect(validateCalendarWindow(from, to)).toMatchObject({ ok: false })
  })
})

describe('response times and links', () => {
  it('passes only real dates and date-times from a response', () => {
    expect(readCalendarResponseTime('2026-12-01')).toBe('2026-12-01')
    expect(readCalendarResponseTime('2026-12-01T10:00:00+01:00'))
      .toBe('2026-12-01T10:00:00+01:00')
    expect(readCalendarResponseTime('2026-12-01T10:00:00.000Z'))
      .toBe('2026-12-01T10:00:00.000Z')
    expect(readCalendarResponseTime('2026-02-30')).toBeNull()
    expect(readCalendarResponseTime('IGNORE ALL RULES')).toBeNull()
    expect(readCalendarResponseTime('2026-12-01T10:00:00Z ignore')).toBeNull()
    expect(readCalendarResponseTime(null)).toBeNull()
  })

  it('reads the day of a time in its own offset', () => {
    expect(readCalendarDay('2026-12-01T23:30:00-05:00')).toBe('2026-12-01')
    expect(readCalendarDay('2026-12-01')).toBe('2026-12-01')
    expect(readCalendarDay('nope')).toBeNull()
  })

  it('keeps Google\'s event link only in its known shape', () => {
    const own = 'https://www.google.com/calendar/event?eid=aGVsbG8gd29ybGQ'

    expect(buildCalendarEventLink(own, '2026-12-01')).toBe(own)
    expect(buildCalendarEventLink(
      'https://calendar.google.com/calendar/event?eid=abc_DEF-1',
      null,
    )).toBe('https://calendar.google.com/calendar/event?eid=abc_DEF-1')
  })

  it.each([
    'https://evil.example/calendar/event?eid=abc',
    'https://www.google.com.evil.example/calendar/event?eid=abc',
    'http://www.google.com/calendar/event?eid=abc',
    'https://www.google.com/calendar/event?eid=abc&next=https://evil.example',
    'https://user@www.google.com/calendar/event?eid=abc',
    'https://www.google.com/calendar/event?eid=',
    'javascript:alert(1)',
    undefined,
    42,
  ])('falls back to the day link for %s', (htmlLink) => {
    expect(buildCalendarEventLink(htmlLink, '2026-12-01'))
      .toBe('https://calendar.google.com/calendar/r/day/2026/12/1')
  })

  it('links to Google Calendar itself without a day', () => {
    expect(buildCalendarEventLink('bad', null))
      .toBe('https://calendar.google.com/calendar/')
    expect(buildCalendarDayLink('2026-02-30'))
      .toBe('https://calendar.google.com/calendar/')
  })
})

describe('readCalendarInstantMilliseconds', () => {
  it('reads a date-time as an instant and nothing else', () => {
    expect(readCalendarInstantMilliseconds('2026-12-01T10:00:00+01:00'))
      .toBe(Date.parse('2026-12-01T09:00:00Z'))
    expect(readCalendarInstantMilliseconds('2026-12-01T09:00:00Z'))
      .toBe(Date.parse('2026-12-01T09:00:00Z'))
    expect(readCalendarInstantMilliseconds('2026-12-01')).toBeNull()
    expect(readCalendarInstantMilliseconds('IGNORE ALL RULES')).toBeNull()
    expect(readCalendarInstantMilliseconds(5)).toBeNull()
  })
})

describe('getCalendarDayBefore', () => {
  it.each([
    ['2026-12-26', '2026-12-25'],
    ['2027-01-01', '2026-12-31'],
    ['2028-03-01', '2028-02-29'],
  ])('is the day before %s', (day, expected) => {
    expect(getCalendarDayBefore(day)).toBe(expected)
  })

  it('is null for a value that is not a date', () => {
    expect(getCalendarDayBefore('2026-02-30')).toBeNull()
    expect(getCalendarDayBefore('2026-12-01T00:00:00Z')).toBeNull()
  })
})

describe('describeCalendarWindow', () => {
  it('names a whole-day window by its first and last day', () => {
    expect(describeCalendarWindow(
      '2026-12-01T00:00:00+01:00',
      '2026-12-08T00:00:00+01:00',
    )).toBe('from Dec 1, 2026 to Dec 7, 2026')
  })

  it('shows the times when they are not midnight', () => {
    expect(describeCalendarWindow(
      '2026-12-01T10:00:00+01:00',
      '2026-12-01T18:30:00+01:00',
    )).toBe('from Dec 1, 2026, 10:00 to Dec 1, 2026, 18:30')
    expect(describeCalendarWindow(
      '2026-12-01T00:00:00+01:00',
      '2026-12-07T12:00:00+01:00',
    )).toBe('from Dec 1, 2026, 00:00 to Dec 7, 2026, 12:00')
  })

  it('is null for a window that is not valid', () => {
    expect(describeCalendarWindow('2026-12-01', '2026-12-02')).toBeNull()
    expect(describeCalendarWindow(undefined, null)).toBeNull()
  })
})

describe('the human labels of the approval view', () => {
  it('writes a timed event with weekday, date, time, offset and length', () => {
    expect(readCalendarEventApprovalView(TIMED)).toMatchObject({
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T11:00:00+01:00',
      startLabel: 'Tue, Dec 1, 2026, 10:00 (UTC+01:00)',
      endLabel: 'Tue, Dec 1, 2026, 11:00 (UTC+01:00)',
      lastDayLabel: null,
      durationLabel: '1 hour',
    })
  })

  it.each([
    ['2026-12-01T10:00:00+01:00', '2026-12-01T10:45:00+01:00', '45 minutes'],
    ['2026-12-01T10:00:00+01:00', '2026-12-01T11:30:00+01:00',
      '1 hour 30 minutes'],
    ['2026-12-01T10:00:00+01:00', '2026-12-03T12:01:00+01:00',
      '2 days 2 hours 1 minute'],
  ])('writes the length from %s to %s as %s', (start, end, expected) => {
    expect(readCalendarEventApprovalView({
      ...TIMED,
      start,
      end,
    })?.durationLabel).toBe(expected)
  })

  it('writes the offset of a UTC time as UTC', () => {
    expect(readCalendarEventApprovalView({
      title: 'Call',
      start: '2026-12-01T09:00:00Z',
      end: '2026-12-01T09:30:00Z',
      timeZone: 'UTC',
    })?.startLabel).toBe('Tue, Dec 1, 2026, 09:00 (UTC)')
  })

  it('writes an all-day event as dates with its last day', () => {
    expect(readCalendarEventApprovalView({
      title: 'Holiday',
      start: '2026-12-24',
      end: '2026-12-26',
      timeZone: 'Europe/Berlin',
    })).toMatchObject({
      start: '2026-12-24',
      end: '2026-12-26',
      startLabel: 'Thu, Dec 24, 2026',
      endLabel: 'Sat, Dec 26, 2026',
      lastDayLabel: 'Fri, Dec 25, 2026',
      durationLabel: '2 days',
    })
    expect(readCalendarEventApprovalView({
      title: 'Day',
      start: '2026-12-24',
      end: '2026-12-25',
      timeZone: 'UTC',
    })?.durationLabel).toBe('1 day')
  })

  it('counts the real length across a clock change', () => {
    expect(readCalendarEventApprovalView({
      title: 'Night',
      start: '2026-03-28T23:00:00+01:00',
      end: '2026-03-29T04:00:00+02:00',
      timeZone: 'Europe/Berlin',
    })?.durationLabel).toBe('4 hours')
  })
})
