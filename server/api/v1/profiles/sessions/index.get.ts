import { and, desc, eq, gt } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  const rows = await useDb()
    .select({
      id: schema.sessions.id,
      token: schema.sessions.token,
      createdAt: schema.sessions.createdAt,
      updatedAt: schema.sessions.updatedAt,
      expiresAt: schema.sessions.expiresAt,
      ipAddress: schema.sessions.ipAddress,
      userAgent: schema.sessions.userAgent,
    })
    .from(schema.sessions)
    .where(and(
      eq(schema.sessions.userId, userId),
      gt(schema.sessions.expiresAt, new Date()),
    ))
    .orderBy(desc(schema.sessions.createdAt))
    .limit(100)

  const currentToken = session.session.token

  return rows.map((row) => {
    const { token, ...rest } = row

    return {
      ...rest,
      current: token === currentToken,
    }
  })
})
