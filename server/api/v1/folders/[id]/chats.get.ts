import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_PINNED = 50

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(event, z.object({
    id: z.string().nonempty(),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  logger.set({ userId, folderId: params.data.id })

  const folder = await db.query.folders.findFirst({
    where(folders, { and, eq }) {
      return and(
        eq(folders.id, params.data.id),
        eq(folders.userId, userId),
      )
    },
    columns: {
      id: true,
      name: true,
      pinnedAt: true,
      archivedAt: true,
      activityAt: true,
      createdAt: true,
    },
  })

  if (!folder) {
    throw createError({
      message: 'Folder not found',
      status: 404,
    })
  }

  const query = getQuery(event)
  const cursor = query.cursor as string | undefined
  const rawLimit = query.limit
    ? parseInt(query.limit as string)
    : DEFAULT_LIMIT
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

  const cursorFilter = cursor
    ? lt(schema.chats.activityAt, new Date(cursor))
    : undefined

  const pinnedQuery = db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
    pinnedAt: schema.chats.pinnedAt,
    folderId: schema.chats.folderId,
    folderName: schema.folders.name,
  })
    .from(schema.chats)
    .leftJoin(
      schema.folders,
      eq(schema.folders.id, schema.chats.folderId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      eq(schema.chats.folderId, folder.id),
      isNotNull(schema.chats.pinnedAt),
    ))
    .orderBy(desc(schema.chats.pinnedAt))
    .limit(MAX_PINNED)

  const chatsQuery = db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
    pinnedAt: schema.chats.pinnedAt,
    folderId: schema.chats.folderId,
    folderName: schema.folders.name,
  })
    .from(schema.chats)
    .leftJoin(
      schema.folders,
      eq(schema.folders.id, schema.chats.folderId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      eq(schema.chats.folderId, folder.id),
      isNull(schema.chats.pinnedAt),
      cursorFilter,
    ))
    .orderBy(desc(schema.chats.activityAt))
    .limit(limit)

  const [pinned, chats] = await db.batch([pinnedQuery, chatsQuery])

  const lastChat = chats[chats.length - 1]
  const nextCursor = chats.length === limit && lastChat
    ? lastChat.activityAt.toISOString()
    : null

  return {
    folder,
    pinned,
    chats,
    nextCursor,
  }
})
