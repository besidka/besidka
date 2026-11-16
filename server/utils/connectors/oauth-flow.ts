import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_CONSENT_ERROR_CODE,
  CONNECTOR_OAUTH_CODE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import type { ConnectorToolMode } from '#shared/utils/connectors-policy'
import type {
  ResolvedConnectorTarget,
} from '~~/server/utils/connectors/add'
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
import type {
  ConnectorOAuthDraft,
  ConnectorOAuthState,
} from '~~/server/utils/connectors/oauth-state'
import { revokeConnectorCredentials } from '~~/server/utils/connectors/revoke'
import {
  compareGrantedScope,
  degradedScopeNote,
} from '~~/server/utils/connectors/scopes'
import {
  assertConnectorCapacity,
  createConnector,
  deleteConnector,
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

export interface StartConnectorDraftOAuthInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  target: ResolvedConnectorTarget
  toolMode: ConnectorToolMode
  consent: { issuerHost: string | null, version: string }
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

interface AuthorizationStartInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  connectorId: string | null
  draft?: ConnectorOAuthDraft
  origin: string
  logger?: LoggerLike
}

async function resolveClientRegistration(
  input: AuthorizationStartInput,
  oauth: ConnectorOAuthDiscovery,
): Promise<ConnectorClientRegistration> {
  const redirectUri = connectorRedirectUri(input.origin)
  const endpoints = {
    redirectUri,
    tokenEndpoint: oauth.metadata.tokenEndpoint,
    revocationEndpoint: oauth.metadata.revocationEndpoint,
    resource: oauth.resource,
  }

  if (
    oauth.metadata.clientIdMetadataDocumentSupported
    && oauth.metadata.issParameterSupported
  ) {
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

  const stored = input.connectorId
    ? await readConnectorCredentials(
      input.db,
      input.userId,
      input.connectorId,
    )
    : null
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

async function beginAuthorization(
  input: AuthorizationStartInput,
  oauth: ConnectorOAuthDiscovery,
): Promise<{ authorizationUrl: string }> {
  const registration = await resolveClientRegistration(input, oauth)
  const pkce = await createPkcePair()
  const state = createOAuthState()

  await saveConnectorOAuthState(input.kv, state, {
    userId: input.userId,
    connectorId: input.connectorId,
    ...(input.draft ? { draft: input.draft } : {}),
    codeVerifier: pkce.verifier,
    issuer: oauth.issuer,
    issParameterRequired: oauth.metadata.issParameterSupported
      || registration.registrationKind === 'cimd',
    resource: oauth.resource,
    requestedScope: oauth.requestedScope,
    redirectUri: connectorRedirectUri(input.origin),
    registration,
    createdAt: Date.now(),
  })

  logStep(input.logger, {
    step: 'oauth-start',
    registration: registration.registrationKind,
    draft: !!input.draft,
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

/**
 * The OAuth start of the connect flow for a connector that exists:
 * discovery, the consent check for the discovered issuer, client
 * registration (CIMD when the issuer accepts it and sends RFC 9207 `iss`,
 * else DCR, reused while issuer and redirect URI stay the same), PKCE
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

  return await beginAuthorization({
    db: input.db,
    kv: input.kv,
    userId: input.userId,
    connectorId: input.connector.id,
    origin: input.origin,
    logger: input.logger,
  }, oauth)
}

/**
 * The OAuth start for a connector that does not exist yet. Nothing goes to
 * D1: the address, title, preset, tool mode and the consent the user ticked
 * wait in the encrypted KV state (ten minutes) and become a connector only
 * in the callback, after the token exchange succeeded. The consent is for
 * the issuer named on the screen; a different issuer at start refuses it.
 * Client registration is always fresh (there is no stored sign-in to reuse).
 */
export async function startConnectorDraftOAuth(
  input: StartConnectorDraftOAuthInput,
): Promise<{ authorizationUrl: string }> {
  await assertConnectorCapacity(input.db, input.userId)

  const discovery = await discoverConnectorAuth(
    input.target.url,
    input.logger,
    { allowOAuth: input.target.allowOAuth },
  )

  if (discovery.authType !== 'oauth') {
    throw createConnectorError('CONNECTOR_OAUTH_UNSUPPORTED')
  }

  const { oauth } = discovery
  const issuerHost = issuerHostOf(oauth.issuer)

  if (input.consent.issuerHost !== issuerHost) {
    throw createConnectorError(CONNECTOR_CONSENT_ERROR_CODE)
  }

  return await beginAuthorization({
    db: input.db,
    kv: input.kv,
    userId: input.userId,
    connectorId: null,
    draft: {
      url: input.target.url,
      title: input.target.title,
      presetId: input.target.presetId,
      slugBase: input.target.slugBase,
      createdVia: input.target.createdVia,
      toolMode: input.toolMode,
      consentIssuerHost: issuerHost,
      consentVersion: input.consent.version,
    },
    origin: input.origin,
    logger: input.logger,
  }, oauth)
}

function isSameResource(resource: string, serverUrl: string | null): boolean {
  if (!serverUrl) {
    return false
  }

  const resourceUrl = parseSafeOutboundUrl(resource)

  return resourceUrl.ok && resourceUrl.url.origin === new URL(serverUrl).origin
}

/**
 * Revokes the stored sign-in before a new code exchange, but only when the
 * new one comes from another issuer or another client. A re-authorization
 * with the same issuer and client keeps the old tokens untouched: an
 * authorization server that revokes per grant could otherwise kill the
 * tokens it is about to issue.
 */
async function revokeSupersededCredentials(
  input: CompleteConnectorOAuthInput,
  state: ConnectorOAuthState,
  connectorId: string,
): Promise<void> {
  const stored = await readConnectorCredentials(
    input.db,
    input.userId,
    connectorId,
  )

  if (
    !stored
    || (stored.issuer === state.issuer
      && stored.clientRegistration?.clientId === state.registration.clientId)
  ) {
    return
  }

  await revokeConnectorCredentials(stored, { logger: input.logger })
}

/**
 * The OAuth callback: consumes the state (single use), then checks, in this
 * order, that it belongs to the signed-in user, that the callback arrived at
 * the exact redirect URI the flow started with, that the authorization
 * server returned a code, and that `iss` names the expected issuer (RFC
 * 9207: required when the issuer advertises it, compared whenever present).
 * Only then, and while the consent still covers this issuer, is the code
 * exchanged, with the verifier and the resource. A CIMD flow always
 * requires `iss`: the public client id is used only with issuers that send
 * it, so an authorization-server mix-up is detectable. The granted scope is
 * compared with the requested one; a narrower grant keeps the connector
 * usable with a `degraded` note.
 *
 * A state with a `draft` is a new connector: the row, the credentials and
 * the consent are created here, and only here, after the exchange succeeded
 * (nothing was in D1 before). A state with a connector id is a sign-in of a
 * connector that exists (Reconnect, or one an app added over MCP): the new
 * sign-in replaces the stored one, and one from another issuer or client
 * revokes it first.
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

  logStep(input.logger, {
    ...(state.connectorId ? { id: state.connectorId } : {}),
    step: 'oauth-callback',
    draft: !!state.draft,
  })

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

  if (state.draft) {
    return await completeNewConnector(
      input,
      state,
      state.draft,
      input.query.code,
    )
  }

  if (!state.connectorId) {
    throw createConnectorError('CONNECTOR_OAUTH_STATE_INVALID')
  }

  return await completeExistingConnector(
    input,
    state,
    state.connectorId,
    input.query.code,
  )
}

async function completeExistingConnector(
  input: CompleteConnectorOAuthInput,
  state: ConnectorOAuthState,
  connectorId: string,
  code: string,
): Promise<CompletedConnectorOAuth> {
  const connector = await getConnector(
    input.db,
    input.userId,
    connectorId,
  )
  const serverUrl = connector
    ? await readConnectorUrl(input.db, input.userId, connectorId)
    : null

  if (!connector || !isSameResource(state.resource, serverUrl)) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  assertConnectorConsent(connector, issuerHostOf(state.issuer))

  await revokeSupersededCredentials(input, state, connectorId)

  const result = await exchangeAuthorizationCode({
    registration: state.registration,
    code,
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
    connectorId,
    issuer: state.issuer,
    clientRegistration: state.registration,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    scope: scopes.grantedScope,
    expiresAt: result.tokens.expiresAt,
  })

  await updateConnector(input.db, input.userId, connectorId, {
    authType: 'oauth',
    status: 'ready',
    lastConnectedAt: new Date(),
    lastError: scopes.degraded ? degradedScopeNote() : null,
  })

  logStep(input.logger, {
    id: connectorId,
    step: 'oauth-connected',
    registration: state.registration.registrationKind,
    degraded: scopes.degraded,
  })

  return { connectorId, degraded: scopes.degraded }
}

async function revokeFreshTokens(
  input: CompleteConnectorOAuthInput,
  state: ConnectorOAuthState,
  tokens: {
    accessToken: string
    refreshToken: string | null
    scope: string | null
    expiresAt: Date | null
  },
): Promise<void> {
  await revokeConnectorCredentials({
    connectorId: '',
    issuer: state.issuer,
    clientRegistration: state.registration,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    headerName: null,
    headerValue: null,
    scope: tokens.scope,
    expiresAt: tokens.expiresAt,
    updatedAt: new Date(),
    generation: '',
  }, { logger: input.logger })
}

async function completeNewConnector(
  input: CompleteConnectorOAuthInput,
  state: ConnectorOAuthState,
  draft: ConnectorOAuthDraft,
  code: string,
): Promise<CompletedConnectorOAuth> {
  if (
    !isSameResource(state.resource, draft.url)
    || draft.consentIssuerHost !== issuerHostOf(state.issuer)
  ) {
    throw createConnectorError('CONNECTOR_OAUTH_STATE_INVALID')
  }

  await assertConnectorCapacity(input.db, input.userId)

  const result = await exchangeAuthorizationCode({
    registration: state.registration,
    code,
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
  const tokens = {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    scope: scopes.grantedScope,
    expiresAt: result.tokens.expiresAt,
  }
  let connectorId: string | null = null

  try {
    const connector = await createConnector(input.db, {
      userId: input.userId,
      title: draft.title,
      url: draft.url,
      slugBase: draft.slugBase,
      createdVia: draft.createdVia,
      presetId: draft.presetId,
      connected: {
        authType: 'oauth',
        consent: {
          issuerHost: draft.consentIssuerHost,
          version: draft.consentVersion,
          givenAt: new Date(),
        },
        toolMode: draft.toolMode,
        lastError: scopes.degraded ? degradedScopeNote() : null,
      },
    })

    connectorId = connector.id

    await replaceConnectorCredentials(input.db, {
      userId: input.userId,
      connectorId,
      issuer: state.issuer,
      clientRegistration: state.registration,
      ...tokens,
    })
  } catch (exception) {
    if (connectorId) {
      await deleteConnector(input.db, input.userId, connectorId, input.logger)
    }

    await revokeFreshTokens(input, state, tokens)

    throw exception
  }

  logStep(input.logger, {
    id: connectorId,
    step: 'oauth-connected',
    registration: state.registration.registrationKind,
    degraded: scopes.degraded,
    stored: true,
  })

  input.logger?.set({
    attributes: {
      legalConsent: {
        action: 'connector-granted',
        connectorId,
        host: new URL(draft.url).host,
        issuerHost: draft.consentIssuerHost,
        version: draft.consentVersion,
      },
    },
  })

  return { connectorId, degraded: scopes.degraded }
}
