import { describe, expect, it } from 'vitest'
import {
  getGoogleDriveConnectTarget,
  getGoogleDriveTabNotConnected,
  getGoogleDriveTabReauthorize,
} from '../../../app/utils/google-drive-tab'

describe('getGoogleDriveConnectTarget', () => {
  it('points to the Google Drive panel with the Connectors page', () => {
    expect(getGoogleDriveConnectTarget(true)).toEqual({
      path: '/chats/connectors?panel=google-drive',
      pageName: 'Connectors page',
      openLabel: 'Open Connectors',
    })
  })

  it('falls back to the Google tab of API Keys without that page', () => {
    expect(getGoogleDriveConnectTarget(false)).toEqual({
      path: '/profile/keys?tab=google',
      pageName: 'API Keys page',
      openLabel: 'Open API Keys',
    })
  })
})

describe('Google Drive tab sentences', () => {
  it('name the page the user can connect on', () => {
    const connectors = getGoogleDriveConnectTarget(true)
    const keys = getGoogleDriveConnectTarget(false)

    expect(getGoogleDriveTabNotConnected(connectors)).toBe(
      'Connect Google Drive on the Connectors page to pick files from it.',
    )
    expect(getGoogleDriveTabReauthorize(keys)).toBe(
      'Google no longer accepts the connection. Reconnect Google Drive on '
      + 'the API Keys page.',
    )
  })
})
