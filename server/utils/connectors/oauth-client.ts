import { CONNECTOR_REVOKE_TIMEOUT_MS } from '#shared/utils/connectors-policy'
import type {
  ConnectorClientMetadataDocument,
} from '~~/server/utils/connectors/client-metadata'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import type {
  AuthorizationServerMetadata,
} from '~~/server/utils/connectors/oauth-metadata'
import type {
  ConnectorClientRegistration,
  ConnectorTokenEndpointAuthMethod,
} from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFetch } from '~~/server/utils/net/safe-fetch'

const RANDOM_BYTES = 32
const TOKEN_MAX_LENGTH = 16 * 1024
const CLIENT_ID_MAX_LENGTH = 2048
const NO_REDIRECTS = 0
const TOKEN_ENDPOINT_AUTH_METHODS: readonly ConnectorTokenEndpointAuthMethod[]
  = ['none', 'client_secret_post', 'client_secret_basic']

export interface PkcePair {
  verifier: string
  challenge: string
}

export interface ConnectorTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scope: string | null
}

export type ConnectorTokenResult
  = | { ok: true, tokens: ConnectorTokenSet }
    | { ok: false, invalidGrant: boolean }

type JsonObject = Record<string, unknown>

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)))
}

export function createOAuthState(): string {
  return randomToken()
}

/**
 * RFC 7636 S256: a 43-character verifier from 32 random bytes, and its
 * SHA-256 as the challenge.
 */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )

  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) }
}

export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  resource: string
  scope: string | null
}): string {
  const url = new URL(input.authorizationEndpoint)

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('resource', input.resource)

  if (input.scope) {
    url.searchParams.set('scope', input.scope)
  } else {
    url.searchParams.delete('scope')
  }

  return url.toString()
}

async function readJsonObject(response: Response): Promise<JsonObject | null> {
  try {
    const parsed: unknown = JSON.parse(await response.text())

    return typeof parsed === 'object' && parsed !== null
      && !Array.isArray(parsed)
      ? parsed as JsonObject
      : null
  } catch {
    return null
  }
}

function isAuthMethod(
  value: unknown,
): value is ConnectorTokenEndpointAuthMethod {
  return TOKEN_ENDPOINT_AUTH_METHODS.includes(
    value as ConnectorTokenEndpointAuthMethod,
  )
}

/**
 * RFC 7591 dynamic client registration with the same metadata as the CIMD
 * document, asking for a public client. A server that answers with a
 * secret and `client_secret_basic` or `client_secret_post` is honored; the
 * secret is stored encrypted with the registration.
 */
export async function registerDynamicClient(input: {
  metadata: AuthorizationServerMetadata
  clientMetadata: ConnectorClientMetadataDocument
  resource: string
  logger?: LoggerLike
}): Promise<ConnectorClientRegistration> {
  if (!input.metadata.registrationEndpoint) {
    throw createConnectorError('CONNECTOR_OAUTH_NO_REGISTRATION')
  }

  const registrationRequest = Object.fromEntries(
    Object.entries(input.clientMetadata).filter(([key]) => {
      return key !== 'client_id'
    }),
  )
  const response = await safeFetch(input.metadata.registrationEndpoint, {
    purpose: 'oauth',
    method: 'POST',
    maxRedirects: NO_REDIRECTS,
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(registrationRequest),
    logger: input.logger,
  })
  const body = await readJsonObject(response)

  if (!response.ok || !body) {
    throw createConnectorError('CONNECTOR_OAUTH_REGISTRATION_FAILED')
  }

  const clientId = body.client_id
  const clientSecret = body.client_secret
  const authMethod = body.token_endpoint_auth_method ?? 'none'

  if (
    typeof clientId !== 'string'
    || !clientId
    || clientId.length > CLIENT_ID_MAX_LENGTH
    || !isAuthMethod(authMethod)
    || (authMethod !== 'none' && typeof clientSecret !== 'string')
  ) {
    throw createConnectorError('CONNECTOR_OAUTH_REGISTRATION_FAILED')
  }

  return {
    clientId,
    registrationKind: 'dcr',
    ...(authMethod !== 'none' ? { clientSecret: clientSecret as string } : {}),
    tokenEndpointAuthMethod: authMethod,
    redirectUri: input.clientMetadata.redirect_uris[0],
    tokenEndpoint: input.metadata.tokenEndpoint,
    revocationEndpoint: input.metadata.revocationEndpoint,
    resource: input.resource,
  }
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+')
}

function clientAuthentication(
  registration: ConnectorClientRegistration,
  form: URLSearchParams,
): Record<string, string> {
  const method = registration.tokenEndpointAuthMethod ?? 'none'

  if (method === 'client_secret_basic' && registration.clientSecret) {
    const credentials = `${formEncode(registration.clientId)}:`
      + formEncode(registration.clientSecret)

    return {
      authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
    }
  }

  form.set('client_id', registration.clientId)

  if (method === 'client_secret_post' && registration.clientSecret) {
    form.set('client_secret', registration.clientSecret)
  }

  return {}
}

function parseTokenResponse(
  body: JsonObject,
  now: number,
): ConnectorTokenSet | null {
  const accessToken = body.access_token
  const tokenType = body.token_type
  const refreshToken = body.refresh_token
  const expiresIn = body.expires_in
  const scope = body.scope

  if (
    typeof accessToken !== 'string'
    || !accessToken
    || accessToken.length > TOKEN_MAX_LENGTH
  ) {
    return null
  }

  if (
    tokenType !== undefined
    && (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer')
  ) {
    return null
  }

  const validRefreshToken = typeof refreshToken === 'string'
    && refreshToken.length > 0
    && refreshToken.length <= TOKEN_MAX_LENGTH
  const lifetimeSeconds = typeof expiresIn === 'number'
    ? expiresIn
    : typeof expiresIn === 'string' ? Number(expiresIn) : Number.NaN

  return {
    accessToken,
    refreshToken: validRefreshToken ? refreshToken : null,
    expiresAt: Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0
      ? new Date(now + lifetimeSeconds * 1000)
      : null,
    scope: typeof scope === 'string' ? scope : null,
  }
}

async function requestTokens(
  registration: ConnectorClientRegistration,
  tokenEndpoint: string,
  grant: Record<string, string>,
  logger?: LoggerLike,
): Promise<ConnectorTokenResult> {
  const form = new URLSearchParams(grant)
  const authHeaders = clientAuthentication(registration, form)
  const startedAt = Date.now()
  const response = await safeFetch(tokenEndpoint, {
    purpose: 'oauth',
    method: 'POST',
    maxRedirects: NO_REDIRECTS,
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      ...authHeaders,
    },
    body: form.toString(),
    logger,
  })
  const body = await readJsonObject(response)

  if (!response.ok || !body) {
    return { ok: false, invalidGrant: body?.error === 'invalid_grant' }
  }

  const tokens = parseTokenResponse(body, startedAt)

  return tokens ? { ok: true, tokens } : { ok: false, invalidGrant: false }
}

function requireTokenEndpoint(
  registration: ConnectorClientRegistration,
): string {
  if (!registration.tokenEndpoint) {
    throw createConnectorError('CONNECTOR_REAUTH_REQUIRED')
  }

  return registration.tokenEndpoint
}

/**
 * The authorization-code grant with the PKCE verifier, the exact redirect
 * URI of the authorization request and the RFC 8707 resource. The token
 * endpoint is never followed through a redirect, so the code and the
 * verifier reach only the endpoint the issuer published.
 */
export async function exchangeAuthorizationCode(input: {
  registration: ConnectorClientRegistration
  code: string
  codeVerifier: string
  redirectUri: string
  resource: string
  logger?: LoggerLike
}): Promise<ConnectorTokenResult> {
  return await requestTokens(
    input.registration,
    requireTokenEndpoint(input.registration),
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      resource: input.resource,
    },
    input.logger,
  )
}

export async function refreshAccessToken(input: {
  registration: ConnectorClientRegistration
  refreshToken: string
  logger?: LoggerLike
}): Promise<ConnectorTokenResult> {
  const grant: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  }

  if (input.registration.resource) {
    grant.resource = input.registration.resource
  }

  return await requestTokens(
    input.registration,
    requireTokenEndpoint(input.registration),
    grant,
    input.logger,
  )
}

/**
 * RFC 7009 revocation of one token. Best effort: returns whether the
 * server answered 200 and never throws, so a revocation failure never
 * blocks a disconnect or a delete.
 */
export async function revokeToken(input: {
  registration: ConnectorClientRegistration
  token: string
  tokenTypeHint: 'access_token' | 'refresh_token'
  signal?: AbortSignal
  logger?: LoggerLike
}): Promise<boolean> {
  const endpoint = input.registration.revocationEndpoint

  if (!endpoint) {
    return false
  }

  const form = new URLSearchParams({
    token: input.token,
    token_type_hint: input.tokenTypeHint,
  })
  const authHeaders = clientAuthentication(input.registration, form)

  try {
    const response = await safeFetch(endpoint, {
      purpose: 'oauth',
      method: 'POST',
      maxRedirects: NO_REDIRECTS,
      timeoutMs: CONNECTOR_REVOKE_TIMEOUT_MS,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...authHeaders,
      },
      body: form.toString(),
      signal: input.signal,
      logger: input.logger,
    })

    await response.body?.cancel().catch(() => undefined)

    return response.ok
  } catch {
    return false
  }
}
