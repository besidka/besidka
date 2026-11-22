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
import { cleanupAfterGoogleAccessEnded } from '~~/server/utils/google/access-ended'
import {
  buildGoogleRedirectUri,
  getConnectionScopes,
  GOOGLE_CONNECTION_REQUIRED_SCOPES,
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
  deleteGoogleConnection,
  markGoogleConnectionRevoked,
  readGoogleConnection,
} from '~~/server/utils/google/store'
import {
  hasStoredRefreshToken,
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

function logConnection(logger: LoggerLike, values: Record<string, unknown>) {
  logger.set({ attributes: { google: values } })
}

/**
 * Creates the single-use state (KV, ten minutes, bound to the user and the
 * client mode, holding the PKCE verifier, the exact redirect URI and the
 * checked return path) and returns Google's consent URL. Consent is asked
 * again only when no refresh token is stored for the mode; a reconnect
 * passes the stored email as `login_hint`.
 */
export async function startGoogleConnection(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  clientMode: GoogleClientMode
  origin: string
  returnTo: string
  logger: LoggerLike
  now?: number
}): Promise<{ authorizationUrl: string }> {
  const client = await resolveGoogleClient(input.clientMode, input.userId)
  const redirectUri = buildGoogleRedirectUri(input.origin, input.clientMode)
  const existing = await readGoogleConnection(
    input.db,
    input.userId,
    input.clientMode,
  )
  const promptConsent = !await hasStoredRefreshToken(
    input.db,
    input.userId,
    input.clientMode,
  )
  const state = createOAuthState()
  const pkce = await createPkcePair()

  await saveGoogleOAuthState(input.kv, state, {
    userId: input.userId,
    clientMode: input.clientMode,
    codeVerifier: pkce.verifier,
    redirectUri,
    returnTo: input.returnTo,
    createdAt: input.now ?? Date.now(),
  })

  logConnection(input.logger, {
    step: 'start',
    clientMode: input.clientMode,
    reconnect: !!existing,
    promptConsent,
  })

  return {
    authorizationUrl: buildGoogleAuthorizationUrl({
      client,
      redirectUri,
      scopes: getConnectionScopes(input.clientMode),
      state,
      codeChallenge: pkce.challenge,
      loginHint: existing?.googleEmail ?? null,
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
 * grant without `drive.file` (revoking the fresh tokens), reads the Google
 * account from the ID token and saves the connection. When a different
 * Google account replaces the connection, the old grant is revoked and its
 * copies are deleted first; if that cleanup cannot finish, the new grant
 * is revoked and the user is asked to try again.
 */
export async function completeGoogleConnection(input: {
  db: DbClient
  oauthState: GoogleOAuthState
  code: string
  logger: LoggerLike
  storage?: FileStorage
  fetchOptions?: GoogleFetchOptions
  now?: number
}): Promise<GoogleConnectResult> {
  const { db, oauthState, logger } = input
  const now = input.now ?? Date.now()
  const client = await resolveGoogleClient(
    oauthState.clientMode,
    oauthState.userId,
  )
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

  if (
    !hasScopes(
      tokens.scopes,
      GOOGLE_CONNECTION_REQUIRED_SCOPES[oauthState.clientMode],
    )
  ) {
    await revokeFreshTokens(tokens, input.fetchOptions)
    logConnection(logger, {
      step: 'scopes',
      outcome: 'missing_scope',
      grantedScopeCount: tokens.scopes.length,
    })

    return 'missing_scope'
  }

  const identity = readGoogleIdentity(tokens.idToken, client.clientId, now)

  if (!identity) {
    await revokeFreshTokens(tokens, input.fetchOptions)

    throw new GoogleConnectionError('GOOGLE_IDENTITY_INVALID')
  }

  const existing = await readGoogleConnection(
    db,
    oauthState.userId,
    oauthState.clientMode,
  )
  const isSameAccount = existing?.googleSubject === identity.subject

  if (existing && !isSameAccount) {
    await replaceDifferentAccount(input, existing.id, tokens)
  }

  const keepStoredRefreshToken = !tokens.refreshToken
    && isSameAccount
    && await hasStoredRefreshToken(
      db,
      oauthState.userId,
      oauthState.clientMode,
    )

  if (!tokens.refreshToken && !keepStoredRefreshToken) {
    await revokeFreshTokens(tokens, input.fetchOptions)

    throw new GoogleConnectionError('GOOGLE_NO_REFRESH_TOKEN')
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
  })

  return 'connected'
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
    const cleanup = await cleanupAfterGoogleAccessEnded({
      db,
      userId: oauthState.userId,
      connectionId,
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
 * a failure is logged with ids only), clears the tokens and marks the row
 * `revoked`, deletes the Google copies synchronously, and deletes the row
 * only when that cleanup finished. Otherwise the `revoked` row stays for
 * the hourly sweep, which finishes the cleanup and removes it.
 */
export async function disconnectGoogleConnection(input: {
  db: DbClient
  userId: number
  clientMode: GoogleClientMode
  logger: LoggerLike
  storage?: FileStorage
  fetchOptions?: GoogleFetchOptions
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

  await markGoogleConnectionRevoked(db, connectionId)

  let filesDeleted = 0
  let complete = false

  try {
    const cleanup = await cleanupAfterGoogleAccessEnded({
      db,
      userId,
      connectionId,
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
    await deleteGoogleConnection(db, connectionId)
  }

  logConnection(logger, {
    step: 'disconnect',
    connectionId,
    revokeAttempted: revocation.attempted,
    revoked: revocation.revoked,
    filesDeleted,
    filesPending: !complete,
  })

  return {
    disconnected: true,
    revoked: revocation.revoked,
    filesDeleted,
    filesPending: !complete,
  }
}
