import { describe, expect, it } from 'vitest'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { toGoogleConnectionSummary } from '~~/server/utils/google/store'

function record(status: string, grantedScopes: string[]) {
  return {
    clientMode: 'byo',
    status,
    googleEmail: 'owner@example.test',
    grantedScopes,
    createdAt: new Date('2026-11-22T12:00:00.000Z'),
  } as never
}

describe('toGoogleConnectionSummary', () => {
  it('says which Calendar permission is missing for an active connection '
    + 'with only one', () => {
    expect(toGoogleConnectionSummary(record('active', [
      GOOGLE_SCOPES.calendarEventsOwned,
    ]))).toMatchObject({ partialCalendar: 'events', capabilities: [] })
    expect(toGoogleConnectionSummary(record('active', [
      GOOGLE_SCOPES.calendarEventsFreebusy,
    ]))).toMatchObject({ partialCalendar: 'free-busy' })
  })

  it('says whether the account is a Workspace one, from its email domain',
    () => {
      const summaryFor = (googleEmail: string | null) => {
        return toGoogleConnectionSummary({
          ...(record('active', ['openid']) as object),
          googleEmail,
        } as never)
      }

      expect(summaryFor('owner@example.test').isWorkspaceAccount).toBe(true)
      expect(summaryFor('owner@gmail.com').isWorkspaceAccount).toBe(false)
      expect(summaryFor(null).isWorkspaceAccount).toBe(false)
    })

  it('leaves the field out with both permissions, with none and when the '
    + 'connection is not active', () => {
    for (const summary of [
      toGoogleConnectionSummary(record('active', [
        GOOGLE_SCOPES.calendarEventsOwned,
        GOOGLE_SCOPES.calendarEventsFreebusy,
      ])),
      toGoogleConnectionSummary(record('active', ['openid'])),
      toGoogleConnectionSummary(record('needs_reauth', [
        GOOGLE_SCOPES.calendarEventsOwned,
      ])),
    ]) {
      expect(Object.keys(summary)).not.toContain('partialCalendar')
    }
  })
})
