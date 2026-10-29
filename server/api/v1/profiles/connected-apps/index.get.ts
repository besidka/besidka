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

const MILLISECONDS_PER_SECOND = 1000

function toTimestampDate(seconds: number | null): Date | null {
  if (seconds === null || !Number.isFinite(Number(seconds))) {
    return null
  }

  return new Date(Number(seconds) * MILLISECONDS_PER_SECOND)
}

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const db = useDb()
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
      gt(schema.oauthRefreshTokens.expiresAt, new Date()),
    ))
    .groupBy(schema.oauthRefreshTokens.clientId)
    .as('live_grants')

  const rows = await db
    .select({
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.name,
      uri: schema.oauthClients.uri,
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
      lastActivity,
      eq(lastActivity.clientId, schema.oauthClients.clientId),
    )
    .where(or(
      isNotNull(schema.oauthConsents.id),
      isNotNull(liveGrants.clientId),
    ))
    .orderBy(desc(
      sql`coalesce(${schema.oauthConsents.updatedAt}, ${liveGrants.liveSince})`,
    ))
    .limit(100)

  return rows.map((row) => {
    const liveSince = toTimestampDate(row.liveSince)
    const scopes = row.consentScopes ?? row.liveScopes

    return {
      clientId: row.clientId,
      name: row.name || 'Unnamed app',
      uri: row.uri,
      scopes: Array.isArray(scopes) ? scopes as string[] : [],
      createdAt: row.consentCreatedAt ?? liveSince,
      updatedAt: row.consentUpdatedAt ?? liveSince,
      lastUsedAt: toTimestampDate(row.lastUsedAt),
    }
  })
})
