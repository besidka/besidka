import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  const columns = {
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    pinnedAt: schema.chats.pinnedAt,
  }

  const [pinned, all] = await db.batch([
    db.select(columns)
      .from(schema.chats)
      .where(and(
        eq(schema.chats.userId, userId),
        isNotNull(schema.chats.pinnedAt),
      ))
      .orderBy(desc(schema.chats.pinnedAt))
      .limit(50),

    db.select(columns)
      .from(schema.chats)
      .where(and(
        eq(schema.chats.userId, userId),
        isNull(schema.chats.pinnedAt),
      ))
      .orderBy(desc(schema.chats.createdAt))
      .limit(100),
  ])

  return { pinned, all }
})
