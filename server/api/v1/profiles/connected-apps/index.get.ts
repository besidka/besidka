import { desc, eq, sql } from 'drizzle-orm'
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

  const rows = await db
    .select({
      consentId: schema.oauthConsents.id,
      clientId: schema.oauthConsents.clientId,
      scopes: schema.oauthConsents.scopes,
      createdAt: schema.oauthConsents.createdAt,
      updatedAt: schema.oauthConsents.updatedAt,
      name: schema.oauthClients.name,
      uri: schema.oauthClients.uri,
      lastUsedAt: lastActivity.lastUsedAt,
    })
    .from(schema.oauthConsents)
    .innerJoin(
      schema.oauthClients,
      eq(schema.oauthClients.clientId, schema.oauthConsents.clientId),
    )
    .leftJoin(
      lastActivity,
      eq(lastActivity.clientId, schema.oauthConsents.clientId),
    )
    .where(eq(schema.oauthConsents.userId, userId))
    .orderBy(desc(schema.oauthConsents.updatedAt))
    .limit(100)

  return rows.map((row) => {
    return {
      clientId: row.clientId,
      name: row.name || 'Unnamed app',
      uri: row.uri,
      scopes: Array.isArray(row.scopes) ? row.scopes as string[] : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: toTimestampDate(row.lastUsedAt),
    }
  })
})
