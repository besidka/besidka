import { and, eq } from 'drizzle-orm'
import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import { hasScopes } from '#shared/utils/google-scopes'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { cleanupAfterGoogleAccessEnded } from '~~/server/utils/google/access-ended'
import { resolveGoogleClient } from '~~/server/utils/google/client'
import { GOOGLE_FETCH_TIMEOUT_MS } from '~~/server/utils/google/http'
import type { GoogleFetchOptions } from '~~/server/utils/google/http'
import {
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from '~~/server/utils/google/oauth'
import type { GoogleTokenSet } from '~~/server/utils/google/oauth'
import {
  acquireGoogleRefreshLock,
  GOOGLE_REFRESH_LOCK_WAIT_ATTEMPTS,
  GOOGLE_REFRESH_LOCK_WAIT_MS,
  isGoogleRefreshLockHeld,
  releaseGoogleRefreshLock,
} from '~~/server/utils/google/refresh-lock'
import { googleConnectionRecordColumns } from '~~/server/utils/google/store'
import type { GoogleConnectionRecord } from '~~/server/utils/google/store'

type DbClient = ReturnType<typeof useDb>

export const GOOGLE_ACCESS_TOKEN_REFRESH_MARGIN_SECONDS = 120
export const GOOGLE_PURGE_REVOKE_DEADLINE_MS = 10_000

export interface GoogleTokenDependencies {
  db: DbClient
  kv: KVNamespace
  logger?: LoggerLike
  storage?: Pick<R2Bucket, 'delete'>
  fetchOptions?: GoogleFetchOptions
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}

export interface GoogleAccessTokenRequest {
  userId: number
  clientMode: GoogleClientMode
  requiredScopes?: readonly string[]
}

export type GoogleAccessTokenResult
  = | { status: 'ok', accessToken: string, expiresAt: Date | null }
    | { status: 'not_connected' }
    | { status: 'needs_reauth' }
    | { status: 'missing_scope' }

interface TokenRow extends GoogleConnectionRecord {
  refreshToken: string | null
  accessToken: string | null
  accessTokenExpiresAt: Date | null
}

export interface GoogleRevocationResult {
  attempted: boolean
  revoked: boolean
}

const NOOP_LOGGER: LoggerLike = { set() {} }

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function logToken(
  logger: LoggerLike | undefined,
  values: Record<string, unknown>,
) {
  logger?.set({ attributes: { googleToken: values } })
}

async function readTokenRow(
  db: DbClient,
  userId: number,
  clientMode: GoogleClientMode,
): Promise<TokenRow | null> {
  const [row] = await db
    .select({
      ...googleConnectionRecordColumns,
      refreshToken: schema.googleConnections.refreshToken,
      accessToken: schema.googleConnections.accessToken,
      accessTokenExpiresAt: schema.googleConnections.accessTokenExpiresAt,
    })
    .from(schema.googleConnections)
    .where(and(
      eq(schema.googleConnections.userId, userId),
      eq(schema.googleConnections.clientMode, clientMode),
    ))
    .limit(1)

  return row ?? null
}

function isAccessTokenFresh(row: TokenRow, now: number): boolean {
  if (!row.accessToken || !row.accessTokenExpiresAt) {
    return false
  }

  return row.accessTokenExpiresAt.getTime() - now
    > GOOGLE_ACCESS_TOKEN_REFRESH_MARGIN_SECONDS * 1000
}

async function decryptToken(cipher: string): Promise<string | null> {
  try {
    return await useDecryptText(cipher)
  } catch {
    return null
  }
}

async function toOkResult(
  row: TokenRow,
): Promise<GoogleAccessTokenResult | null> {
  const accessToken = row.accessToken
    ? await decryptToken(row.accessToken)
    : null

  if (!accessToken) {
    return null
  }

  return { status: 'ok', accessToken, expiresAt: row.accessTokenExpiresAt }
}

function refreshFailed() {
  return createError({
    message: 'Google did not refresh the connection',
    status: 502,
    why: 'Google refused to issue a new access token',
    fix: 'Try again in a moment',
  })
}

function refreshBusy() {
  return createError({
    message: 'Google connection is busy',
    status: 503,
    why: 'Another request is refreshing the Google token',
    fix: 'Try again in a moment',
  })
}

/**
 * Ends a connection whose refresh token Google no longer accepts. The
 * write only applies while the row still holds the refresh token that
 * failed, so a reconnect or a parallel rotation is never undone. The old
 * access token is revoked best effort, then the Google copies are deleted
 * (unless another mode is still active); a cleanup failure is left to the
 * hourly sweep.
 */
async function endAccessAfterInvalidGrant(
  row: TokenRow,
  dependencies: GoogleTokenDependencies,
  reason: 'invalid-grant' | 'undecryptable',
): Promise<GoogleAccessTokenResult> {
  const logger = dependencies.logger ?? NOOP_LOGGER
  const ended = await dependencies.db
    .update(schema.googleConnections)
    .set({
      status: 'needs_reauth',
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      updatedAt: new Date((dependencies.now ?? Date.now)()),
    })
    .where(and(
      eq(schema.googleConnections.id, row.id),
      eq(schema.googleConnections.refreshToken, row.refreshToken ?? ''),
    ))
    .returning({ id: schema.googleConnections.id })

  if (ended.length === 0) {
    const latest = await readTokenRow(
      dependencies.db,
      row.userId,
      row.clientMode,
    )

    if (latest?.status === 'active' && latest.accessToken) {
      return await toOkResult(latest) ?? { status: 'needs_reauth' }
    }

    return { status: 'needs_reauth' }
  }

  logToken(logger, { connectionId: row.id, refresh: reason })

  const now = (dependencies.now ?? Date.now)()
  const accessTokenAlive = !!row.accessToken
    && !!row.accessTokenExpiresAt
    && row.accessTokenExpiresAt.getTime() > now
  const accessToken = accessTokenAlive && row.accessToken
    ? await decryptToken(row.accessToken)
    : null

  if (accessToken) {
    await revokeGoogleToken(accessToken, dependencies.fetchOptions)
  }

  try {
    await cleanupAfterGoogleAccessEnded({
      db: dependencies.db,
      userId: row.userId,
      connectionId: row.id,
      logger,
      storage: dependencies.storage,
    })
  } catch (exception) {
    logToken(logger, {
      connectionId: row.id,
      cleanup: 'failed',
      error: exception instanceof Error ? exception.message : 'unknown',
    })
  }

  return { status: 'needs_reauth' }
}

async function storeRefreshedTokens(
  row: TokenRow,
  tokens: GoogleTokenSet,
  dependencies: GoogleTokenDependencies,
): Promise<boolean> {
  const refreshToken = tokens.refreshToken
    ? await useEncryptText(tokens.refreshToken)
    : row.refreshToken
  const saved = await dependencies.db
    .update(schema.googleConnections)
    .set({
      accessToken: await useEncryptText(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      refreshToken,
      grantedScopes: tokens.scopes.length > 0
        ? tokens.scopes
        : row.grantedScopes,
      updatedAt: new Date((dependencies.now ?? Date.now)()),
    })
    .where(and(
      eq(schema.googleConnections.id, row.id),
      eq(schema.googleConnections.status, 'active'),
      eq(schema.googleConnections.refreshToken, row.refreshToken ?? ''),
    ))
    .returning({ id: schema.googleConnections.id })

  return saved.length > 0
}

async function performRefresh(
  row: TokenRow,
  dependencies: GoogleTokenDependencies,
): Promise<GoogleAccessTokenResult> {
  const refreshToken = row.refreshToken
    ? await decryptToken(row.refreshToken)
    : null

  if (!refreshToken) {
    return await endAccessAfterInvalidGrant(row, dependencies, 'undecryptable')
  }

  const client = await resolveGoogleClient(row.clientMode, row.userId)
  const result = await refreshGoogleAccessToken({
    client,
    refreshToken,
    now: (dependencies.now ?? Date.now)(),
  }, dependencies.fetchOptions)

  if (!result.ok) {
    if (result.error !== 'invalid_grant') {
      logToken(dependencies.logger, {
        connectionId: row.id,
        refresh: 'failed',
        googleError: result.error ?? 'unknown',
      })

      throw refreshFailed()
    }

    const latest = await readTokenRow(
      dependencies.db,
      row.userId,
      row.clientMode,
    )

    if (
      latest?.status === 'active'
      && latest.refreshToken !== row.refreshToken
    ) {
      logToken(dependencies.logger, {
        connectionId: row.id,
        refresh: 'superseded',
      })

      return await toOkResult(latest) ?? { status: 'needs_reauth' }
    }

    return await endAccessAfterInvalidGrant(row, dependencies, 'invalid-grant')
  }

  if (await storeRefreshedTokens(row, result.tokens, dependencies)) {
    logToken(dependencies.logger, {
      connectionId: row.id,
      refresh: 'refreshed',
      rotated: !!result.tokens.refreshToken,
    })

    return {
      status: 'ok',
      accessToken: result.tokens.accessToken,
      expiresAt: result.tokens.expiresAt,
    }
  }

  logToken(dependencies.logger, { connectionId: row.id, refresh: 'lost-race' })

  const latest = await readTokenRow(
    dependencies.db,
    row.userId,
    row.clientMode,
  )

  if (latest?.status !== 'active') {
    return { status: latest ? 'needs_reauth' : 'not_connected' }
  }

  return await toOkResult(latest) ?? { status: 'needs_reauth' }
}

/**
 * Refreshes under the KV lock. A caller that loses the lock waits up to
 * three times 500 ms for the owner's new token (a new access-token
 * ciphertext on the row); if the owner still holds the lock after that, it
 * gives up with a retryable 503 instead of spending the refresh token
 * twice. When KV itself fails, the refresh runs unlocked and the D1
 * compare-and-set on the refresh-token ciphertext settles the race.
 */
async function refreshUnderLock(
  row: TokenRow,
  dependencies: GoogleTokenDependencies,
): Promise<GoogleAccessTokenResult> {
  const now = dependencies.now ?? Date.now
  const wait = dependencies.wait ?? defaultWait
  let owner: string | null = null
  let lockUnavailable = false

  try {
    owner = await acquireGoogleRefreshLock(dependencies.kv, row.id, now())
  } catch {
    lockUnavailable = true
    logToken(dependencies.logger, {
      connectionId: row.id,
      refresh: 'lock-unavailable',
    })
  }

  if (!owner && !lockUnavailable) {
    for (
      let attempt = 0;
      attempt < GOOGLE_REFRESH_LOCK_WAIT_ATTEMPTS;
      attempt++
    ) {
      await wait(GOOGLE_REFRESH_LOCK_WAIT_MS)

      const latest = await readTokenRow(
        dependencies.db,
        row.userId,
        row.clientMode,
      )

      if (!latest) {
        return { status: 'not_connected' }
      }

      if (latest.status !== 'active') {
        return { status: 'needs_reauth' }
      }

      if (latest.accessToken !== row.accessToken) {
        logToken(dependencies.logger, {
          connectionId: row.id,
          refresh: 'waited',
        })

        return await toOkResult(latest) ?? { status: 'needs_reauth' }
      }
    }

    if (await isGoogleRefreshLockHeld(dependencies.kv, row.id, now())) {
      logToken(dependencies.logger, {
        connectionId: row.id,
        refresh: 'lock-busy',
      })

      throw refreshBusy()
    }
  }

  try {
    return await performRefresh(row, dependencies)
  } finally {
    if (owner) {
      await releaseGoogleRefreshLock(dependencies.kv, row.id, owner)
    }
  }
}

/**
 * A valid Google access token for the user and client mode. The only place
 * that decrypts Google tokens. Returns the cached token while it has more
 * than two minutes left, otherwise refreshes under the KV lock, stores the
 * new encrypted tokens (and a rotated refresh token when Google sends
 * one). `invalid_grant` ends the connection (`needs_reauth`, tokens
 * cleared, Google copies deleted). Network failures, timeouts and other
 * Google errors throw and never end the connection. A token is never
 * logged or returned to a browser by this function.
 */
export async function getGoogleAccessToken(
  request: GoogleAccessTokenRequest,
  dependencies: GoogleTokenDependencies,
): Promise<GoogleAccessTokenResult> {
  const row = await readTokenRow(
    dependencies.db,
    request.userId,
    request.clientMode,
  )

  if (!row) {
    return { status: 'not_connected' }
  }

  if (row.status === 'revoked') {
    return { status: 'not_connected' }
  }

  if (row.status !== 'active' || !row.refreshToken) {
    return { status: 'needs_reauth' }
  }

  if (
    request.requiredScopes
    && !hasScopes(row.grantedScopes, request.requiredScopes)
  ) {
    return { status: 'missing_scope' }
  }

  if (isAccessTokenFresh(row, (dependencies.now ?? Date.now)())) {
    const cached = await toOkResult(row)

    if (cached) {
      return cached
    }
  }

  return await refreshUnderLock(row, dependencies)
}

/**
 * `getGoogleAccessToken` for callers that need a token or a 4xx: 404 when
 * the user never connected, 409 when Google access ended or a required
 * scope is missing.
 */
export async function requireGoogleAccessToken(
  request: GoogleAccessTokenRequest,
  dependencies: GoogleTokenDependencies,
): Promise<{ accessToken: string, expiresAt: Date | null }> {
  const result = await getGoogleAccessToken(request, dependencies)

  if (result.status === 'ok') {
    return { accessToken: result.accessToken, expiresAt: result.expiresAt }
  }

  if (result.status === 'not_connected') {
    throw createError({
      message: 'Google is not connected',
      status: 404,
      why: 'There is no Google connection for this account',
      fix: 'Connect Google Drive on the API Keys page',
    })
  }

  throw createError({
    message: 'Reconnect Google',
    status: 409,
    why: result.status === 'missing_scope'
      ? 'The Google connection does not grant the access this needs'
      : 'Google no longer accepts the stored authorization',
    fix: 'Reconnect Google Drive on the API Keys page',
  })
}

export interface SaveGoogleConnectionInput {
  userId: number
  clientMode: GoogleClientMode
  subject: string
  email: string | null
  scopes: string[]
  accessToken: string
  accessTokenExpiresAt: Date | null
  refreshToken: string | null
}

/**
 * Creates or replaces the connection of a user and mode with encrypted
 * tokens and status `active`. A null refresh token keeps the stored one;
 * the caller only passes null for a reconnect of the same Google account
 * that still has one.
 */
export async function saveGoogleConnection(
  db: DbClient,
  input: SaveGoogleConnectionInput,
): Promise<string> {
  const now = new Date()
  const encryptedAccessToken = await useEncryptText(input.accessToken)
  const encryptedRefreshToken = input.refreshToken
    ? await useEncryptText(input.refreshToken)
    : null
  const changes = {
    googleSubject: input.subject,
    googleEmail: input.email,
    grantedScopes: input.scopes,
    accessToken: encryptedAccessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    status: 'active' as const,
    updatedAt: now,
    ...(encryptedRefreshToken ? { refreshToken: encryptedRefreshToken } : {}),
  }
  const [row] = await db
    .insert(schema.googleConnections)
    .values({
      userId: input.userId,
      clientMode: input.clientMode,
      refreshToken: encryptedRefreshToken,
      createdAt: now,
      ...changes,
    })
    .onConflictDoUpdate({
      target: [
        schema.googleConnections.userId,
        schema.googleConnections.clientMode,
      ],
      set: changes,
    })
    .returning({ id: schema.googleConnections.id })

  return row!.id
}

/**
 * Whether the stored connection of a mode still has a refresh token,
 * without decrypting it: the start route asks Google for consent again
 * only when it does not.
 */
export async function hasStoredRefreshToken(
  db: DbClient,
  userId: number,
  clientMode: GoogleClientMode,
): Promise<boolean> {
  const row = await readTokenRow(db, userId, clientMode)

  return row?.status === 'active' && !!row.refreshToken
}

async function revokeTokenRow(
  row: Pick<TokenRow, 'refreshToken' | 'accessToken'>,
  fetchOptions?: GoogleFetchOptions,
): Promise<GoogleRevocationResult> {
  const cipher = row.refreshToken ?? row.accessToken

  if (!cipher) {
    return { attempted: false, revoked: false }
  }

  const token = await decryptToken(cipher)

  if (!token) {
    return { attempted: false, revoked: false }
  }

  return {
    attempted: true,
    revoked: await revokeGoogleToken(token, fetchOptions),
  }
}

/**
 * Revokes the stored grant of one connection at Google (the refresh token,
 * which ends the whole grant, or the access token when no refresh token is
 * left). Best effort and never throws; the caller clears the row either
 * way.
 */
export async function revokeStoredGoogleConnection(
  db: DbClient,
  userId: number,
  clientMode: GoogleClientMode,
  options: { fetchOptions?: GoogleFetchOptions, logger?: LoggerLike } = {},
): Promise<GoogleRevocationResult & { connectionId: string | null }> {
  try {
    const row = await readTokenRow(db, userId, clientMode)

    if (!row) {
      return { connectionId: null, attempted: false, revoked: false }
    }

    const result = await revokeTokenRow(row, options.fetchOptions)

    logToken(options.logger, {
      connectionId: row.id,
      revokeAttempted: result.attempted,
      revoked: result.revoked,
    })

    return { connectionId: row.id, ...result }
  } catch {
    return { connectionId: null, attempted: false, revoked: false }
  }
}

/**
 * Revokes every Google grant a user holds, one connection at a time and
 * within a deadline, for account deletion. Never throws and never blocks
 * the deletion on Google's answer.
 */
export async function revokeAllGoogleConnectionsOfUser(
  db: Pick<DbClient, 'select'>,
  userId: number,
  options: {
    fetchOptions?: GoogleFetchOptions
    deadlineMs?: number
    now?: () => number
  } = {},
): Promise<{ attempted: number, revoked: number }> {
  const now = options.now ?? Date.now
  const deadlineMs = options.deadlineMs ?? GOOGLE_PURGE_REVOKE_DEADLINE_MS
  const deadline = now() + deadlineMs
  const result = { attempted: 0, revoked: 0 }

  try {
    const rows = await db
      .select({
        refreshToken: schema.googleConnections.refreshToken,
        accessToken: schema.googleConnections.accessToken,
      })
      .from(schema.googleConnections)
      .where(eq(schema.googleConnections.userId, userId))

    for (const row of rows) {
      const remainingMs = deadline - now()

      if (remainingMs <= 0) {
        break
      }

      const revocation = await revokeTokenRow(row, {
        ...options.fetchOptions,
        timeoutMs: Math.min(
          remainingMs,
          options.fetchOptions?.timeoutMs ?? GOOGLE_FETCH_TIMEOUT_MS,
        ),
      })

      result.attempted += revocation.attempted ? 1 : 0
      result.revoked += revocation.revoked ? 1 : 0
    }
  } catch {
    return result
  }

  return result
}
