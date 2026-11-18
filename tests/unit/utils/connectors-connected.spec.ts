import { describe, expect, it } from 'vitest'
import { isConnectorNeverConnected } from '#shared/utils/connectors-connected'

const CONSENTED_AT = '2026-11-16T10:00:00.000Z'
const CONNECTED_AT = '2026-11-16T10:05:00.000Z'

describe('isConnectorNeverConnected', () => {
  it('treats a row waiting for a sign-in that never finished as never '
    + 'connected, with or without a consent', () => {
    expect(isConnectorNeverConnected({
      status: 'needs-auth',
      lastConnectedAt: null,
      consentedAt: null,
    })).toBe(true)
    expect(isConnectorNeverConnected({
      status: 'needs-auth',
      lastConnectedAt: null,
      consentedAt: CONSENTED_AT,
    })).toBe(true)
  })

  it('treats a no-auth row flipped to ready before any consent as never '
    + 'connected', () => {
    expect(isConnectorNeverConnected({
      status: 'ready',
      lastConnectedAt: null,
      consentedAt: null,
    })).toBe(true)
  })

  it('counts a row that a server once answered as connected, even after a '
    + 'disconnect', () => {
    expect(isConnectorNeverConnected({
      status: 'needs-auth',
      lastConnectedAt: CONNECTED_AT,
      consentedAt: CONSENTED_AT,
    })).toBe(false)
    expect(isConnectorNeverConnected({
      status: 'ready',
      lastConnectedAt: new Date(CONNECTED_AT),
      consentedAt: new Date(CONSENTED_AT),
    })).toBe(false)
  })

  it('counts a consented no-auth row as connected', () => {
    expect(isConnectorNeverConnected({
      status: 'ready',
      lastConnectedAt: null,
      consentedAt: CONSENTED_AT,
    })).toBe(false)
  })
})
