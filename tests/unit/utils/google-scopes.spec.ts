import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CAPABILITIES,
  GOOGLE_CLIENT_MODES,
  GOOGLE_SCOPES,
  GOOGLE_SCOPE_CAPABILITIES,
  getCapabilityScopes,
  getScopesForClient,
  hasScopes,
  isCapabilityAllowedForClient,
  normalizeGoogleScope,
  parseGoogleScopes,
} from '#shared/utils/google-scopes'

describe('hasScopes', () => {
  it('reads a space-separated scope string', () => {
    const granted = `openid ${GOOGLE_SCOPES.email} ${GOOGLE_SCOPES.driveFile}`

    expect(hasScopes(granted, [GOOGLE_SCOPES.driveFile])).toBe(true)
    expect(hasScopes(granted, [GOOGLE_SCOPES.calendarEvents])).toBe(false)
  })

  it('reads an array of scopes', () => {
    expect(hasScopes(
      [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.gmailCompose],
      [GOOGLE_SCOPES.gmailCompose],
    )).toBe(true)
  })

  it('ignores order, duplicates and extra whitespace', () => {
    const granted = `  ${GOOGLE_SCOPES.driveFile}\n openid\t${
      GOOGLE_SCOPES.driveFile}  `

    expect(hasScopes(granted, ['openid', GOOGLE_SCOPES.driveFile])).toBe(true)
    expect(hasScopes(granted, [
      GOOGLE_SCOPES.driveFile,
      GOOGLE_SCOPES.driveFile,
      'openid',
    ])).toBe(true)
  })

  it('needs every required scope', () => {
    expect(hasScopes(
      GOOGLE_SCOPES.driveFile,
      [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.calendarEvents],
    )).toBe(false)
  })

  it('is true when nothing is required and false for an empty grant', () => {
    expect(hasScopes('', [])).toBe(true)
    expect(hasScopes([], [])).toBe(true)
    expect(hasScopes('', [GOOGLE_SCOPES.driveFile])).toBe(false)
    expect(hasScopes([], ['openid'])).toBe(false)
  })

  it('does not match a scope by prefix or substring', () => {
    expect(hasScopes(GOOGLE_SCOPES.driveFile, [GOOGLE_SCOPES.driveReadonly]))
      .toBe(false)
    expect(hasScopes(
      GOOGLE_SCOPES.gmailReadonly,
      [GOOGLE_SCOPES.gmailCompose],
    )).toBe(false)
    expect(hasScopes('openid-extra', ['openid'])).toBe(false)
  })

  it('treats the short and expanded identity scopes as the same', () => {
    const expanded = `openid ${GOOGLE_SCOPES.email} ${GOOGLE_SCOPES.profile}`

    expect(hasScopes(expanded, ['openid', 'email', 'profile'])).toBe(true)
    expect(hasScopes('openid email profile', [
      GOOGLE_SCOPES.email,
      GOOGLE_SCOPES.profile,
    ])).toBe(true)
  })
})

describe('parseGoogleScopes', () => {
  it('splits, normalizes and de-duplicates in first-seen order', () => {
    expect(parseGoogleScopes(
      `email openid ${GOOGLE_SCOPES.email} profile`,
    )).toEqual([
      GOOGLE_SCOPES.email,
      'openid',
      GOOGLE_SCOPES.profile,
    ])
  })

  it('splits entries of an array that hold several scopes', () => {
    expect(parseGoogleScopes(['openid email', 'openid'])).toEqual([
      'openid',
      GOOGLE_SCOPES.email,
    ])
  })

  it('returns nothing for empty input', () => {
    expect(parseGoogleScopes('   ')).toEqual([])
    expect(parseGoogleScopes([])).toEqual([])
  })
})

describe('normalizeGoogleScope', () => {
  it('expands the short identity names and leaves others alone', () => {
    expect(normalizeGoogleScope('email')).toBe(GOOGLE_SCOPES.email)
    expect(normalizeGoogleScope(' profile ')).toBe(GOOGLE_SCOPES.profile)
    expect(normalizeGoogleScope('openid')).toBe('openid')
    expect(normalizeGoogleScope(GOOGLE_SCOPES.driveFile))
      .toBe(GOOGLE_SCOPES.driveFile)
  })
})

describe('Google scope capabilities', () => {
  it('describes every capability with at least one scope and client', () => {
    for (const capability of GOOGLE_CAPABILITIES) {
      const definition = GOOGLE_SCOPE_CAPABILITIES[capability]

      expect(definition.scopes.length, capability).toBeGreaterThan(0)
      expect(definition.clients.length, capability).toBeGreaterThan(0)
    }
  })

  it('uses only well-formed, unique scope strings', () => {
    const scopes = Object.values(GOOGLE_SCOPES)

    expect(new Set(scopes).size).toBe(scopes.length)

    for (const scope of scopes) {
      expect(scope === 'openid' || scope.startsWith(
        'https://www.googleapis.com/auth/',
      ), scope).toBe(true)
      expect(scope).not.toMatch(/\s/)
    }
  })

  it('lets Besidka\'s client ask for drive.file and identity only', () => {
    expect(getScopesForClient('besidka')).toEqual([
      'openid',
      GOOGLE_SCOPES.email,
      GOOGLE_SCOPES.profile,
      GOOGLE_SCOPES.driveFile,
      GOOGLE_SCOPES.calendarEvents,
    ])
  })

  it('never lets Besidka\'s client request a bring-your-own-only scope', () => {
    const besidkaScopes = getScopesForClient('besidka')
    const byoOnlyScopes = GOOGLE_CAPABILITIES.filter((capability) => {
      return !isCapabilityAllowedForClient(capability, 'besidka')
    }).flatMap((capability) => {
      return GOOGLE_SCOPE_CAPABILITIES[capability].scopes
    })

    expect(byoOnlyScopes).toEqual([
      GOOGLE_SCOPES.driveReadonly,
      GOOGLE_SCOPES.gmailReadonly,
      GOOGLE_SCOPES.gmailCompose,
    ])

    for (const scope of byoOnlyScopes) {
      expect(besidkaScopes).not.toContain(scope)
    }
  })

  it('keeps restricted scopes off Besidka\'s client', () => {
    for (const capability of GOOGLE_CAPABILITIES) {
      const definition = GOOGLE_SCOPE_CAPABILITIES[capability]

      if (definition.classification === 'restricted') {
        expect(definition.clients, capability).toEqual(['byo'])
      }
    }
  })

  it('offers the bring-your-own client every scope Besidka\'s client has '
    + 'except the picked-files one', () => {
    const byoScopes = getScopesForClient('byo')

    expect(byoScopes).not.toContain(GOOGLE_SCOPES.driveFile)
    expect(byoScopes).toContain(GOOGLE_SCOPES.driveReadonly)
    expect(byoScopes).toContain(GOOGLE_SCOPES.gmailReadonly)
    expect(byoScopes).toContain(GOOGLE_SCOPES.gmailCompose)
    expect(byoScopes).toContain(GOOGLE_SCOPES.calendarEvents)
  })

  it('marks Calendar as provisional until the narrower scope is checked', () => {
    expect(GOOGLE_SCOPE_CAPABILITIES.calendar.provisional).toBe(true)
    expect(GOOGLE_SCOPE_CAPABILITIES.calendar.classification)
      .toBe('unconfirmed')
  })

  it('knows both client modes', () => {
    expect(GOOGLE_CLIENT_MODES).toEqual(['besidka', 'byo'])
  })

  it('collects the scopes of several capabilities without duplicates', () => {
    expect(getCapabilityScopes(['identity', 'drive-picked', 'identity']))
      .toEqual([
        'openid',
        GOOGLE_SCOPES.email,
        GOOGLE_SCOPES.profile,
        GOOGLE_SCOPES.driveFile,
      ])
  })
})
