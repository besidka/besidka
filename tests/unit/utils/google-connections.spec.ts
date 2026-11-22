import { describe, expect, it } from 'vitest'
import {
  getGrantedCapabilities,
  getPartialCalendarAccess,
  isWorkspaceAccountEmail,
} from '#shared/utils/google-connections'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'

describe('getPartialCalendarAccess', () => {
  it('is null with both Calendar permissions and with neither', () => {
    expect(getPartialCalendarAccess([
      'openid',
      GOOGLE_SCOPES.calendarEventsOwned,
      GOOGLE_SCOPES.calendarEventsFreebusy,
    ])).toBeNull()
    expect(getPartialCalendarAccess(['openid', GOOGLE_SCOPES.driveReadonly]))
      .toBeNull()
  })

  it('names the one permission that was granted', () => {
    expect(getPartialCalendarAccess([GOOGLE_SCOPES.calendarEventsOwned]))
      .toBe('events')
    expect(getPartialCalendarAccess([GOOGLE_SCOPES.calendarEventsFreebusy]))
      .toBe('free-busy')
  })

  it('never counts the old broad Calendar scope', () => {
    expect(getPartialCalendarAccess([
      'https://www.googleapis.com/auth/calendar.events',
    ])).toBeNull()
  })

  it('leaves the calendar capability off while only one is granted', () => {
    expect(getGrantedCapabilities([GOOGLE_SCOPES.calendarEventsOwned]))
      .not.toContain('calendar')
  })
})

describe('isWorkspaceAccountEmail', () => {
  it('treats gmail.com and googlemail.com as personal, in any case', () => {
    for (const email of [
      'person@gmail.com',
      'Person@GMail.com',
      'person@googlemail.com',
    ]) {
      expect(isWorkspaceAccountEmail(email)).toBe(false)
    }
  })

  it('treats any other domain as Workspace', () => {
    expect(isWorkspaceAccountEmail('person@example.test')).toBe(true)
    expect(isWorkspaceAccountEmail('person@mail.gmail.com.example')).toBe(true)
  })

  it('does not treat a missing or malformed email as Workspace', () => {
    for (const email of [null, '', 'no-at-sign', '@example.test', 'a@', 'a@ ']) {
      expect(isWorkspaceAccountEmail(email)).toBe(false)
    }
  })
})
