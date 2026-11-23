import { describe, expect, it } from 'vitest'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'
import {
  GOOGLE_BYO_DISCONNECT_SERVICES,
  getGoogleByoRequestedCapabilities,
  resolveGoogleEntries,
} from '../../../app/utils/google-entries'
import type { GoogleEntriesInput } from '../../../app/utils/google-entries'

function connection(
  patch: Partial<GoogleConnectionSummary> = {},
): GoogleConnectionSummary {
  return {
    clientMode: 'besidka',
    status: 'active',
    email: 'person@example.test',
    isWorkspaceAccount: false,
    capabilities: ['identity', 'drive-picked'],
    connectedAt: '2026-11-22T12:00:00.000Z',
    ...patch,
  }
}

function byo(
  patch: Partial<GoogleByoConnectionStatus> = {},
): GoogleByoConnectionStatus {
  return {
    canManage: true,
    redirectUri: 'https://besidka.example/api/v1/google/byo/callback',
    hasClient: true,
    connection: null,
    ...patch,
  }
}

function input(
  patch: Partial<GoogleEntriesInput> = {},
  status: Partial<GoogleConnectionStatusResponse> = {},
): GoogleEntriesInput {
  return {
    status: {
      connection: null,
      canConnect: true,
      dedicatedClient: true,
      byo: null,
      ...status,
    },
    driveFeature: { enabled: true, active: true },
    isGmailActive: true,
    isCalendarActive: true,
    ...patch,
  }
}

function entryOf(
  entryId: 'google-drive' | 'google-gmail' | 'google-calendar',
  data: GoogleEntriesInput,
) {
  return resolveGoogleEntries(data).find(entry => entry.id === entryId)
}

describe('resolveGoogleEntries', () => {
  it('lists nothing before the status has loaded', () => {
    expect(resolveGoogleEntries(input({ status: null }))).toEqual([])
  })

  describe('Google Drive', () => {
    it('is not listed when google.drive is not available', () => {
      const data = input({ driveFeature: { enabled: false, active: false } })

      expect(entryOf('google-drive', data)).toBeUndefined()
    })

    it('stays listed for a leftover connection', () => {
      const data = input(
        { driveFeature: { enabled: false, active: false } },
        { connection: connection() },
      )

      expect(entryOf('google-drive', data)).toMatchObject({
        state: 'unavailable',
        stateLine: 'Not available for this account',
        action: 'disconnect',
        actionLabel: 'Disconnect',
        linkPath: null,
        canDisconnect: true,
      })
    })

    it('keeps Off in Labs only while the feature is enabled', () => {
      const data = input(
        { driveFeature: { enabled: true, active: false } },
        { connection: connection() },
      )

      expect(entryOf('google-drive', data)).toMatchObject({
        state: 'off-in-labs',
        action: 'link',
      })
    })

    it('offers to connect when nothing is connected', () => {
      const entry = entryOf('google-drive', input())

      expect(entry).toMatchObject({
        state: 'not-connected',
        stateLine: 'Not connected',
        action: 'connect',
        actionLabel: 'Connect Google Drive',
        clientMode: 'besidka',
        canDisconnect: false,
      })
    })

    it('shows the account email and Disconnect when connected', () => {
      const entry = entryOf(
        'google-drive',
        input({}, { connection: connection() }),
      )

      expect(entry).toMatchObject({
        state: 'connected',
        stateLine: 'person@example.test',
        action: 'disconnect',
        actionLabel: 'Disconnect',
        canDisconnect: true,
      })
    })

    it('names an account without an email', () => {
      const entry = entryOf(
        'google-drive',
        input({}, { connection: connection({ email: null }) }),
      )

      expect(entry?.stateLine).toBe('Unknown account')
    })

    it('offers Reconnect when Google no longer accepts the connection', () => {
      const entry = entryOf(
        'google-drive',
        input({}, { connection: connection({ status: 'needs_reauth' }) }),
      )

      expect(entry).toMatchObject({
        state: 'needs-reauth',
        stateLine: 'Needs reconnect',
        action: 'reconnect',
        actionLabel: 'Reconnect',
      })
    })

    it('links to Labs while google.drive is on offer but not turned on', () => {
      const entry = entryOf(
        'google-drive',
        input({ driveFeature: { enabled: true, active: false } }),
      )

      expect(entry).toMatchObject({
        state: 'off-in-labs',
        stateLine: 'Off in Labs',
        action: 'link',
        linkPath: '/profile/labs',
      })
    })
  })

  describe('Gmail and Google Calendar', () => {
    it('are not listed without an own-client status', () => {
      const ids = resolveGoogleEntries(input()).map(entry => entry.id)

      expect(ids).toEqual(['google-drive'])
    })

    it('are listed in order after Drive for the owner', () => {
      const ids = resolveGoogleEntries(input({}, { byo: byo() }))
        .map(entry => entry.id)

      expect(ids).toEqual(['google-drive', 'google-gmail', 'google-calendar'])
    })

    it('ask for the own client first', () => {
      const data = input({}, { byo: byo({ hasClient: false }) })

      for (const entryId of ['google-gmail', 'google-calendar'] as const) {
        expect(entryOf(entryId, data)).toMatchObject({
          state: 'needs-client',
          stateLine: 'Needs your own Google client',
          action: 'link',
          linkPath: '/profile/keys?tab=google',
        })
      }
    })

    it('offer Connect once a client is saved', () => {
      const data = input({}, { byo: byo() })

      expect(entryOf('google-gmail', data)).toMatchObject({
        state: 'not-connected',
        action: 'connect',
        actionLabel: 'Connect Gmail',
        clientMode: 'byo',
      })
      expect(entryOf('google-calendar', data)?.actionLabel)
        .toBe('Connect Google Calendar')
    })

    it('read Off in Labs while their own flag is off', () => {
      const data = input(
        { isGmailActive: false, isCalendarActive: false },
        { byo: byo() },
      )

      expect(entryOf('google-gmail', data)?.state).toBe('off-in-labs')
      expect(entryOf('google-calendar', data)?.state).toBe('off-in-labs')
      expect(entryOf('google-calendar', data)?.linkPath).toBe('/profile/labs')
    })

    it('show the email and Disconnect when fully granted', () => {
      const granted = connection({
        clientMode: 'byo',
        capabilities: [
          'identity',
          'gmail-read',
          'gmail-compose',
          'calendar',
        ],
      })
      const data = input({}, { byo: byo({ connection: granted }) })

      for (const entryId of ['google-gmail', 'google-calendar'] as const) {
        expect(entryOf(entryId, data)).toMatchObject({
          state: 'connected',
          stateLine: 'person@example.test',
          action: 'disconnect',
        })
      }
    })

    it('name the missing Gmail access and offer Add access', () => {
      const readOnly = connection({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-read'],
      })
      const composeOnly = connection({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-compose'],
      })
      const neither = connection({
        clientMode: 'byo',
        capabilities: ['identity', 'drive-read'],
      })

      expect(entryOf('google-gmail', input({}, {
        byo: byo({ connection: readOnly }),
      }))).toMatchObject({
        state: 'partial',
        stateLine: 'Drafts access not granted',
        action: 'add-access',
        actionLabel: 'Add access',
      })
      expect(entryOf('google-gmail', input({}, {
        byo: byo({ connection: composeOnly }),
      }))?.stateLine).toBe('Read access not granted')
      expect(entryOf('google-gmail', input({}, {
        byo: byo({ connection: neither }),
      }))?.stateLine).toBe('Gmail access not granted')
    })

    it('name the missing Calendar permission', () => {
      const events = connection({
        clientMode: 'byo',
        capabilities: ['identity'],
        partialCalendar: 'events',
      })
      const freeBusy = connection({
        clientMode: 'byo',
        capabilities: ['identity'],
        partialCalendar: 'free-busy',
      })
      const none = connection({ clientMode: 'byo', capabilities: ['identity'] })

      expect(entryOf('google-calendar', input({}, {
        byo: byo({ connection: events }),
      }))?.stateLine).toBe('Free and busy access not granted')
      expect(entryOf('google-calendar', input({}, {
        byo: byo({ connection: freeBusy }),
      }))?.stateLine).toBe('Event access not granted')
      expect(entryOf('google-calendar', input({}, {
        byo: byo({ connection: none }),
      }))?.stateLine).toBe('Google Calendar access not granted')
    })

    it('offer Reconnect for a connection Google no longer accepts', () => {
      const stale = connection({ clientMode: 'byo', status: 'needs_reauth' })
      const data = input({}, { byo: byo({ connection: stale }) })

      expect(entryOf('google-gmail', data)).toMatchObject({
        state: 'needs-reauth',
        action: 'reconnect',
      })
    })

    it('are listed with Disconnect only for a leftover connection', () => {
      const leftover = connection({
        clientMode: 'byo',
        capabilities: ['identity', 'gmail-read'],
      })
      const data = input({}, {
        byo: byo({ canManage: false, redirectUri: null, connection: leftover }),
      })

      expect(entryOf('google-gmail', data)).toMatchObject({
        state: 'unavailable',
        stateLine: 'Not available for this account',
        action: 'disconnect',
        canDisconnect: true,
      })
      expect(entryOf('google-calendar', data)).toBeUndefined()
    })

    it('are not listed for a former owner who kept only the client', () => {
      const data = input({}, {
        byo: byo({ canManage: false, redirectUri: null }),
      })

      expect(resolveGoogleEntries(data).map(entry => entry.id))
        .toEqual(['google-drive'])
    })
  })
})

describe('getGoogleByoRequestedCapabilities', () => {
  const held = connection({
    clientMode: 'byo',
    capabilities: ['identity', 'gmail-read', 'calendar'],
  })

  it('keeps what an active connection holds when adding a service', () => {
    expect(getGoogleByoRequestedCapabilities(['gmail-compose'], held, true))
      .toEqual(['gmail-read', 'calendar', 'gmail-compose'])
  })

  it('asks only for the new capabilities without a connection', () => {
    expect(getGoogleByoRequestedCapabilities(
      ['gmail-read', 'gmail-compose'],
      null,
      true,
    )).toEqual(['gmail-read', 'gmail-compose'])
  })

  it('carries over what a connection that needs reconnecting held', () => {
    const stale = connection({
      clientMode: 'byo',
      status: 'needs_reauth',
      capabilities: ['identity', 'gmail-read', 'calendar', 'drive-read'],
    })

    expect(getGoogleByoRequestedCapabilities(['gmail-read'], stale, true))
      .toEqual(['drive-read', 'gmail-read', 'calendar'])
  })

  it('ignores what a revoked connection held', () => {
    const revoked = connection({
      clientMode: 'byo',
      status: 'revoked',
      capabilities: ['identity', 'gmail-read'],
    })

    expect(getGoogleByoRequestedCapabilities(['calendar'], revoked, true))
      .toEqual(['calendar'])
  })

  it('never asks for Calendar while it is off in Labs', () => {
    expect(getGoogleByoRequestedCapabilities(['gmail-compose'], held, false))
      .toEqual(['gmail-read', 'gmail-compose'])
    expect(getGoogleByoRequestedCapabilities(['calendar'], null, false))
      .toEqual([])
  })

  it('does not repeat a capability', () => {
    expect(getGoogleByoRequestedCapabilities(['gmail-read'], held, true))
      .toEqual(['gmail-read', 'calendar'])
  })
})

describe('GOOGLE_BYO_DISCONNECT_SERVICES', () => {
  it('names every service the one own-client grant stops', () => {
    expect(GOOGLE_BYO_DISCONNECT_SERVICES)
      .toBe('Gmail, Google Calendar and whole-Drive search')
  })
})
