import { describe, expect, it } from 'vitest'
import { GOOGLE_SCOPES, hasScopes } from '#shared/utils/google-scopes'
import {
  buildGoogleRedirectUri,
  getConnectionScopes,
  GOOGLE_CONNECTION_REQUIRED_SCOPES,
  requiredConnectionScopes,
} from '~~/server/utils/google/client'
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  readGoogleIdentity,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from '~~/server/utils/google/oauth'
import {
  createFakeGoogle,
  DRIVE_FILE_SCOPE,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_EMAIL,
  GOOGLE_SUBJECT,
  makeIdToken,
} from '../../../../setup/helpers/google-connections'

const client = {
  clientMode: 'besidka' as const,
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
}

function authorizationUrl(overrides: {
  loginHint?: string | null
  promptConsent?: boolean
} = {}) {
  return new URL(buildGoogleAuthorizationUrl({
    client,
    redirectUri: 'https://besidka.com/api/v1/google/oauth/callback',
    scopes: getConnectionScopes('besidka'),
    state: 'state-value-1234567890',
    codeChallenge: 'challenge',
    loginHint: overrides.loginHint ?? null,
    promptConsent: overrides.promptConsent ?? true,
  }))
}

describe('Google connection scopes', () => {
  it('asks for drive.file, openid and email only on Besidka\'s client', () => {
    expect(getConnectionScopes('besidka').sort()).toEqual([
      GOOGLE_SCOPES.driveFile,
      GOOGLE_SCOPES.openid,
      GOOGLE_SCOPES.email,
    ].sort())
    expect(getConnectionScopes('besidka')).not.toContain(GOOGLE_SCOPES.profile)
  })

  it('refuses a grant without drive.file', () => {
    const required = GOOGLE_CONNECTION_REQUIRED_SCOPES.besidka

    expect(hasScopes('openid email profile', required)).toBe(false)
    expect(hasScopes(`openid email ${DRIVE_FILE_SCOPE}`, required)).toBe(true)
  })

  it('asks the own client for identity plus the ticked scopes only', () => {
    expect(getConnectionScopes('byo', [GOOGLE_SCOPES.gmailReadonly]).sort())
      .toEqual([
        GOOGLE_SCOPES.openid,
        GOOGLE_SCOPES.email,
        GOOGLE_SCOPES.gmailReadonly,
      ].sort())
  })

  it('never lets a stored scope list widen the own client\'s request', () => {
    const scopes = getConnectionScopes('byo', [
      GOOGLE_SCOPES.driveFile,
      GOOGLE_SCOPES.profile,
      'https://www.googleapis.com/auth/cloud-platform',
      GOOGLE_SCOPES.driveReadonly,
    ])

    expect(scopes).toContain(GOOGLE_SCOPES.driveReadonly)
    expect(scopes).not.toContain(GOOGLE_SCOPES.driveFile)
    expect(scopes).not.toContain(GOOGLE_SCOPES.profile)
    expect(scopes).not.toContain(
      'https://www.googleapis.com/auth/cloud-platform',
    )
    expect(requiredConnectionScopes('byo', [GOOGLE_SCOPES.driveFile]))
      .toEqual([])
  })

  it('gives each client its own callback path', () => {
    expect(buildGoogleRedirectUri('https://besidka.com', 'besidka'))
      .toBe('https://besidka.com/api/v1/google/oauth/callback')
    expect(buildGoogleRedirectUri('https://besidka.com', 'byo'))
      .toBe('https://besidka.com/api/v1/google/byo/callback')
  })
})

describe('buildGoogleAuthorizationUrl', () => {
  it('builds an offline, PKCE, incremental request', () => {
    const url = authorizationUrl()

    expect(url.origin + url.pathname)
      .toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: 'https://besidka.com/api/v1/google/oauth/callback',
      response_type: 'code',
      scope: getConnectionScopes('besidka').join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      state: 'state-value-1234567890',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      prompt: 'consent select_account',
    })
  })

  it('passes the Google subject, never the email, as a hint', () => {
    const url = authorizationUrl({
      loginHint: GOOGLE_SUBJECT,
      promptConsent: false,
    })

    expect(url.searchParams.get('login_hint')).toBe(GOOGLE_SUBJECT)
    expect(url.toString()).not.toContain(encodeURIComponent(GOOGLE_EMAIL))
    expect(url.searchParams.has('prompt')).toBe(false)
  })
})

describe('token requests', () => {
  it('exchanges the code with the verifier and exact redirect URI', async () => {
    const google = createFakeGoogle()
    const result = await exchangeGoogleCode({
      client,
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://pr-9-besidka.chernenko.workers.dev/cb',
      now: 1_000,
    }, { fetchImpl: google.fetch })
    const [request] = google.tokenRequests()

    expect(Object.fromEntries(request!.form)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'https://pr-9-besidka.chernenko.workers.dev/cb',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    })
    expect(request!.redirect).toBe('manual')
    expect(result).toEqual({
      ok: true,
      tokens: expect.objectContaining({
        accessToken: 'access-initial',
        refreshToken: 'refresh-initial',
        expiresAt: new Date(1_000 + 3_599_000),
      }),
    })
  })

  it('reports invalid_grant from a refresh', async () => {
    const google = createFakeGoogle({
      token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    })
    const result = await refreshGoogleAccessToken({
      client,
      refreshToken: 'refresh-1',
    }, { fetchImpl: google.fetch })

    expect(result).toEqual({ ok: false, error: 'invalid_grant' })
  })

  it('refuses a token answer without a bearer token', async () => {
    const google = createFakeGoogle({
      token: () => ({ status: 200, body: { token_type: 'mac' } }),
    })
    const result = await refreshGoogleAccessToken({
      client,
      refreshToken: 'refresh-1',
    }, { fetchImpl: google.fetch })

    expect(result).toEqual({ ok: false, error: null })
  })
})

describe('revokeGoogleToken', () => {
  it('sends the token in the body, never the URL', async () => {
    const google = createFakeGoogle()

    expect(await revokeGoogleToken('secret-token', {
      fetchImpl: google.fetch,
    })).toBe(true)

    const [request] = google.revokeRequests()

    expect(request!.url).toBe('https://oauth2.googleapis.com/revoke')
    expect(request!.form.get('token')).toBe('secret-token')
  })

  it('counts an already invalid token as revoked', async () => {
    const google = createFakeGoogle({
      revoke: () => ({ status: 400, body: { error: 'invalid_token' } }),
    })

    expect(await revokeGoogleToken('t', { fetchImpl: google.fetch }))
      .toBe(true)
  })

  it('never throws', async () => {
    expect(await revokeGoogleToken('t', {
      fetchImpl: async () => {
        throw new Error('down')
      },
    })).toBe(false)
  })
})

describe('readGoogleIdentity', () => {
  it('reads the subject and verified email', () => {
    expect(readGoogleIdentity(makeIdToken(), GOOGLE_CLIENT_ID)).toEqual({
      subject: GOOGLE_SUBJECT,
      email: GOOGLE_EMAIL,
    })
  })

  it('drops an unverified email', () => {
    expect(readGoogleIdentity(
      makeIdToken({ email_verified: false }),
      GOOGLE_CLIENT_ID,
    )).toEqual({ subject: GOOGLE_SUBJECT, email: null })
  })

  it.each([
    ['another audience', { aud: 'other-client' }],
    ['another issuer', { iss: 'https://evil.example.com' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['no subject', { sub: '' }],
  ])('refuses %s', (_label, claims) => {
    expect(readGoogleIdentity(makeIdToken(claims), GOOGLE_CLIENT_ID))
      .toBeNull()
  })

  it('refuses a malformed token', () => {
    expect(readGoogleIdentity('not.a', GOOGLE_CLIENT_ID)).toBeNull()
    expect(readGoogleIdentity(null, GOOGLE_CLIENT_ID)).toBeNull()
  })
})
