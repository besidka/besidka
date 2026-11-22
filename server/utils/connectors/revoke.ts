import {
  CONNECTOR_REVOKE_CONCURRENCY,
  CONNECTOR_REVOKE_DEADLINE_MS,
} from '#shared/utils/connectors-policy'
import { revokeToken } from '~~/server/utils/connectors/oauth-client'
import {
  listUserConnectorCredentials,
  readConnectorCredentials,
} from '~~/server/utils/connectors/store'
import type { ConnectorCredentials } from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export interface RevocationResult {
  attempted: boolean
  revoked: number
}

/**
 * RFC 7009 revocation of a connector's refresh token, then its access token,
 * when the issuer published a `revocation_endpoint`. Best effort and never
 * throws: the caller deletes the credentials either way.
 */
export async function revokeConnectorCredentials(
  credentials: ConnectorCredentials,
  options: { signal?: AbortSignal, logger?: LoggerLike } = {},
): Promise<RevocationResult> {
  const registration = credentials.clientRegistration

  if (!registration?.revocationEndpoint) {
    return { attempted: false, revoked: 0 }
  }

  const tokens = [
    { token: credentials.refreshToken, tokenTypeHint: 'refresh_token' },
    { token: credentials.accessToken, tokenTypeHint: 'access_token' },
  ] as const
  let revoked = 0

  for (const { token, tokenTypeHint } of tokens) {
    if (!token || options.signal?.aborted) {
      continue
    }

    const ok = await revokeToken({
      registration,
      token,
      tokenTypeHint,
      signal: options.signal,
      logger: options.logger,
    })

    revoked += ok ? 1 : 0
  }

  return { attempted: true, revoked }
}

export async function revokeStoredConnectorCredentials(
  db: DbClient,
  userId: number,
  connectorId: string,
  options: { signal?: AbortSignal, logger?: LoggerLike } = {},
): Promise<RevocationResult> {
  try {
    const credentials = await readConnectorCredentials(db, userId, connectorId)

    if (!credentials) {
      return { attempted: false, revoked: 0 }
    }

    return await revokeConnectorCredentials(credentials, options)
  } catch {
    return { attempted: false, revoked: 0 }
  }
}

/**
 * Revokes a list of credentials with at most four connectors in flight
 * (each sends its two revocations one after the other), inside the Workers
 * limit of six simultaneous connections. The list is read before the fan-out
 * and the workers only call `fetch`, so no binding is resolved inside it.
 * When `signal` aborts, in-flight requests are canceled and no new one
 * starts; the caller deletes the credentials either way.
 */
export async function revokeCredentialsBatch(
  credentials: readonly ConnectorCredentials[],
  options: { signal?: AbortSignal, logger?: LoggerLike } = {},
): Promise<RevocationResult> {
  let next = 0
  let attempted = false
  let revoked = 0

  async function worker() {
    while (next < credentials.length && !options.signal?.aborted) {
      const entry = credentials[next++]!
      const result = await revokeConnectorCredentials(entry, {
        signal: options.signal,
      })

      attempted ||= result.attempted
      revoked += result.revoked
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(CONNECTOR_REVOKE_CONCURRENCY, credentials.length) },
    worker,
  ))

  return { attempted, revoked }
}

/**
 * Before an account purge: revokes every connector token of the user, at
 * most four connectors at a time, under one overall deadline (10 s). Never
 * throws, so a slow or broken authorization server cannot block the
 * deletion of the account; whatever is not revoked by the deadline is
 * deleted unrevoked.
 */
export async function revokeAllUserConnectorTokens(
  db: DbClient,
  userId: number,
  logger?: LoggerLike,
  deadlineMs: number = CONNECTOR_REVOKE_DEADLINE_MS,
): Promise<RevocationResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, deadlineMs)
  let result: RevocationResult = { attempted: false, revoked: 0 }
  let failed = false

  try {
    const credentials = await listUserConnectorCredentials(db, userId)

    result = await revokeCredentialsBatch(credentials, {
      signal: controller.signal,
    })
  } catch {
    failed = true
  } finally {
    clearTimeout(timer)
  }

  logger?.set({
    attributes: {
      connectors: {
        step: 'account-revoke',
        revoked: result.revoked,
        failed,
        timedOut: controller.signal.aborted,
      },
    },
  })

  return result
}
