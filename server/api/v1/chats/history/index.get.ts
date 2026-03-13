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
  createHistoryCursor,
  parseHistoryCursor,
} from '~~/server/utils/chats/history/cursor'
import { parsePaginationLimit } from '~~/server/utils/pagination/limit'

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
  const limit = parsePaginationLimit(
    query.limit as string | undefined,
    DEFAULT_LIMIT,
    MAX_LIMIT,
  )
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
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
  }

  const searchPattern = hasSearch ? `%${search}%` : null

  const cursorFilter = parsedCursor
    ? or(
      lt(schema.chats.activityAt, parsedCursor.activityAt),
      and(
        eq(schema.chats.activityAt, parsedCursor.activityAt),
        lt(schema.chats.id, parsedCursor.id),
      ),
    )
    : undefined

  const searchFilter = hasSearch
    ? or(
      like(schema.chats.title, searchPattern!),
      exists(
        db.select({ id: schema.messages.id })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.chatId, schema.chats.id),
            like(schema.messages.parts, searchPattern!),
          )),
      ),
    )
    : undefined

  if (hasSearch) {
    const chatsQuery = db.select(columns)
      .from(schema.chats)
      .leftJoin(
        schema.projects,
        eq(schema.projects.id, schema.chats.projectId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        isNull(schema.chats.pinnedAt),
        searchFilter,
        cursorFilter,
      ))
      .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
      .limit(limit)
    if (parsedCursor) {
      const chats = await chatsQuery
      const lastChat = chats[chats.length - 1]
      const nextCursor = chats.length === limit && lastChat
        ? createHistoryCursor(lastChat)
        : null

      return {
        pinned: [],
        chats,
        nextCursor,
      }
    } else {
      const pinnedQuery = db.select(columns)
        .from(schema.chats)
        .leftJoin(
          schema.projects,
          eq(schema.projects.id, schema.chats.projectId),
        )
        .where(and(
          eq(schema.chats.userId, userId),
          isNotNull(schema.chats.pinnedAt),
          searchFilter,
        ))
        .orderBy(desc(schema.chats.pinnedAt))
        .limit(PINNED_LIMIT)

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
    }
  }

  const pinnedQuery = db.select(columns)
    .from(schema.chats)
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
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
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
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
