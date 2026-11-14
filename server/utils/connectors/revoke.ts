import { CONNECTOR_REVOKE_DEADLINE_MS } from '#shared/utils/connectors-policy'
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
 * Before an account purge: revokes every connector token of the user, one
 * connector after another (the Workers connection limit), under one overall
 * deadline. Never throws, so a slow or broken authorization server cannot
 * block the deletion of the account.
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
  let attempted = false
  let revoked = 0
  let failed = false

  try {
    const credentials = await listUserConnectorCredentials(db, userId)

    for (const entry of credentials) {
      if (controller.signal.aborted) {
        break
      }

      const result = await revokeConnectorCredentials(entry, {
        signal: controller.signal,
      })

      attempted ||= result.attempted
      revoked += result.revoked
    }
  } catch {
    failed = true
  } finally {
    clearTimeout(timer)
  }

  logger?.set({
    attributes: {
      connectors: {
        step: 'account-revoke',
        revoked,
        failed,
        timedOut: controller.signal.aborted,
      },
    },
  })

  return { attempted, revoked }
}
