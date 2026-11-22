import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CALLBACK_FALLBACK_MESSAGE,
  CONNECTOR_CODE_MESSAGES,
  connectorCodeMessage,
} from '#shared/utils/connectors-messages'
import { CONNECTOR_ERRORS } from '~~/server/utils/connectors/errors'

describe('connector code messages', () => {
  it('has the server message of every connector error code', () => {
    for (const [code, text] of Object.entries(CONNECTOR_ERRORS)) {
      expect(CONNECTOR_CODE_MESSAGES[code], code).toBe(text.message)
    }
  })

  it('shows a fixed fallback for an unknown or crafted code', () => {
    expect(connectorCodeMessage('CONNECTOR_OAUTH_DENIED'))
      .toBe('Sign-in was canceled')
    expect(connectorCodeMessage('<script>alert(1)</script>'))
      .toBe(CONNECTOR_CALLBACK_FALLBACK_MESSAGE)
    expect(connectorCodeMessage('safe-fetch-blocked'))
      .toBe(CONNECTOR_CALLBACK_FALLBACK_MESSAGE)
    expect(connectorCodeMessage('toString'))
      .toBe(CONNECTOR_CALLBACK_FALLBACK_MESSAGE)
    expect(connectorCodeMessage(['CONNECTOR_OAUTH_DENIED']))
      .toBe(CONNECTOR_CALLBACK_FALLBACK_MESSAGE)
  })
})
