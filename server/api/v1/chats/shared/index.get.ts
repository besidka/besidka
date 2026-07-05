import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm'
import { useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  createHistoryCursor,
  parseHistoryCursor,
} from '~~/server/utils/chats/history/cursor'
import { parsePaginationLimit } from '~~/server/utils/pagination/limit'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = getQuery(event)
  const cursor = query.cursor as string | undefined
  const limit = parsePaginationLimit(
    query.limit as string | undefined,
    DEFAULT_LIMIT,
    MAX_LIMIT,
  )

  const db = useDb()
  const userId = parseInt(session.user.id)
  const parsedCursor = parseHistoryCursor(cursor)
  const now = new Date()

  logger.set({ userId, hasCursor: !!parsedCursor, limit })

  const cursorFilter = parsedCursor
    ? or(
      lt(schema.chats.activityAt, parsedCursor.activityAt),
      and(
        eq(schema.chats.activityAt, parsedCursor.activityAt),
        lt(schema.chats.id, parsedCursor.id),
      ),
    )
    : undefined

  const chats = await db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
    pinnedAt: schema.chats.pinnedAt,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
    shareSlug: schema.chatShares.slug,
    expiresAt: schema.chatShares.expiresAt,
    showAuthorAvatar: schema.chatShares.showAuthorAvatar,
  })
    .from(schema.chats)
    .innerJoin(
      schema.chatShares,
      eq(schema.chatShares.chatId, schema.chats.id),
    )
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      eq(schema.chatShares.revoked, false),
      or(
        isNull(schema.chatShares.expiresAt),
        gt(schema.chatShares.expiresAt, now),
      ),
      cursorFilter,
    ))
    .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
    .limit(limit)

  const sharedChats = chats.map((chat) => {
    return { ...chat, shared: true }
  })

  const lastChat = sharedChats[sharedChats.length - 1]
  const nextCursor = sharedChats.length === limit && lastChat
    ? createHistoryCursor(lastChat)
    : null

  return {
    chats: sharedChats,
    nextCursor,
  }
})
