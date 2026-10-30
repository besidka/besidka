import type { JSONWebKeySet, JWK, JWTPayload } from 'jose'
import { errors as joseErrors } from 'jose'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  MCP_SERVER_ROUTE,
} from '~~/config/mcp-server'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

export const DEFAULT_MCP_SITE_URL = 'https://besidka.com'

export const MCP_JWKS_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000

export const MCP_ACCESS_TOKEN_TYPE = 'at+jwt'

export const MCP_ACCESS_TOKEN_ALGORITHMS = [
  'EdDSA',
  'ES256',
  'ES512',
  'PS256',
  'RS256',
]

const DEFAULT_JWK_ALGORITHM = 'EdDSA'
const BEARER_AUTHORIZATION = /^Bearer[ \t]+([A-Za-z0-9\-._~+/]+=*)[ \t]*$/i
const BEARER_SCHEME = /^Bearer(?:[ \t]|$)/i
const POSITIVE_INTEGER = /^[1-9]\d{0,15}$/
const OAUTH_SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/
const MCP_JWKS_CACHE_KEY = {}

export type McpScopeSource = 'token' | 'consent' | 'token_fallback'

export interface McpAuthContext {
  userId: number
  clientId: string
  scopes: string[]
  scopeSource?: McpScopeSource
}

export interface McpPrincipalStatus {
  isActive: boolean
  consentScopes: string[]
}

export interface McpEffectiveScopes {
  scopes: string[]
  source: McpScopeSource
}

export type McpTokenVerification
  = | { status: 'valid', auth: McpAuthContext }
    | { status: 'invalid', reason: string }
    | { status: 'unavailable', reason: string }

export interface McpJwksRow {
  id: number | string
  publicKey: string
  alg: string | null
  crv: string | null
  expiresAt: Date | null
}

export interface McpOpaqueAccessTokenRow {
  userId: number | null
  clientId: string
  scopes: unknown
  resources: unknown
  expiresAt: Date
  revoked: Date | null
  confirmation: unknown
  sessionId: number | null
  sessionExpiresAt: Date | null
}

export interface McpTokenVerifierDependencies {
  issuer: string
  audience: string
  loadJwks: () => Promise<JSONWebKeySet>
  findOpaqueAccessToken: (
    tokenHash: string,
  ) => Promise<McpOpaqueAccessTokenRow | null>
  resolvePrincipal: (
    userId: number,
    clientId: string,
  ) => Promise<McpPrincipalStatus>
  jwksCacheKey?: object
  now?: () => number
}

type McpTokenClaimsResult
  = | { status: 'claims', auth: McpAuthContext }
    | Exclude<McpTokenVerification, { status: 'valid' }>

export function resolveMcpSiteUrl(): string {
  const { baseUrl } = useRuntimeConfig().public

  return typeof baseUrl === 'string' && baseUrl
    ? baseUrl
    : DEFAULT_MCP_SITE_URL
}

export function resolveMcpResourceUrl(siteUrl: string): string {
  return `${siteUrl}${MCP_SERVER_ROUTE}`
}

export function resolveMcpResourceMetadataUrl(siteUrl: string): string {
  return `${new URL(siteUrl).origin}${MCP_PROTECTED_RESOURCE_METADATA_PATH}`
}

export function toMcpJsonWebKeySet(
  rows: McpJwksRow[],
  now: number = Date.now(),
): JSONWebKeySet {
  const keys = rows
    .filter((row) => {
      return !row.expiresAt
        || row.expiresAt.getTime() + MCP_JWKS_GRACE_PERIOD_MS > now
    })
    .flatMap((row): JWK[] => {
      try {
        const publicKey = JSON.parse(row.publicKey) as JWK

        return [{
          alg: row.alg ?? DEFAULT_JWK_ALGORITHM,
          ...(row.crv ? { crv: row.crv } : {}),
          ...publicKey,
          kid: String(row.id),
        }]
      } catch {
        return []
      }
    })

  return { keys }
}

export async function loadMcpJwksFromDatabase(): Promise<JSONWebKeySet> {
  const rows = await useDb()
    .select({
      id: schema.jwkss.id,
      publicKey: schema.jwkss.publicKey,
      alg: schema.jwkss.alg,
      crv: schema.jwkss.crv,
      expiresAt: schema.jwkss.expiresAt,
    })
    .from(schema.jwkss)

  return toMcpJsonWebKeySet(rows)
}

export async function resolveMcpPrincipal(
  userId: number,
  clientId: string,
): Promise<McpPrincipalStatus> {
  const db = useDb()
  const [users, clients, consents] = await db.batch([
    db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    db.select({ disabled: schema.oauthClients.disabled })
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, clientId))
      .limit(1),
    db.select({ scopes: schema.oauthConsents.scopes })
      .from(schema.oauthConsents)
      .where(and(
        eq(schema.oauthConsents.userId, userId),
        eq(schema.oauthConsents.clientId, clientId),
      ))
      .limit(1),
  ])
  const client = clients[0]
  const isActive = users.length > 0
    && Boolean(client)
    && client?.disabled !== true
    && consents.length > 0

  return {
    isActive,
    consentScopes: isActive ? parseStoredOAuthScopes(consents[0]?.scopes) : [],
  }
}

export async function isMcpPrincipalActive(
  userId: number,
  clientId: string,
): Promise<boolean> {
  const principal = await resolveMcpPrincipal(userId, clientId)

  return principal.isActive
}

/**
 * The consent row is the ceiling of what a connected app may do: the
 * effective scopes are the token's scopes intersected with the consent's,
 * never the consent alone. A narrow token cannot gain a scope because the
 * user's consent is wider, and widening stays inside the OAuth flow, where
 * the approval screen shows the new options. A consent that holds no
 * readable scope (a legacy row, or one whose stored list cannot be parsed)
 * does not narrow anything: the token's scopes stand and the source is
 * `token_fallback`. Narrowing through the connected-apps API never writes
 * an empty list, so that fallback cannot widen a deliberate narrowing.
 */
export function resolveEffectiveMcpScopes(
  tokenScopes: readonly string[],
  consentScopes: readonly string[],
): McpEffectiveScopes {
  if (consentScopes.length === 0) {
    return { scopes: [...tokenScopes], source: 'token_fallback' }
  }

  const consented = new Set(consentScopes)
  const scopes = tokenScopes.filter((scope) => {
    return consented.has(scope)
  })

  return {
    scopes,
    source: scopes.length < tokenScopes.length ? 'consent' : 'token',
  }
}

/**
 * The same digest `@better-auth/oauth-provider` stores for an opaque access
 * token with the default `storeTokens: 'hashed'`: base64url SHA-256, no
 * padding.
 */
export async function hashMcpOpaqueAccessToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  ))
  let binary = ''

  for (const byte of digest) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function findMcpOpaqueAccessToken(
  tokenHash: string,
): Promise<McpOpaqueAccessTokenRow | null> {
  const row = await useDb()
    .select({
      userId: schema.oauthAccessTokens.userId,
      clientId: schema.oauthAccessTokens.clientId,
      scopes: schema.oauthAccessTokens.scopes,
      resources: schema.oauthAccessTokens.resources,
      expiresAt: schema.oauthAccessTokens.expiresAt,
      revoked: schema.oauthAccessTokens.revoked,
      confirmation: schema.oauthAccessTokens.confirmation,
      sessionId: schema.oauthAccessTokens.sessionId,
      sessionExpiresAt: schema.sessions.expiresAt,
    })
    .from(schema.oauthAccessTokens)
    .leftJoin(
      schema.sessions,
      eq(schema.sessions.id, schema.oauthAccessTokens.sessionId),
    )
    .where(eq(schema.oauthAccessTokens.token, tokenHash))
    .get()

  return row ?? null
}

export function createMcpTokenVerifierDependencies(
): McpTokenVerifierDependencies {
  const siteUrl = resolveMcpSiteUrl()

  return {
    issuer: siteUrl,
    audience: resolveMcpResourceUrl(siteUrl),
    loadJwks: loadMcpJwksFromDatabase,
    findOpaqueAccessToken: findMcpOpaqueAccessToken,
    resolvePrincipal: resolveMcpPrincipal,
  }
}

export function hasBearerScheme(
  authorization: string | null | undefined,
): authorization is string {
  return typeof authorization === 'string'
    && BEARER_SCHEME.test(authorization)
}

export function parseBearerToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) {
    return null
  }

  const match = BEARER_AUTHORIZATION.exec(authorization)

  return match?.[1] ?? null
}

export function parseMcpUserId(subject: unknown): number | null {
  const value = typeof subject === 'number' ? String(subject) : subject

  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) {
    return null
  }

  const userId = Number(value)

  return Number.isSafeInteger(userId) ? userId : null
}

export function parseMcpScopes(scope: unknown): string[] | null {
  if (scope === undefined) {
    return []
  }

  if (typeof scope !== 'string') {
    return null
  }

  const scopes = scope.split(' ').filter(Boolean)

  if (!scopes.every(token => OAUTH_SCOPE_TOKEN.test(token))) {
    return null
  }

  return [...new Set(scopes)]
}

function readClientId(payload: JWTPayload): string | null {
  const clientId = payload.azp ?? payload.client_id

  return typeof clientId === 'string' && clientId.length > 0
    ? clientId
    : null
}

function isSenderConstrained(payload: JWTPayload): boolean {
  const confirmation = payload.cnf

  return Boolean(confirmation && typeof confirmation === 'object')
}

function isJwksInfrastructureError(exception: unknown): boolean {
  return exception instanceof joseErrors.JWKSTimeout
    || exception instanceof joseErrors.JWKSInvalid
    || exception instanceof joseErrors.JWKSMultipleMatchingKeys
}

function toInvalidReason(exception: unknown): string {
  if (exception instanceof joseErrors.JWTExpired) {
    return 'expired'
  }

  if (exception instanceof joseErrors.JOSEError) {
    return exception.code
  }

  return 'malformed'
}

function isCompactJwt(token: string): boolean {
  return token.split('.').length === 3
}

function toStringArray(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    return null
  }

  return value.every(item => typeof item === 'string') ? value : null
}

function isStoredScopeShape(value: unknown): boolean {
  return value === null
    || value === undefined
    || typeof value === 'string'
    || Array.isArray(value)
}

async function verifyJwtAccessToken(
  token: string,
  dependencies: McpTokenVerifierDependencies,
): Promise<McpTokenClaimsResult> {
  let jwksLoadFailed = false
  const jwksFetch = async () => {
    try {
      return await dependencies.loadJwks()
    } catch (exception) {
      jwksLoadFailed = true

      throw exception
    }
  }
  let payload: JWTPayload

  try {
    payload = await verifyJwsAccessToken(token, {
      jwksFetch,
      jwksCacheKey: dependencies.jwksCacheKey ?? MCP_JWKS_CACHE_KEY,
      verifyOptions: {
        issuer: dependencies.issuer,
        audience: dependencies.audience,
        algorithms: MCP_ACCESS_TOKEN_ALGORITHMS,
        typ: MCP_ACCESS_TOKEN_TYPE,
        requiredClaims: ['azp', 'sub', 'exp'],
        ...(dependencies.now
          ? { currentDate: new Date(dependencies.now()) }
          : {}),
      },
    })
  } catch (exception) {
    if (jwksLoadFailed || isJwksInfrastructureError(exception)) {
      return { status: 'unavailable', reason: 'jwks' }
    }

    return { status: 'invalid', reason: toInvalidReason(exception) }
  }

  if (isSenderConstrained(payload)) {
    return { status: 'invalid', reason: 'sender-constrained' }
  }

  if (payload.sub === payload.azp) {
    return { status: 'invalid', reason: 'subject' }
  }

  const userId = parseMcpUserId(payload.sub)
  const clientId = readClientId(payload)
  const scopes = parseMcpScopes(payload.scope)

  if (userId === null) {
    return { status: 'invalid', reason: 'subject' }
  }

  if (clientId === null) {
    return { status: 'invalid', reason: 'client' }
  }

  if (scopes === null) {
    return { status: 'invalid', reason: 'scope' }
  }

  return { status: 'claims', auth: { userId, clientId, scopes } }
}

/**
 * Applies the checks of the provider's own opaque-token introspection to a
 * stored row. A token bound to resources must name the MCP resource; a token
 * with no resources (a client that sent no RFC 8707 `resource`) is accepted,
 * because Besidka is the only resource server its scopes mean anything to,
 * and every tool still needs its resource scope.
 */
export function evaluateMcpOpaqueAccessToken(
  row: McpOpaqueAccessTokenRow | null,
  options: { audience: string, now: number },
): McpTokenClaimsResult {
  if (!row) {
    return { status: 'invalid', reason: 'unknown-token' }
  }

  if (row.revoked) {
    return { status: 'invalid', reason: 'revoked' }
  }

  if (row.expiresAt.getTime() <= options.now) {
    return { status: 'invalid', reason: 'expired' }
  }

  if (row.confirmation) {
    return { status: 'invalid', reason: 'sender-constrained' }
  }

  if (
    row.sessionId !== null
    && (!row.sessionExpiresAt
      || row.sessionExpiresAt.getTime() <= options.now)
  ) {
    return { status: 'invalid', reason: 'session' }
  }

  const resources = toStringArray(row.resources)

  if (
    resources === null
    || (resources.length > 0 && !resources.includes(options.audience))
  ) {
    return { status: 'invalid', reason: 'audience' }
  }

  const userId = parseMcpUserId(row.userId)

  if (userId === null) {
    return { status: 'invalid', reason: 'subject' }
  }

  if (!isStoredScopeShape(row.scopes)) {
    return { status: 'invalid', reason: 'scope' }
  }

  return {
    status: 'claims',
    auth: {
      userId,
      clientId: row.clientId,
      scopes: parseStoredOAuthScopes(row.scopes),
    },
  }
}

async function verifyOpaqueAccessToken(
  token: string,
  dependencies: McpTokenVerifierDependencies,
): Promise<McpTokenClaimsResult> {
  let row: McpOpaqueAccessTokenRow | null

  try {
    row = await dependencies.findOpaqueAccessToken(
      await hashMcpOpaqueAccessToken(token),
    )
  } catch {
    return { status: 'unavailable', reason: 'opaque-token' }
  }

  return evaluateMcpOpaqueAccessToken(row, {
    audience: dependencies.audience,
    now: dependencies.now ? dependencies.now() : Date.now(),
  })
}

/**
 * Verifies an MCP bearer access token. A JWT (issued when the client sent
 * RFC 8707 `resource`) is verified locally against the `jwks` table with
 * the claim rules of `@better-auth/mcp` `requireMcpAuth` (issuer, audience,
 * expiry, required `azp`). Any other token is looked up as an opaque token
 * in `oauth_access_tokens`. Both paths then check that the user still exists
 * and the OAuth client is not disabled.
 */
export async function verifyMcpAccessToken(
  authorization: string,
  dependencies: McpTokenVerifierDependencies,
): Promise<McpTokenVerification> {
  const token = parseBearerToken(authorization)

  if (!token) {
    return { status: 'invalid', reason: 'scheme' }
  }

  const claims = isCompactJwt(token)
    ? await verifyJwtAccessToken(token, dependencies)
    : await verifyOpaqueAccessToken(token, dependencies)

  if (claims.status !== 'claims') {
    return claims
  }

  const { userId, clientId } = claims.auth
  let principal: McpPrincipalStatus

  try {
    principal = await dependencies.resolvePrincipal(userId, clientId)
  } catch {
    return { status: 'unavailable', reason: 'principal' }
  }

  if (!principal.isActive) {
    return { status: 'invalid', reason: 'principal' }
  }

  const effective = resolveEffectiveMcpScopes(
    claims.auth.scopes,
    principal.consentScopes,
  )

  return {
    status: 'valid',
    auth: {
      ...claims.auth,
      scopes: effective.scopes,
      scopeSource: effective.source,
    },
  }
}

const FIRST_PRINTABLE_CODE = 0x20
const DELETE_CODE = 0x7F

function isPrintableCharacter(character: string): boolean {
  const code = character.charCodeAt(0)

  return code >= FIRST_PRINTABLE_CODE && code !== DELETE_CODE
}

function quoteChallengeValue(value: string): string {
  return [...value]
    .filter(isPrintableCharacter)
    .join('')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

export interface McpBearerChallengeInput {
  resourceMetadataUrl: string
  scopes?: readonly string[]
  error?: 'invalid_token' | 'insufficient_scope'
  description?: string
}

export function buildMcpBearerChallenge(
  input: McpBearerChallengeInput,
): string {
  const scope = [...new Set(input.scopes ?? [])].join(' ')
  const parameters = [
    input.error ? `error="${input.error}"` : null,
    scope ? `scope="${quoteChallengeValue(scope)}"` : null,
    `resource_metadata="${quoteChallengeValue(input.resourceMetadataUrl)}"`,
    input.description
      ? `error_description="${quoteChallengeValue(input.description)}"`
      : null,
  ].filter(Boolean)

  return `Bearer ${parameters.join(', ')}`
}
