import { describe, expect, it } from 'vitest'
import { GOOGLE_BYO_CAPABILITIES } from '#shared/utils/google-byo'
import {
  GOOGLE_BYO_GUIDE_APIS,
  GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES,
  GOOGLE_BYO_GUIDE_SUMMARY,
  GOOGLE_CLOUD_CONSOLE_LINKS,
  getGoogleByoGuideScopeGroups,
} from '#shared/utils/google-byo-guide'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { GOOGLE_CONNECTION_SCOPES } from '~~/server/utils/google/client'

describe('google-byo-guide', () => {
  it('lists the sign-in scopes the own client always asks for', () => {
    expect([...GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES].sort())
      .toEqual([...GOOGLE_CONNECTION_SCOPES.byo].sort())
    expect(GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES)
      .not.toContain(GOOGLE_SCOPES.profile)
  })

  it('has one scope group for each capability the card offers', () => {
    const groups = getGoogleByoGuideScopeGroups()

    expect(groups.map(group => group.capability))
      .toEqual([...GOOGLE_BYO_CAPABILITIES])

    for (const group of groups) {
      expect(group.label.length).toBeGreaterThan(0)
      expect(group.scopes.length).toBeGreaterThan(0)
    }
  })

  it('names exactly the scopes the own client can request', () => {
    const listed = getGoogleByoGuideScopeGroups()
      .flatMap(group => group.scopes)

    expect(listed.sort()).toEqual([
      GOOGLE_SCOPES.calendarEventsFreebusy,
      GOOGLE_SCOPES.calendarEventsOwned,
      GOOGLE_SCOPES.drive,
      GOOGLE_SCOPES.driveReadonly,
      GOOGLE_SCOPES.gmailCompose,
      GOOGLE_SCOPES.gmailReadonly,
    ].sort())
    expect(listed).not.toContain(GOOGLE_SCOPES.driveFile)
    expect(listed).not.toContain(GOOGLE_SCOPES.profile)
  })

  it('gives both Calendar scopes to the one Calendar group', () => {
    const calendar = getGoogleByoGuideScopeGroups()
      .find(group => group.capability === 'calendar')

    expect(calendar?.scopes.sort()).toEqual([
      GOOGLE_SCOPES.calendarEventsFreebusy,
      GOOGLE_SCOPES.calendarEventsOwned,
    ].sort())
  })

  it('names an API for every capability', () => {
    const covered = GOOGLE_BYO_GUIDE_APIS
      .flatMap(api => [...api.capabilities])

    expect(covered.sort()).toEqual([...GOOGLE_BYO_CAPABILITIES].sort())
  })

  it('links only to Google Cloud console pages over https', () => {
    const urls = [
      ...Object.values(GOOGLE_CLOUD_CONSOLE_LINKS).map(link => link.url),
      ...GOOGLE_BYO_GUIDE_APIS.map(api => api.url),
    ]

    for (const url of urls) {
      expect(new URL(url).origin).toBe('https://console.cloud.google.com')
    }
  })

  it('has the summary line', () => {
    expect(GOOGLE_BYO_GUIDE_SUMMARY).toBe('How to set up your own Google client')
  })
})
