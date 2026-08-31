import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from 'drizzle-orm'
import { useLogger } from 'evlog'
import { z } from 'zod'
import { MIN_SEARCH_LENGTH } from '#shared/utils/search'
import * as schema from '~~/server/db/schema'
import { buildChatSharedColumn } from '~~/server/utils/chats/share'
import {
  createHistoryCursor,
  parseHistoryCursor,
} from '~~/server/utils/chats/history/cursor'
import {
  findChatsMatchingMessageContent,
  MAX_SEARCH_RESULTS,
  SEARCH_CANDIDATE_MESSAGE_LIMIT,
  type ContentSearchHit,
} from '~~/server/utils/chats/history/search'
import {
  createSearchCursor,
  parseSearchCursor,
} from '~~/server/utils/chats/history/search-cursor'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { parsePaginationLimit } from '~~/server/utils/pagination/limit'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_PINNED = 50
const MAX_PINNED_ID_LOOKUP = 1000
const MAX_BATCH_QUERY_PARAMS = 90

const searchInSchema = z.enum(['all', 'title', 'content']).default('all')

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
  const search = (query.search as string | undefined)?.trim() ?? ''
  const hasSearch = search.length >= MIN_SEARCH_LENGTH

  const db = useDb()
  const userId = parseInt(session.user.id)
  const parsedCursor = parseHistoryCursor(cursor)

  logger.set({
    userId,
    hasSearch,
    hasCursor: !!parsedCursor,
    limit,
  })

  const columns = {
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
    pinnedAt: schema.chats.pinnedAt,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
    shared: buildChatSharedColumn(),
  }

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
    ? containsLikeEscaped(schema.chats.title, search)
    : undefined

  if (hasSearch) {
    const searchInResult = searchInSchema.safeParse(query.searchIn)
    const searchIn = searchInResult.success ? searchInResult.data : 'all'
    const searchOffset = parseSearchCursor(cursor) ?? 0
    const runTitleLegs = searchIn !== 'content'
    const runContentLeg = searchIn !== 'title'

    const titleQuery = db.select(columns)
      .from(schema.chats)
      .leftJoin(
        schema.projects,
        eq(schema.projects.id, schema.chats.projectId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        isNull(schema.chats.pinnedAt),
        searchFilter,
      ))
      .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
      .limit(MAX_SEARCH_RESULTS)

    let pinned: Awaited<typeof titleQuery> = []
    let titleMatches: Awaited<typeof titleQuery> = []
    let pinnedMatchIds: string[] = []

    if (runTitleLegs && searchOffset === 0) {
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
        .limit(MAX_PINNED)

      const legs = await db.batch([pinnedQuery, titleQuery])

      pinned = legs[0]
      titleMatches = legs[1]
      pinnedMatchIds = pinned.map(chat => chat.id)
    } else if (runTitleLegs) {
      // The full `pinned` array (with `pinnedAt` ordering and every
      // column) only ever renders on the first page. But a pinned chat
      // matching the title filter must still be excluded from later
      // pages' content-only results, since it was already shown via
      // `pinned` on page 1 — so every page cheaply re-derives just the
      // matching ids, skipping the expensive column/order-by work.
      const pinnedIdsQuery = db.select({ id: schema.chats.id })
        .from(schema.chats)
        .where(and(
          eq(schema.chats.userId, userId),
          isNotNull(schema.chats.pinnedAt),
          searchFilter,
        ))
        .limit(MAX_PINNED_ID_LOOKUP)

      const legs = await db.batch([pinnedIdsQuery, titleQuery])

      pinnedMatchIds = legs[0].map(row => row.id)
      titleMatches = legs[1]
    }

    let contentHits: ContentSearchHit[] = []

    if (runContentLeg) {
      try {
        contentHits = await findChatsMatchingMessageContent({
          db,
          userId,
          search,
          limit: SEARCH_CANDIDATE_MESSAGE_LIMIT,
          logger,
        })
      } catch (exception) {
        logger.set({
          messageSearchContent: {
            stage: 'history-search-merge',
            action: 'content-leg-failed',
          },
          attributes: {
            messageSearchContent: {
              error: exceptionMessage(exception),
            },
          },
        })

        contentHits = []
      }
    }

    type SearchChatRow = typeof titleMatches[number]
    type SearchResultChat = SearchChatRow & {
      matchedIn: 'title' | 'content' | 'both'
      snippet?: string | null
    }

    const contentHitsByChatId = new Map(
      contentHits.map(hit => [hit.chatId, hit]),
    )

    const attachTitleMatch = (chat: SearchChatRow): SearchResultChat => {
      const hit = contentHitsByChatId.get(chat.id)

      return {
        ...chat,
        matchedIn: hit ? 'both' : 'title',
        snippet: hit?.snippet ?? null,
      }
    }

    const pinnedWithMatch = pinned.map(attachTitleMatch)
    const titleMatchesWithMatch = titleMatches.map(attachTitleMatch)

    const matchedChatIds = new Set([
      ...pinnedMatchIds,
      ...titleMatches.map(chat => chat.id),
    ])

    const contentOnlyHits = contentHits.filter((hit) => {
      return !matchedChatIds.has(hit.chatId)
    })

    const contentOnlyChatsById = new Map<string, SearchChatRow>()

    for (
      let offset = 0;
      offset < contentOnlyHits.length;
      offset += MAX_BATCH_QUERY_PARAMS
    ) {
      const chunkChatIds = contentOnlyHits
        .slice(offset, offset + MAX_BATCH_QUERY_PARAMS)
        .map(hit => hit.chatId)

      const chunkChats = await db.select(columns)
        .from(schema.chats)
        .leftJoin(
          schema.projects,
          eq(schema.projects.id, schema.chats.projectId),
        )
        .where(and(
          eq(schema.chats.userId, userId),
          inArray(schema.chats.id, chunkChatIds),
        ))
        .limit(chunkChatIds.length)

      for (const chat of chunkChats) {
        contentOnlyChatsById.set(chat.id, chat)
      }
    }

    const contentOnlyMatches: SearchResultChat[] = []

    for (const hit of contentOnlyHits) {
      const chat = contentOnlyChatsById.get(hit.chatId)

      if (!chat) {
        continue
      }

      contentOnlyMatches.push({
        ...chat,
        matchedIn: 'content',
        snippet: hit.snippet,
      })
    }

    const merged = [...titleMatchesWithMatch, ...contentOnlyMatches]
    const page = merged.slice(searchOffset, searchOffset + limit)
    const nextOffset = searchOffset + limit
    const nextCursor = nextOffset < merged.length
      && nextOffset < MAX_SEARCH_RESULTS
      ? createSearchCursor(nextOffset)
      : null
    const searchCapped = merged.length >= MAX_SEARCH_RESULTS

    logger.set({
      searchIn,
      titleMatchCount: titleMatchesWithMatch.length,
      contentMatchCount: contentHits.length,
      mergedCount: merged.length,
      searchCapped,
    })

    return {
      pinned: pinnedWithMatch,
      chats: page,
      nextCursor,
      searchCapped,
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
    .limit(MAX_PINNED)

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
  }

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
