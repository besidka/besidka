import { describe, expect, it } from 'vitest'
import {
  GOOGLE_BYO_CALLBACK_PATH,
  GOOGLE_BYO_CAPABILITIES,
  getGoogleByoScopes,
  isGoogleByoCapability,
  isGoogleOAuthClientId,
  isGoogleOAuthClientSecret,
} from '#shared/utils/google-byo'
import {
  GOOGLE_SCOPES,
  isCapabilityAllowedForClient,
} from '#shared/utils/google-scopes'

describe('google-byo contracts', () => {
  it('offers only capabilities the scope map allows for the own client',
    () => {
      for (const capability of GOOGLE_BYO_CAPABILITIES) {
        expect(isCapabilityAllowedForClient(capability, 'byo')).toBe(true)
      }

      expect(GOOGLE_BYO_CAPABILITIES).not.toContain('drive-picked')
      expect(GOOGLE_BYO_CAPABILITIES).not.toContain('identity')
    })

  it('maps capability names to scopes and never to drive.file', () => {
    expect(getGoogleByoScopes(['drive-read', 'gmail-compose']).sort())
      .toEqual([GOOGLE_SCOPES.driveReadonly, GOOGLE_SCOPES.gmailCompose].sort())
    expect(getGoogleByoScopes([...GOOGLE_BYO_CAPABILITIES]))
      .not.toContain(GOOGLE_SCOPES.driveFile)
  })

  it('recognizes capability names only', () => {
    expect(isGoogleByoCapability('calendar')).toBe(true)
    expect(isGoogleByoCapability('drive-picked')).toBe(false)
    expect(isGoogleByoCapability(GOOGLE_SCOPES.gmailReadonly)).toBe(false)
  })

  it.each([
    ['owner-test-abc123.apps.googleusercontent.com', true],
    ['abc.apps.googleusercontent.com', true],
    ['owner-ABC.apps.googleusercontent.com', false],
    ['owner-abc.apps.googleusercontent.com.evil.example', false],
    ['owner-abc.example.com', false],
    [' owner-abc.apps.googleusercontent.com', false],
    [`${'a'.repeat(190)}.apps.googleusercontent.com`, false],
  ])('checks the client id %s', (value, expected) => {
    expect(isGoogleOAuthClientId(value)).toBe(expected)
  })

  it.each([
    ['test-secret-abcdefghijklmnopqrstu', true],
    ['short-secret', false],
    ['test secret abcdefghijklmnopqrstu', false],
    ['test-secret-éabcdefghijklmnopqrs', false],
    ['x'.repeat(129), false],
  ])('checks the client secret %#', (value, expected) => {
    expect(isGoogleOAuthClientSecret(value)).toBe(expected)
  })

  it('keeps the own callback apart from Besidka\'s', () => {
    expect(GOOGLE_BYO_CALLBACK_PATH).toBe('/api/v1/google/byo/callback')
  })
})
