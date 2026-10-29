import { log } from 'evlog'
import { eq, inArray, or } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { resolveServerLogger } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export type OAuthGrantRevocationTrigger
  = | 'reset-password'
    | 'change-password'
    | 'revoke-sessions'
    | 'revoke-other-sessions'

interface BuildOAuthGrantDeletesOptions {
  includeOwnedClients?: boolean
}

const REVOKE_BATCH_ATTEMPTS = 2

export interface RevokeUserOAuthGrantsInput {
  userId: number
  trigger: OAuthGrantRevocationTrigger
  logger?: LoggerLike
}

/**
 * Builds the three grant-table deletes in foreign-key order: access tokens
 * reference refresh tokens, so they go first. With `includeOwnedClients` the
 * deletes also cover every user's rows of the clients this user registered,
 * which the account purge needs before it deletes those clients.
 */
export function buildOAuthGrantDeletes(
  db: ReturnType<typeof useDb>,
  userId: number,
  options: BuildOAuthGrantDeletesOptions = {},
) {
  const ownedClientIds = db
    .select({ clientId: schema.oauthClients.clientId })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.userId, userId))

  return {
    accessTokens: db.delete(schema.oauthAccessTokens).where(
      options.includeOwnedClients
        ? or(
          eq(schema.oauthAccessTokens.userId, userId),
          inArray(schema.oauthAccessTokens.clientId, ownedClientIds),
        )
        : eq(schema.oauthAccessTokens.userId, userId),
    ),
    refreshTokens: db.delete(schema.oauthRefreshTokens).where(
      options.includeOwnedClients
        ? or(
          eq(schema.oauthRefreshTokens.userId, userId),
          inArray(schema.oauthRefreshTokens.clientId, ownedClientIds),
        )
        : eq(schema.oauthRefreshTokens.userId, userId),
    ),
    consents: db.delete(schema.oauthConsents).where(
      options.includeOwnedClients
        ? or(
          eq(schema.oauthConsents.userId, userId),
          inArray(schema.oauthConsents.clientId, ownedClientIds),
        )
        : eq(schema.oauthConsents.userId, userId),
    ),
  }
}

/**
 * Ends every OAuth grant a user has handed to connected apps, in one D1
 * batch. Account recovery must call this: a refresh token outlives the
 * browser sessions that account recovery revokes, so without it a stolen
 * grant keeps minting access tokens for 30 days after the password changed.
 * The batch is retried once; a second failure is logged as an alert and
 * reported as `false` instead of thrown, because the credential change that
 * triggered the revocation has already happened.
 */
export async function revokeUserOAuthGrants(
  input: RevokeUserOAuthGrantsInput,
): Promise<boolean> {
  const { userId, trigger } = input
  const logger = resolveServerLogger(input.logger)
  const db = useDb()
  const deletes = buildOAuthGrantDeletes(db, userId)

  let failure: unknown = null

  for (let attempt = 0; attempt < REVOKE_BATCH_ATTEMPTS; attempt++) {
    try {
      await db.batch([
        deletes.accessTokens,
        deletes.refreshTokens,
        deletes.consents,
      ])
      failure = null

      break
    } catch (exception) {
      failure = exception
    }
  }

  if (failure) {
    const legalConsent = {
      action: 'oauth_revoke_all_failed',
      trigger,
      attempts: REVOKE_BATCH_ATTEMPTS,
      error: exceptionMessage(failure),
    }

    logger.set({ userId, attributes: { legalConsent } })
    log.error({
      action: 'oauth_revoke_all_failed',
      alert: true,
      userId,
      attributes: { legalConsent },
    })

    return false
  }

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'oauth_revoked_all',
        trigger,
      },
    },
  })

  return true
}
