import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import type { GoogleConnectResult } from '#shared/utils/google-connections'
import { hasScopes } from '#shared/utils/google-scopes'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import {
  createOAuthState,
  createPkcePair,
} from '~~/server/utils/connectors/oauth-client'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { deleteGoogleDerivedFiles } from '~~/server/utils/google/access-ended'
import {
  buildGoogleRedirectUri,
  filterByoCapabilityScopes,
  getConnectionScopes,
  requiredConnectionScopes,
  resolveGoogleClient,
} from '~~/server/utils/google/client'
import type { GoogleFetchOptions } from '~~/server/utils/google/http'
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  readGoogleIdentity,
  revokeGoogleToken,
} from '~~/server/utils/google/oauth'
import type { GoogleTokenSet } from '~~/server/utils/google/oauth'
import { saveGoogleOAuthState } from '~~/server/utils/google/oauth-state'
import type { GoogleOAuthState } from '~~/server/utils/google/oauth-state'
import {
  deleteRevokedGoogleConnection,
  markGoogleConnectionRevoked,
} from '~~/server/utils/google/store'
import {
  readGoogleConnectionTokenState,
  revokeStoredGoogleConnection,
  saveGoogleConnection,
} from '~~/server/utils/google/tokens'

type DbClient = ReturnType<typeof useDb>
type FileStorage = Pick<R2Bucket, 'delete'>

export class GoogleConnectionError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export type GoogleCompletion
  = | { kind: 'done', result: GoogleConnectResult }
    | { kind: 'restart-with-consent' }

function logConnection(logger: LoggerLike, values: Record<string, unknown>) {
  logger.set({ attributes: { google: values } })
}

/**
 * Creates the single-use state (KV, ten minutes, bound to the user and the
 * client mode, holding the PKCE verifier, the exact redirect URI, the
 * checked return path and, for the bring-your-own client, the capability
 * scopes the owner asked for) and returns Google's consent URL. Consent is
 * asked again when no refresh token is stored for the mode or when the
 * caller forces it; a reconnect passes the stored Google subject as
 * `login_hint`, never the email.
 */
export async function startGoogleConnection(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  clientMode: GoogleClientMode
  origin: string
  returnTo: string
  logger: LoggerLike
  capabilityScopes?: readonly string[]
  forceConsent?: boolean
  now?: number
}): Promise<{ authorizationUrl: string }> {
  const client = await resolveGoogleClient(input.clientMode, {
    db: input.db,
    userId: input.userId,
    kv: input.kv,
    logger: input.logger,
  })
  const requestedScopes = input.clientMode === 'byo'
    ? filterByoCapabilityScopes(input.capabilityScopes ?? [])
    : undefined

  if (requestedScopes?.length === 0) {
    throw new GoogleConnectionError('GOOGLE_NO_CAPABILITY')
  }

  const redirectUri = buildGoogleRedirectUri(input.origin, input.clientMode)
  const existing = await readGoogleConnectionTokenState(
    input.db,
    input.userId,
    input.clientMode,
  )
  const forcedConsent = input.forceConsent === true
  const promptConsent = forcedConsent || !existing?.hasRefreshToken
  const state = createOAuthState()
  const pkce = await createPkcePair()

  await saveGoogleOAuthState(input.kv, state, {
    userId: input.userId,
    clientMode: input.clientMode,
    codeVerifier: pkce.verifier,
    redirectUri,
    returnTo: input.returnTo,
    forcedConsent,
    createdAt: input.now ?? Date.now(),
    ...(requestedScopes ? { requestedScopes } : {}),
  })

  logConnection(input.logger, {
    step: 'start',
    clientMode: input.clientMode,
    reconnect: !!existing,
    promptConsent,
    forcedConsent,
    dedicatedClient: client.dedicated,
    requestedScopeCount: requestedScopes?.length ?? null,
  })

  return {
    authorizationUrl: buildGoogleAuthorizationUrl({
      client,
      redirectUri,
      scopes: getConnectionScopes(input.clientMode, requestedScopes),
      state,
      codeChallenge: pkce.challenge,
      loginHint: forcedConsent ? null : existing?.googleSubject ?? null,
      promptConsent,
    }),
  }
}

async function revokeFreshTokens(
  tokens: GoogleTokenSet,
  fetchOptions?: GoogleFetchOptions,
): Promise<void> {
  await revokeGoogleToken(
    tokens.refreshToken ?? tokens.accessToken,
    fetchOptions,
  )
}

/**
 * Finishes a connection after the callback checked the state: exchanges
 * the code with the PKCE verifier and the stored redirect URI, refuses a
 * grant without `drive.file` on Besidka's client, or without any of the
 * requested capability scopes on the bring-your-own client (revoking the
 * fresh tokens). A bring-your-own grant that holds only some of them is
 * saved with exactly the scopes Google granted and reported as `partial`,
 * never as a full connection. It reads the Google
 * account from the ID token and saves the connection. Nothing is changed
 * before the grant is known to be usable: when Google sent no refresh token
 * and none can be kept, the user is sent back to Google once with
 * `prompt=consent` instead. Only then does a different Google account
 * replace the old one: its grant is revoked and its copies are deleted
 * first, and if that cleanup cannot finish the new grant is revoked.
 */
export async function completeGoogleConnection(input: {
  db: DbClient
  oauthState: GoogleOAuthState
  code: string
  logger: LoggerLike
  storage?: FileStorage
  fetchOptions?: GoogleFetchOptions
  now?: number
}): Promise<GoogleCompletion> {
  const { db, oauthState, logger } = input
  const now = input.now ?? Date.now()
  const requiredScopes = requiredConnectionScopes(
    oauthState.clientMode,
    oauthState.requestedScopes,
  )

  if (requiredScopes.length === 0) {
    throw new GoogleConnectionError('GOOGLE_STATE_SCOPES_INVALID')
  }

  const client = await resolveGoogleClient(oauthState.clientMode, {
    db,
    userId: oauthState.userId,
    logger,
  })
  const exchange = await exchangeGoogleCode({
    client,
    code: input.code,
    codeVerifier: oauthState.codeVerifier,
    redirectUri: oauthState.redirectUri,
    now,
  }, input.fetchOptions)

  if (!exchange.ok) {
    logConnection(logger, {
      step: 'exchange',
      googleError: exchange.error ?? 'unknown',
    })

    throw new GoogleConnectionError('GOOGLE_TOKEN_FAILED')
  }

  const { tokens } = exchange
  const grantedRequired = requiredScopes.filter((scope) => {
    return hasScopes(tokens.scopes, [scope])
  })
  const isPartial = grantedRequired.length < requiredScopes.length
  const isUsable = oauthState.clientMode === 'byo'
    ? grantedRequired.length > 0
    : !isPartial

  if (!isUsable) {
    await revokeFreshTokens(tokens, input.fetchOptions)
    logConnection(logger, {
      step: 'scopes',
      outcome: 'missing_scope',
      grantedScopeCount: tokens.scopes.length,
    })

    return { kind: 'done', result: 'missing_scope' }
  }

  const identity = readGoogleIdentity(tokens.idToken, client.clientId, now)

  if (!identity) {
    await revokeFreshTokens(tokens, input.fetchOptions)

    throw new GoogleConnectionError('GOOGLE_IDENTITY_INVALID')
  }

  const existing = await readGoogleConnectionTokenState(
    db,
    oauthState.userId,
    oauthState.clientMode,
  )
  const isSameAccount = existing?.googleSubject === identity.subject
  const canKeepRefreshToken = isSameAccount && !!existing?.hasRefreshToken

  if (!tokens.refreshToken && !canKeepRefreshToken) {
    logConnection(logger, {
      step: 'refresh-token',
      outcome: oauthState.forcedConsent ? 'missing' : 'restart',
      differentAccount: !!existing && !isSameAccount,
    })

    if (oauthState.forcedConsent) {
      throw new GoogleConnectionError('GOOGLE_NO_REFRESH_TOKEN')
    }

    return { kind: 'restart-with-consent' }
  }

  if (existing && !isSameAccount) {
    await replaceDifferentAccount(input, existing.id, tokens, now)
  }

  const connectionId = await saveGoogleConnection(db, {
    userId: oauthState.userId,
    clientMode: oauthState.clientMode,
    subject: identity.subject,
    email: identity.email,
    scopes: tokens.scopes,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
  })

  logConnection(logger, {
    step: 'connected',
    connectionId,
    clientMode: oauthState.clientMode,
    replacedAccount: !!existing && !isSameAccount,
    grantedScopeCount: tokens.scopes.length,
    partial: isPartial,
  })

  return { kind: 'done', result: isPartial ? 'partial' : 'connected' }
}

async function replaceDifferentAccount(
  input: {
    db: DbClient
    oauthState: GoogleOAuthState
    logger: LoggerLike
    storage?: FileStorage
    fetchOptions?: GoogleFetchOptions
  },
  connectionId: string,
  freshTokens: GoogleTokenSet,
  now: number,
): Promise<void> {
  const { db, oauthState, logger } = input

  await revokeStoredGoogleConnection(
    db,
    oauthState.userId,
    oauthState.clientMode,
    { fetchOptions: input.fetchOptions, logger },
  )
  await markGoogleConnectionRevoked(db, connectionId)

  let complete = false

  try {
    const cleanup = await deleteGoogleDerivedFiles({
      db,
      userId: oauthState.userId,
      createdBefore: new Date(now),
      logger,
      storage: input.storage,
    })

    complete = cleanup.complete
  } catch (exception) {
    logConnection(logger, {
      step: 'replace-cleanup',
      connectionId,
      error: exceptionMessage(exception),
    })
  }

  if (!complete) {
    await revokeFreshTokens(freshTokens, input.fetchOptions)

    throw new GoogleConnectionError('GOOGLE_CLEANUP_PENDING')
  }
}

export interface GoogleDisconnectResult {
  disconnected: boolean
  revoked: boolean
  filesDeleted: number
  filesPending: boolean
}

/**
 * Disconnects one client mode: revokes the grant at Google (best effort;
 * a failure is logged with ids only and reported to the caller), clears
 * the tokens and marks the row `revoked`, deletes the Google copies made
 * before this moment, and deletes the row only when that cleanup finished
 * and the row is still `revoked`. Otherwise the row stays for the hourly
 * sweep, which finishes the cleanup and removes it.
 */
export async function disconnectGoogleConnection(input: {
  db: DbClient
  userId: number
  clientMode: GoogleClientMode
  logger: LoggerLike
  storage?: FileStorage
  fetchOptions?: GoogleFetchOptions
  now?: number
}): Promise<GoogleDisconnectResult> {
  const { db, userId, clientMode, logger } = input
  const revocation = await revokeStoredGoogleConnection(
    db,
    userId,
    clientMode,
    { fetchOptions: input.fetchOptions, logger },
  )

  if (!revocation.connectionId) {
    return {
      disconnected: false,
      revoked: false,
      filesDeleted: 0,
      filesPending: false,
    }
  }

  const connectionId = revocation.connectionId
  const endedAt = new Date(input.now ?? Date.now())

  await markGoogleConnectionRevoked(db, connectionId)

  let filesDeleted = 0
  let complete = false

  try {
    const cleanup = await deleteGoogleDerivedFiles({
      db,
      userId,
      createdBefore: endedAt,
      logger,
      storage: input.storage,
    })

    filesDeleted = cleanup.deleted
    complete = cleanup.complete
  } catch (exception) {
    logConnection(logger, {
      step: 'disconnect-cleanup',
      connectionId,
      error: exceptionMessage(exception),
    })
  }

  if (complete) {
    await deleteRevokedGoogleConnection(db, connectionId)
  }

  const revoked = revocation.revoked || !revocation.attempted

  logConnection(logger, {
    step: 'disconnect',
    connectionId,
    revokeAttempted: revocation.attempted,
    revoked,
    filesDeleted,
    filesPending: !complete,
  })

  return {
    disconnected: true,
    revoked,
    filesDeleted,
    filesPending: !complete,
  }
}
