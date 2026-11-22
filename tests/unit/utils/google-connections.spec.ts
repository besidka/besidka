import { describe, expect, it } from 'vitest'
import {
  getGrantedCapabilities,
  getPartialCalendarAccess,
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
