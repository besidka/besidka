import type { KVNamespace } from '@cloudflare/workers-types'
import { CONNECTOR_OAUTH_CODE_MAX_LENGTH } from '#shared/utils/connectors-policy'
import {
  buildConnectorClientMetadata,
  connectorClientId,
  connectorRedirectUri,
} from '~~/server/utils/connectors/client-metadata'
import {
  assertConnectorConsent,
  issuerHostOf,
} from '~~/server/utils/connectors/consent'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
  registerDynamicClient,
} from '~~/server/utils/connectors/oauth-client'
import { discoverConnectorAuth } from '~~/server/utils/connectors/oauth-metadata'
import type {
  ConnectorOAuthDiscovery,
} from '~~/server/utils/connectors/oauth-metadata'
import {
  consumeConnectorOAuthState,
  saveConnectorOAuthState,
} from '~~/server/utils/connectors/oauth-state'
import {
  compareGrantedScope,
  degradedScopeNote,
} from '~~/server/utils/connectors/scopes'
import {
  getConnector,
  readConnectorCredentials,
  readConnectorUrl,
  replaceConnectorCredentials,
  updateConnector,
} from '~~/server/utils/connectors/store'
import type {
  ConnectorClientRegistration,
  ConnectorRecord,
} from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

type DbClient = ReturnType<typeof useDb>

export interface StartConnectorOAuthInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  connector: ConnectorRecord
  serverUrl: string
  origin: string
  logger?: LoggerLike
}

export interface ConnectorOAuthCallbackQuery {
  state: string | null
  code: string | null
  iss: string | null
  error: string | null
}

export interface CompleteConnectorOAuthInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  origin: string
  query: ConnectorOAuthCallbackQuery
  logger?: LoggerLike
}

export interface CompletedConnectorOAuth {
  connectorId: string
  degraded: boolean
}

function logStep(
  logger: LoggerLike | undefined,
  values: Record<string, string | boolean>,
) {
  logger?.set({ attributes: { connectors: values } })
}

async function resolveClientRegistration(
  input: StartConnectorOAuthInput,
  oauth: ConnectorOAuthDiscovery,
): Promise<ConnectorClientRegistration> {
  const redirectUri = connectorRedirectUri(input.origin)
  const endpoints = {
    redirectUri,
    tokenEndpoint: oauth.metadata.tokenEndpoint,
    revocationEndpoint: oauth.metadata.revocationEndpoint,
    resource: oauth.resource,
  }

  if (oauth.metadata.clientIdMetadataDocumentSupported) {
    return {
      clientId: connectorClientId(input.origin),
      registrationKind: 'cimd',
      tokenEndpointAuthMethod: 'none',
      ...endpoints,
    }
  }

  if (!oauth.metadata.registrationEndpoint) {
    throw createConnectorError('CONNECTOR_OAUTH_NO_REGISTRATION')
  }

  const stored = await readConnectorCredentials(
    input.db,
    input.userId,
    input.connector.id,
  )
  const storedRegistration = stored?.clientRegistration

  if (
    stored?.issuer === oauth.issuer
    && storedRegistration?.registrationKind === 'dcr'
    && storedRegistration.redirectUri === redirectUri
  ) {
    return { ...storedRegistration, ...endpoints }
  }

  return await registerDynamicClient({
    metadata: oauth.metadata,
    clientMetadata: buildConnectorClientMetadata(input.origin),
    resource: oauth.resource,
    logger: input.logger,
  })
}

/**
 * The OAuth start of the connect flow: discovery, the consent check for
 * the discovered issuer, client registration (CIMD when the issuer accepts
 * it, else DCR, reused while issuer and redirect URI stay the same), PKCE
 * S256 and a single-use state. Returns the authorization URL instead of
 * redirecting; the browser navigates there itself.
 */
export async function startConnectorOAuth(
  input: StartConnectorOAuthInput,
): Promise<{ authorizationUrl: string }> {
  const discovery = await discoverConnectorAuth(input.serverUrl, input.logger)

  if (discovery.authType !== 'oauth') {
    throw createConnectorError('CONNECTOR_OAUTH_UNSUPPORTED')
  }

  const { oauth } = discovery

  assertConnectorConsent(input.connector, issuerHostOf(oauth.issuer))

  const registration = await resolveClientRegistration(input, oauth)
  const pkce = await createPkcePair()
  const state = createOAuthState()

  await saveConnectorOAuthState(input.kv, state, {
    userId: input.userId,
    connectorId: input.connector.id,
    codeVerifier: pkce.verifier,
    issuer: oauth.issuer,
    issParameterRequired: oauth.metadata.issParameterSupported,
    resource: oauth.resource,
    requestedScope: oauth.requestedScope,
    redirectUri: connectorRedirectUri(input.origin),
    registration,
    createdAt: Date.now(),
  })

  logStep(input.logger, {
    step: 'oauth-start',
    registration: registration.registrationKind,
  })

  return {
    authorizationUrl: buildAuthorizationUrl({
      authorizationEndpoint: oauth.metadata.authorizationEndpoint,
      clientId: registration.clientId,
      redirectUri: connectorRedirectUri(input.origin),
      codeChallenge: pkce.challenge,
      state,
      resource: oauth.resource,
      scope: oauth.requestedScope,
    }),
  }
}

function isSameResource(resource: string, serverUrl: string | null): boolean {
  if (!serverUrl) {
    return false
  }

  const resourceUrl = parseSafeOutboundUrl(resource)

  return resourceUrl.ok && resourceUrl.url.origin === new URL(serverUrl).origin
}

/**
 * The OAuth callback: consumes the state (single use), then checks, in this
 * order, that it belongs to the signed-in user, that the callback arrived at
 * the exact redirect URI the flow started with, that the authorization
 * server returned a code, and that `iss` names the expected issuer (RFC
 * 9207: required when the issuer advertises it, compared whenever present).
 * Only then is the code exchanged, with the verifier and the resource. The
 * granted scope is compared with the requested one; a narrower grant keeps
 * the connector usable with a `degraded` note.
 */
export async function completeConnectorOAuth(
  input: CompleteConnectorOAuthInput,
): Promise<CompletedConnectorOAuth> {
  const state = input.query.state
    ? await consumeConnectorOAuthState(input.kv, input.query.state)
    : null

  if (!state || state.userId !== input.userId) {
    throw createConnectorError('CONNECTOR_OAUTH_STATE_INVALID')
  }

  logStep(input.logger, { id: state.connectorId, step: 'oauth-callback' })

  if (state.redirectUri !== connectorRedirectUri(input.origin)) {
    throw createConnectorError('CONNECTOR_OAUTH_REDIRECT_MISMATCH')
  }

  if (input.query.error || !input.query.code) {
    throw createConnectorError('CONNECTOR_OAUTH_DENIED')
  }

  if (input.query.code.length > CONNECTOR_OAUTH_CODE_MAX_LENGTH) {
    throw createConnectorError('CONNECTOR_OAUTH_TOKEN_FAILED')
  }

  if (
    (input.query.iss !== null && input.query.iss !== state.issuer)
    || (input.query.iss === null && state.issParameterRequired)
  ) {
    throw createConnectorError('CONNECTOR_OAUTH_ISSUER_MISMATCH')
  }

  const connector = await getConnector(
    input.db,
    input.userId,
    state.connectorId,
  )
  const serverUrl = connector
    ? await readConnectorUrl(input.db, input.userId, state.connectorId)
    : null

  if (!connector || !isSameResource(state.resource, serverUrl)) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  const result = await exchangeAuthorizationCode({
    registration: state.registration,
    code: input.query.code,
    codeVerifier: state.codeVerifier,
    redirectUri: state.redirectUri,
    resource: state.resource,
    logger: input.logger,
  })

  if (!result.ok) {
    throw createConnectorError('CONNECTOR_OAUTH_TOKEN_FAILED')
  }

  const scopes = compareGrantedScope(
    state.requestedScope,
    result.tokens.scope,
  )

  await replaceConnectorCredentials(input.db, {
    userId: input.userId,
    connectorId: state.connectorId,
    issuer: state.issuer,
    clientRegistration: state.registration,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    scope: scopes.grantedScope,
    expiresAt: result.tokens.expiresAt,
  })

  await updateConnector(input.db, input.userId, state.connectorId, {
    authType: 'oauth',
    status: 'ready',
    lastConnectedAt: new Date(),
    lastError: scopes.degraded ? degradedScopeNote() : null,
  })

  logStep(input.logger, {
    id: state.connectorId,
    step: 'oauth-connected',
    registration: state.registration.registrationKind,
    degraded: scopes.degraded,
  })

  return { connectorId: state.connectorId, degraded: scopes.degraded }
}
