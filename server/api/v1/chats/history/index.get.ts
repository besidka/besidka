import {
  and,
  desc,
  eq,
  exists,
  isNotNull,
  isNull,
  like,
  lt,
  or,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  compareHistoryCursorRows,
  createHistoryCursor,
  parseHistoryCursor,
} from '~~/server/utils/chats/history/cursor'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const PINNED_LIMIT = 50
const MIN_SEARCH_LENGTH = 2

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = getQuery(useEvent())
  const cursor = query.cursor as string | undefined
  const rawLimit = query.limit
    ? parseInt(query.limit as string)
    : DEFAULT_LIMIT
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
  const search = (query.search as string | undefined)?.trim() ?? ''
  const hasSearch = search.length >= MIN_SEARCH_LENGTH

  const db = useDb()
  const userId = parseInt(session.user.id)
  const parsedCursor = parseHistoryCursor(cursor)

  const columns = {
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
    pinnedAt: schema.chats.pinnedAt,
    folderId: schema.chats.folderId,
    folderName: schema.folders.name,
  }

  const searchPattern = hasSearch ? `%${search}%` : null

  const titleFilter = searchPattern
    ? like(schema.chats.title, searchPattern)
    : undefined

  const cursorFilter = parsedCursor
    ? or(
      lt(schema.chats.activityAt, parsedCursor.activityAt),
      and(
        eq(schema.chats.activityAt, parsedCursor.activityAt),
        lt(schema.chats.id, parsedCursor.id),
      ),
    )
    : undefined

  if (hasSearch) {
    const titleMatchQuery = db.select(columns)
      .from(schema.chats)
      .leftJoin(
        schema.folders,
        eq(schema.folders.id, schema.chats.folderId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        titleFilter,
      ))
      .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
      .limit(limit)

    const contentMatchQuery = db.select(columns)
      .from(schema.chats)
      .leftJoin(
        schema.folders,
        eq(schema.folders.id, schema.chats.folderId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        exists(
          db.select({ id: schema.messages.id })
            .from(schema.messages)
            .where(and(
              eq(schema.messages.chatId, schema.chats.id),
              like(schema.messages.parts, searchPattern!),
            )),
        ),
      ))
      .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
      .limit(limit)

    const [titleMatches, contentMatches] = await db.batch([
      titleMatchQuery,
      contentMatchQuery,
    ])

    const seen = new Set<string>()
    const merged: Array<typeof titleMatches[number]> = []

    for (const chat of titleMatches) {
      if (!seen.has(chat.id)) {
        seen.add(chat.id)
        merged.push(chat)
      }
    }

    for (const chat of contentMatches) {
      if (!seen.has(chat.id)) {
        seen.add(chat.id)
        merged.push({
          id: chat.id,
          slug: chat.slug,
          title: chat.title,
          createdAt: chat.createdAt,
          activityAt: chat.activityAt,
          pinnedAt: chat.pinnedAt,
          folderId: chat.folderId,
          folderName: chat.folderName,
        })
      }
    }

    merged.sort(compareHistoryCursorRows)

    const pinned = merged.filter(chat => chat.pinnedAt !== null)
    const chats = merged.filter(chat => chat.pinnedAt === null)

    return {
      pinned,
      chats,
      nextCursor: null,
    }
  }

  const pinnedQuery = db.select(columns)
    .from(schema.chats)
    .leftJoin(
      schema.folders,
      eq(schema.folders.id, schema.chats.folderId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      isNotNull(schema.chats.pinnedAt),
    ))
    .orderBy(desc(schema.chats.pinnedAt))
    .limit(PINNED_LIMIT)

  const chatsQuery = db.select(columns)
    .from(schema.chats)
    .leftJoin(
      schema.folders,
      eq(schema.folders.id, schema.chats.folderId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      isNull(schema.chats.pinnedAt),
      cursorFilter,
    ))
    .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
    .limit(limit)

  const [pinned, chats] = await db.batch([pinnedQuery, chatsQuery])

  const lastChat = chats[chats.length - 1]
  const nextCursor = chats.length === limit && lastChat
    ? createHistoryCursor(lastChat)
    : null

  return {
    pinned,
    chats,
    nextCursor,
  }
})
