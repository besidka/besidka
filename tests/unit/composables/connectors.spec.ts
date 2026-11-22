import { describe, expect, it } from 'vitest'
import {
  getConnectorInitial,
  getConnectorStatusLabel,
  isConnectorConnected,
  readConnectorCallback,
} from '../../../app/composables/connectors'
import { CONNECTOR_CALLBACK_FALLBACK_MESSAGE } from '#shared/utils/connectors-messages'
import { createConnectorItem } from '../../setup/helpers/connectors-ui'

describe('connectors composable helpers', () => {
  it('labels each state of a connector', () => {
    expect(getConnectorStatusLabel(createConnectorItem()))
      .toEqual({ label: 'Ready', tone: 'success' })
    expect(getConnectorStatusLabel(createConnectorItem({
      status: 'needs-auth',
    }))).toEqual({ label: 'Needs sign-in', tone: 'warning' })
    expect(getConnectorStatusLabel(createConnectorItem({
      consent: { state: 'withdrawn', issuerHost: null, givenAt: null },
    }))).toEqual({ label: 'Needs consent', tone: 'warning' })
    expect(getConnectorStatusLabel(createConnectorItem({ status: 'drifted' })))
      .toEqual({ label: 'Tools changed', tone: 'warning' })
    expect(getConnectorStatusLabel(createConnectorItem({ status: 'error' })))
      .toEqual({ label: 'Error', tone: 'error' })
  })

  it('tells a connector that never connected from one that did', () => {
    const neverConnected = createConnectorItem({
      status: 'needs-auth',
      lastConnectedAt: null,
      consent: { state: 'missing', issuerHost: null, givenAt: null },
    })

    expect(isConnectorConnected(neverConnected)).toBe(false)
    expect(getConnectorStatusLabel(neverConnected))
      .toEqual({ label: 'Not connected', tone: 'warning' })
    expect(isConnectorConnected(createConnectorItem({
      status: 'needs-auth',
      lastConnectedAt: null,
      consent: { state: 'current', issuerHost: null, givenAt: '2026-11-15' },
    }))).toBe(false)
    expect(isConnectorConnected(createConnectorItem({
      status: 'ready',
      lastConnectedAt: null,
      consent: { state: 'missing', issuerHost: null, givenAt: null },
    }))).toBe(false)
    expect(isConnectorConnected(createConnectorItem({
      status: 'ready',
      authType: 'none',
      lastConnectedAt: null,
    }))).toBe(true)
    expect(isConnectorConnected(createConnectorItem({
      status: 'needs-auth',
    }))).toBe(true)
  })

  it('makes a letter avatar from the title', () => {
    expect(getConnectorInitial('linear')).toBe('L')
    expect(getConnectorInitial('  ')).toBe('?')
    expect(getConnectorInitial('éclair')).toBe('É')
  })

  it('reads the OAuth callback query with fixed messages only', () => {
    expect(readConnectorCallback({ connected: 'abc123' })).toEqual({
      kind: 'connected',
      connectorId: 'abc123',
      message: 'Connector signed in',
    })
    expect(readConnectorCallback({ error: 'CONNECTOR_OAUTH_DENIED' }))
      .toMatchObject({ kind: 'error', message: 'Sign-in was canceled' })
    expect(readConnectorCallback({ error: '<img src=x onerror=alert(1)>' }))
      .toMatchObject({
        kind: 'error',
        message: CONNECTOR_CALLBACK_FALLBACK_MESSAGE,
      })
    expect(readConnectorCallback({ connected: '../../evil' })).toBeNull()
    expect(readConnectorCallback({})).toBeNull()
  })
})
