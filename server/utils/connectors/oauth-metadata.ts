import {
  CONNECTOR_CONNECT_TIMEOUT_MS,
  CONNECTOR_SCOPE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFetch } from '~~/server/utils/net/safe-fetch'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

const PROTECTED_RESOURCE_WELL_KNOWN = '/.well-known/oauth-protected-resource'
const AUTHORIZATION_SERVER_WELL_KNOWN = '/.well-known/oauth-authorization-server'
const OPENID_CONFIGURATION_WELL_KNOWN = '/.well-known/openid-configuration'
const PKCE_METHOD = 'S256'
const PROBE_PROTOCOL_VERSION = '2025-06-18'
const CHALLENGE_PARAMETER
  = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g

export interface BearerChallenge {
  resourceMetadata: string | null
  scope: string | null
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
  revocationEndpoint: string | null
  clientIdMetadataDocumentSupported: boolean
  issParameterSupported: boolean
  tokenEndpointAuthMethods: string[] | null
}

export interface ConnectorOAuthDiscovery {
  resource: string
  issuer: string
  requestedScope: string | null
  metadata: AuthorizationServerMetadata
}

export type ConnectorAuthDiscovery
  = | { authType: 'none' }
    | { authType: 'header' }
    | { authType: 'oauth', oauth: ConnectorOAuthDiscovery }

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(object: JsonObject, key: string): string | null {
  const value = object[key]

  return typeof value === 'string' && value.length > 0 ? value : null
}

function readStringArray(object: JsonObject, key: string): string[] | null {
  const value = object[key]

  if (!Array.isArray(value)) {
    return null
  }

  return value.filter((item): item is string => {
    return typeof item === 'string' && item.length > 0
  })
}

function safeUrlOrNull(value: string | null): string | null {
  if (!value) {
    return null
  }

  const result = parseSafeOutboundUrl(value)

  return result.ok ? result.url.toString() : null
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeScope(scope: string | null): string | null {
  if (!scope) {
    return null
  }

  const normalized = scope.trim().split(/\s+/).filter(Boolean).join(' ')

  if (!normalized || normalized.length > CONNECTOR_SCOPE_MAX_LENGTH) {
    return null
  }

  return normalized
}

/**
 * Reads the `Bearer` challenge of a `WWW-Authenticate` header (RFC 6750,
 * RFC 9728 section 5.1): `resource_metadata` and `scope`. Other schemes and
 * parameters are ignored.
 */
export function parseBearerChallenge(
  header: string | null,
): BearerChallenge | null {
  if (!header) {
    return null
  }

  const bearerIndex = header.search(/(?:^|[\s,])Bearer(?:\s|$)/i)

  if (bearerIndex < 0) {
    return null
  }

  const parameters = new Map<string, string>()

  for (const match of header.slice(bearerIndex).matchAll(CHALLENGE_PARAMETER)) {
    const name = match[1]!.toLowerCase()

    if (!parameters.has(name)) {
      parameters.set(name, (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1'))
    }
  }

  return {
    resourceMetadata: parameters.get('resource_metadata') || null,
    scope: parameters.get('scope') || null,
  }
}

/**
 * Whether the resource a server names in its protected-resource metadata
 * covers the connector URL: same origin, and the connector path is the
 * resource path or below it on a segment boundary (the MCP SDK's rule).
 */
export function resourceCoversUrl(
  resource: string,
  serverUrl: string,
): boolean {
  let resourceUrl: URL
  let connectorUrl: URL

  try {
    resourceUrl = new URL(resource)
    connectorUrl = new URL(serverUrl)
  } catch {
    return false
  }

  if (resourceUrl.origin !== connectorUrl.origin || resourceUrl.search) {
    return false
  }

  const resourcePath = withoutTrailingSlash(resourceUrl.pathname)
  const connectorPath = withoutTrailingSlash(connectorUrl.pathname)

  return connectorPath === resourcePath
    || connectorPath.startsWith(`${resourcePath}/`)
}

async function fetchMetadataDocument(
  url: string,
  logger?: LoggerLike,
): Promise<JsonObject | null> {
  const response = await safeFetch(url, {
    purpose: 'oauth',
    headers: { accept: 'application/json' },
    logger,
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)

    return null
  }

  try {
    const parsed: unknown = JSON.parse(await response.text())

    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Sends one unauthenticated MCP `initialize` to the server (purpose `mcp`,
 * same-origin redirects only) and returns the status and the Bearer
 * challenge. No token and no chat data are sent.
 */
export async function probeConnectorServer(
  serverUrl: string,
  logger?: LoggerLike,
): Promise<{ status: number, challenge: BearerChallenge | null }> {
  const response = await safeFetch(serverUrl, {
    purpose: 'mcp',
    method: 'POST',
    timeoutMs: CONNECTOR_CONNECT_TIMEOUT_MS,
    headers: {
      'accept': 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROBE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Besidka', version: '1.0' },
      },
    }),
    logger,
  })

  await response.body?.cancel().catch(() => undefined)

  return {
    status: response.status,
    challenge: parseBearerChallenge(response.headers.get('www-authenticate')),
  }
}

function protectedResourceMetadataUrls(
  serverUrl: string,
  challenge: BearerChallenge | null,
): string[] {
  const url = new URL(serverUrl)
  const path = withoutTrailingSlash(url.pathname)
  const candidates: string[] = []

  if (challenge?.resourceMetadata) {
    candidates.push(challenge.resourceMetadata)
  }

  if (path) {
    candidates.push(`${url.origin}${PROTECTED_RESOURCE_WELL_KNOWN}${path}`)
  }

  candidates.push(`${url.origin}${PROTECTED_RESOURCE_WELL_KNOWN}`)

  return [...new Set(candidates)]
}

/**
 * RFC 9728 discovery: the `resource_metadata` URL from the challenge, then
 * the path-inserted and the root well-known URL on the server origin. Every
 * URL goes through `safeFetch`, so one pointing to a private or own host is
 * refused rather than skipped. Returns null when no candidate answers with
 * a metadata document.
 */
export async function fetchProtectedResourceMetadata(
  serverUrl: string,
  challenge: BearerChallenge | null,
  logger?: LoggerLike,
): Promise<JsonObject | null> {
  for (const candidate of protectedResourceMetadataUrls(serverUrl, challenge)) {
    const document = await fetchMetadataDocument(candidate, logger)

    if (document) {
      return document
    }
  }

  return null
}

function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer)
  const path = withoutTrailingSlash(url.pathname)

  if (!path) {
    return [
      `${url.origin}${AUTHORIZATION_SERVER_WELL_KNOWN}`,
      `${url.origin}${OPENID_CONFIGURATION_WELL_KNOWN}`,
    ]
  }

  return [
    `${url.origin}${AUTHORIZATION_SERVER_WELL_KNOWN}${path}`,
    `${url.origin}${OPENID_CONFIGURATION_WELL_KNOWN}${path}`,
    `${url.origin}${path}${OPENID_CONFIGURATION_WELL_KNOWN}`,
  ]
}

/**
 * Validates an RFC 8414 or OpenID Connect discovery document: `issuer`
 * must be the issuer it was fetched for (RFC 8414 section 3.3), the
 * endpoints must pass the outbound URL rules, and `S256` must be listed,
 * because the MCP authorization spec forbids proceeding without it.
 */
export function parseAuthorizationServerMetadata(
  document: JsonObject,
  expectedIssuer: string,
): AuthorizationServerMetadata {
  const issuer = readString(document, 'issuer')

  if (
    !issuer
    || withoutTrailingSlash(issuer) !== withoutTrailingSlash(expectedIssuer)
  ) {
    throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
  }

  const authorizationEndpoint = safeUrlOrNull(
    readString(document, 'authorization_endpoint'),
  )
  const tokenEndpoint = safeUrlOrNull(readString(document, 'token_endpoint'))

  if (!authorizationEndpoint || !tokenEndpoint) {
    throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
  }

  const responseTypes = readStringArray(document, 'response_types_supported')

  if (responseTypes && !responseTypes.includes('code')) {
    throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
  }

  const pkceMethods = readStringArray(
    document,
    'code_challenge_methods_supported',
  )

  if (!pkceMethods?.includes(PKCE_METHOD)) {
    throw createConnectorError('CONNECTOR_OAUTH_PKCE_UNSUPPORTED')
  }

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: safeUrlOrNull(
      readString(document, 'registration_endpoint'),
    ),
    revocationEndpoint: safeUrlOrNull(
      readString(document, 'revocation_endpoint'),
    ),
    clientIdMetadataDocumentSupported:
      document.client_id_metadata_document_supported === true,
    issParameterSupported:
      document.authorization_response_iss_parameter_supported === true,
    tokenEndpointAuthMethods: readStringArray(
      document,
      'token_endpoint_auth_methods_supported',
    ),
  }
}

export async function fetchAuthorizationServerMetadata(
  issuer: string,
  logger?: LoggerLike,
): Promise<AuthorizationServerMetadata> {
  for (const candidate of authorizationServerMetadataUrls(issuer)) {
    const document = await fetchMetadataDocument(candidate, logger)

    if (document) {
      return parseAuthorizationServerMetadata(document, issuer)
    }
  }

  throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
}

/**
 * From a protected-resource metadata document to everything the sign-in
 * needs: the resource indicator (RFC 8707; `resource` is required by RFC
 * 9728 and must cover the connector URL), the first authorization server
 * that passes the outbound URL rules, its validated metadata, and the scope
 * to ask for (the challenge's `scope`, else `scopes_supported`).
 */
export async function resolveOAuthDiscovery(
  serverUrl: string,
  protectedResource: JsonObject,
  challenge: BearerChallenge | null,
  logger?: LoggerLike,
): Promise<ConnectorOAuthDiscovery> {
  const resource = readString(protectedResource, 'resource')

  if (!resource || !resourceCoversUrl(resource, serverUrl)) {
    throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
  }

  const issuer = (readStringArray(protectedResource, 'authorization_servers')
    ?? []).find((candidate) => {
    return parseSafeOutboundUrl(candidate).ok
  })

  if (!issuer) {
    throw createConnectorError('CONNECTOR_OAUTH_METADATA_INVALID')
  }

  const metadata = await fetchAuthorizationServerMetadata(issuer, logger)
  const scopesSupported = readStringArray(protectedResource, 'scopes_supported')

  return {
    resource,
    issuer: metadata.issuer,
    requestedScope: normalizeScope(
      challenge?.scope ?? scopesSupported?.join(' ') ?? null,
    ),
    metadata,
  }
}

/**
 * The discovery step of the connect flow (docs/connectors.md section 5.2):
 * 2xx means no auth; 401 or 403 with protected-resource metadata means
 * OAuth; 401 or 403 without it means a header; anything else is an error.
 * With `allowOAuth: false` (a preset that takes a token only) a 401 or 403
 * means a header without any metadata request.
 */
export async function discoverConnectorAuth(
  serverUrl: string,
  logger?: LoggerLike,
  options: { allowOAuth?: boolean } = {},
): Promise<ConnectorAuthDiscovery> {
  const probe = await probeConnectorServer(serverUrl, logger)

  if (probe.status >= 200 && probe.status < 300) {
    return { authType: 'none' }
  }

  if (probe.status !== 401 && probe.status !== 403) {
    throw createConnectorError('CONNECTOR_DISCOVERY_FAILED')
  }

  if (options.allowOAuth === false) {
    return { authType: 'header' }
  }

  const protectedResource = await fetchProtectedResourceMetadata(
    serverUrl,
    probe.challenge,
    logger,
  )

  if (!protectedResource) {
    return { authType: 'header' }
  }

  return {
    authType: 'oauth',
    oauth: await resolveOAuthDiscovery(
      serverUrl,
      protectedResource,
      probe.challenge,
      logger,
    ),
  }
}
