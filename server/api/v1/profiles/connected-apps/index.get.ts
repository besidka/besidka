import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { defineEventHandler } from 'nuxt/server'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

const MILLISECONDS_PER_SECOND = 1000

function toTimestampDate(seconds: number | null): Date | null {
  if (seconds === null || !Number.isFinite(Number(seconds))) {
    return null
  }

  return new Date(Number(seconds) * MILLISECONDS_PER_SECOND)
}

/**
 * Lists the apps a user can still act through. An app is live when it has an
 * unrevoked, unexpired refresh token or access token for the user; a consent
 * row alone is dead weight and stays hidden, because it holds no token and a
 * later authorization would skip the approval screen while it still covers
 * the requested scopes. Each live app carries the scopes of its consent (the
 * ceiling the user can narrow) or, when the consent row is gone, of its
 * newest live refresh token.
 */
export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const db = useDb()
  const now = new Date()
  const lastActivity = db
    .select({
      clientId: schema.oauthRefreshTokens.clientId,
      lastUsedAt: sql<number | null>`max(${schema.oauthRefreshTokens.createdAt})`
        .as('last_used_at'),
    })
    .from(schema.oauthRefreshTokens)
    .where(eq(schema.oauthRefreshTokens.userId, userId))
    .groupBy(schema.oauthRefreshTokens.clientId)
    .as('last_activity')
  const liveGrants = db
    .select({
      clientId: schema.oauthRefreshTokens.clientId,
      liveSince: sql<number>`max(${schema.oauthRefreshTokens.createdAt})`
        .as('live_since'),
      liveScopes: schema.oauthRefreshTokens.scopes,
    })
    .from(schema.oauthRefreshTokens)
    .where(and(
      eq(schema.oauthRefreshTokens.userId, userId),
      isNull(schema.oauthRefreshTokens.revoked),
      gt(schema.oauthRefreshTokens.expiresAt, now),
    ))
    .groupBy(schema.oauthRefreshTokens.clientId)
    .as('live_grants')
  const liveAccessTokens = db
    .select({
      clientId: schema.oauthAccessTokens.clientId,
      liveUntil: sql<number>`max(${schema.oauthAccessTokens.expiresAt})`
        .as('live_until'),
    })
    .from(schema.oauthAccessTokens)
    .where(and(
      eq(schema.oauthAccessTokens.userId, userId),
      isNull(schema.oauthAccessTokens.revoked),
      gt(schema.oauthAccessTokens.expiresAt, now),
    ))
    .groupBy(schema.oauthAccessTokens.clientId)
    .as('live_access_tokens')

  const rows = await db
    .select({
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.name,
      uri: schema.oauthClients.uri,
      consentId: schema.oauthConsents.id,
      consentScopes: schema.oauthConsents.scopes,
      consentCreatedAt: schema.oauthConsents.createdAt,
      consentUpdatedAt: schema.oauthConsents.updatedAt,
      liveSince: liveGrants.liveSince,
      liveScopes: liveGrants.liveScopes,
      lastUsedAt: lastActivity.lastUsedAt,
    })
    .from(schema.oauthClients)
    .leftJoin(
      schema.oauthConsents,
      and(
        eq(schema.oauthConsents.clientId, schema.oauthClients.clientId),
        eq(schema.oauthConsents.userId, userId),
      ),
    )
    .leftJoin(
      liveGrants,
      eq(liveGrants.clientId, schema.oauthClients.clientId),
    )
    .leftJoin(
      liveAccessTokens,
      eq(liveAccessTokens.clientId, schema.oauthClients.clientId),
    )
    .leftJoin(
      lastActivity,
      eq(lastActivity.clientId, schema.oauthClients.clientId),
    )
    .where(or(
      isNotNull(liveGrants.clientId),
      isNotNull(liveAccessTokens.clientId),
    ))
    .orderBy(desc(
      sql`coalesce(${schema.oauthConsents.updatedAt}, ${liveGrants.liveSince})`,
    ))
    .limit(100)

  return rows.map((row) => {
    const liveSince = toTimestampDate(row.liveSince)
    const consentScopes = parseStoredOAuthScopes(row.consentScopes)
    const scopes = consentScopes.length > 0
      ? consentScopes
      : parseStoredOAuthScopes(row.liveScopes)

    return {
      clientId: row.clientId,
      name: row.name || 'Unnamed app',
      uri: row.uri,
      scopes,
      canEditScopes: row.consentId !== null && consentScopes.length > 0,
      createdAt: row.consentCreatedAt ?? liveSince,
      updatedAt: row.consentUpdatedAt ?? liveSince,
      lastUsedAt: toTimestampDate(row.lastUsedAt),
    }
  })
})
