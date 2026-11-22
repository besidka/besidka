import { parseGoogleScopes } from '#shared/utils/google-scopes'
import type { GoogleOAuthClient } from '~~/server/utils/google/client'
import { googleFetchJson } from '~~/server/utils/google/http'
import type { GoogleFetchOptions } from '~~/server/utils/google/http'

export const GOOGLE_AUTHORIZATION_ENDPOINT
  = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

const GOOGLE_ID_TOKEN_ISSUERS: ReadonlySet<string> = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
])
const TOKEN_MAX_LENGTH = 16 * 1024
const SUBJECT_MAX_LENGTH = 255
const EMAIL_MAX_LENGTH = 320
const ID_TOKEN_CLOCK_SKEW_MS = 5 * 60 * 1000
const ID_TOKEN_SEGMENTS = 3

export interface GoogleTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string[]
  idToken: string | null
}

export type GoogleTokenResult
  = | { ok: true, tokens: GoogleTokenSet }
    | { ok: false, error: string | null }

export interface GoogleIdentity {
  subject: string
  email: string | null
}

export function buildGoogleAuthorizationUrl(input: {
  client: GoogleOAuthClient
  redirectUri: string
  scopes: readonly string[]
  state: string
  codeChallenge: string
  loginHint: string | null
  promptConsent: boolean
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT)
  const prompts: string[] = []

  if (input.promptConsent) {
    prompts.push('consent')
  }

  if (!input.loginHint) {
    prompts.push('select_account')
  }

  url.searchParams.set('client_id', input.client.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  if (prompts.length > 0) {
    url.searchParams.set('prompt', prompts.join(' '))
  }

  if (input.loginHint) {
    url.searchParams.set('login_hint', input.loginHint)
  }

  return url.toString()
}

function readBoundedString(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > TOKEN_MAX_LENGTH) {
    return null
  }

  return value
}

function parseTokenBody(
  body: Record<string, unknown>,
  startedAt: number,
): GoogleTokenSet | null {
  const accessToken = readBoundedString(body.access_token)
  const tokenType = body.token_type

  if (!accessToken) {
    return null
  }

  if (
    tokenType !== undefined
    && (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer')
  ) {
    return null
  }

  const lifetimeSeconds = typeof body.expires_in === 'number'
    ? body.expires_in
    : Number(body.expires_in)

  return {
    accessToken,
    refreshToken: readBoundedString(body.refresh_token),
    expiresAt: Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0
      ? new Date(startedAt + lifetimeSeconds * 1000)
      : null,
    scopes: typeof body.scope === 'string' ? parseGoogleScopes(body.scope) : [],
    idToken: readBoundedString(body.id_token),
  }
}

async function requestGoogleTokens(
  form: Record<string, string>,
  options: GoogleFetchOptions,
  now: number,
): Promise<GoogleTokenResult> {
  const response = await googleFetchJson(
    GOOGLE_TOKEN_ENDPOINT,
    { method: 'POST', form },
    options,
  )

  if (!response.ok || !response.body) {
    const error = response.body?.error

    return { ok: false, error: typeof error === 'string' ? error : null }
  }

  const tokens = parseTokenBody(response.body, now)

  return tokens ? { ok: true, tokens } : { ok: false, error: null }
}

/**
 * The authorization-code grant with the PKCE verifier and the exact
 * redirect URI the authorization request used. Network failures and
 * timeouts throw; Google's own refusals come back as `{ ok: false }`.
 */
export async function exchangeGoogleCode(input: {
  client: GoogleOAuthClient
  code: string
  codeVerifier: string
  redirectUri: string
  now?: number
}, options: GoogleFetchOptions = {}): Promise<GoogleTokenResult> {
  return await requestGoogleTokens({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    client_id: input.client.clientId,
    client_secret: input.client.clientSecret,
  }, options, input.now ?? Date.now())
}

export async function refreshGoogleAccessToken(input: {
  client: GoogleOAuthClient
  refreshToken: string
  now?: number
}, options: GoogleFetchOptions = {}): Promise<GoogleTokenResult> {
  return await requestGoogleTokens({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.client.clientId,
    client_secret: input.client.clientSecret,
  }, options, input.now ?? Date.now())
}

/**
 * Revokes a token at Google; revoking a refresh token ends the whole grant.
 * The token goes in the form body, never the URL. An answer of
 * `invalid_token` means it was already dead and counts as revoked. Never
 * throws: callers delete their copy either way.
 */
export async function revokeGoogleToken(
  token: string,
  options: GoogleFetchOptions = {},
): Promise<boolean> {
  try {
    const response = await googleFetchJson(
      GOOGLE_REVOKE_ENDPOINT,
      { method: 'POST', form: { token } },
      options,
    )

    return response.ok || response.body?.error === 'invalid_token'
  } catch {
    return false
  }
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    )

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    return null
  } catch {
    return null
  }
}

function hasAudience(audience: unknown, clientId: string): boolean {
  if (typeof audience === 'string') {
    return audience === clientId
  }

  return Array.isArray(audience) && audience.includes(clientId)
}

/**
 * Reads the Google account's subject and email from the ID token that came
 * in the token response. The token arrived straight from Google's token
 * endpoint over TLS in the code exchange, so per OpenID Connect Core 3.1.3.7
 * the signature check may be skipped; the issuer, audience and expiry are
 * still checked. It identifies the Google account only, never the Besidka
 * user, and is not stored.
 */
export function readGoogleIdentity(
  idToken: string | null,
  clientId: string,
  now: number = Date.now(),
): GoogleIdentity | null {
  const segments = idToken?.split('.') ?? []

  if (segments.length !== ID_TOKEN_SEGMENTS) {
    return null
  }

  const claims = decodeSegment(segments[1]!)

  if (!claims) {
    return null
  }

  const subject = claims.sub
  const expiresAt = Number(claims.exp) * 1000

  if (
    typeof claims.iss !== 'string'
    || !GOOGLE_ID_TOKEN_ISSUERS.has(claims.iss)
    || !hasAudience(claims.aud, clientId)
    || !Number.isFinite(expiresAt)
    || expiresAt + ID_TOKEN_CLOCK_SKEW_MS < now
    || typeof subject !== 'string'
    || !subject
    || subject.length > SUBJECT_MAX_LENGTH
  ) {
    return null
  }

  const email = typeof claims.email === 'string'
    && claims.email.length <= EMAIL_MAX_LENGTH
    && claims.email_verified !== false
    ? claims.email
    : null

  return { subject, email }
}
