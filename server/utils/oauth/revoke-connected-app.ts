import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

export interface RevokedConnectedApp {
  accessTokens: number
  refreshTokens: number
  consents: number
  scopes: string[]
}

/**
 * Ends one user's connection to one app in a single D1 batch, in foreign-key
 * order (access tokens reference refresh tokens). Returns null when the user
 * had no grant of any kind for that app. A D1 failure propagates.
 */
export async function revokeConnectedApp(
  db: ReturnType<typeof useDb>,
  userId: number,
  clientId: string,
): Promise<RevokedConnectedApp | null> {
  const [accessTokens, refreshTokens, consents] = await db.batch([
    db.delete(schema.oauthAccessTokens).where(and(
      eq(schema.oauthAccessTokens.userId, userId),
      eq(schema.oauthAccessTokens.clientId, clientId),
    )).returning({ id: schema.oauthAccessTokens.id }),
    db.delete(schema.oauthRefreshTokens).where(and(
      eq(schema.oauthRefreshTokens.userId, userId),
      eq(schema.oauthRefreshTokens.clientId, clientId),
    )).returning({ scopes: schema.oauthRefreshTokens.scopes }),
    db.delete(schema.oauthConsents).where(and(
      eq(schema.oauthConsents.userId, userId),
      eq(schema.oauthConsents.clientId, clientId),
    )).returning({ scopes: schema.oauthConsents.scopes }),
  ])

  if (!accessTokens.length && !refreshTokens.length && !consents.length) {
    return null
  }

  const scopes = [...new Set(
    [...consents, ...refreshTokens].flatMap((grant) => {
      return parseStoredOAuthScopes(grant.scopes)
    }),
  )]

  return {
    accessTokens: accessTokens.length,
    refreshTokens: refreshTokens.length,
    consents: consents.length,
    scopes,
  }
}
