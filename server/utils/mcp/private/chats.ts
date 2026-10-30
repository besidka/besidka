import type { SQL } from 'drizzle-orm'
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  or,
} from 'drizzle-orm'
import { createError } from 'evlog'
import {
  MIN_SEARCH_LENGTH,
  SNIPPET_END,
  SNIPPET_START,
} from '#shared/utils/search'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import type { MessageUsage } from '#shared/types/message-usage.d'
import * as schema from '~~/server/db/schema'
import { buildChatSharedColumn } from '~~/server/utils/chats/share'
import { buildActiveShareFilter } from '~~/server/utils/chats/share-management'
import {
  createHistoryCursor,
  parseHistoryCursor,
} from '~~/server/utils/chats/history/cursor'
import {
  MAX_SEARCH_RESULTS,
  SEARCH_CANDIDATE_MESSAGE_LIMIT,
  findChatsMatchingMessageContent,
} from '~~/server/utils/chats/history/search'
import type { ContentSearchHit } from '~~/server/utils/chats/history/search'
import {
  createSearchCursor,
  parseSearchCursor,
} from '~~/server/utils/chats/history/search-cursor'
import { containsLikeEscaped } from '~~/server/utils/db/like'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'
import {
  toMcpShareSummary,
} from '~~/server/utils/mcp/private/chat-share-summary'
import { resolveMcpChatProject } from '~~/server/utils/mcp/private/chat-project'
import { toIsoTimestamp, truncateMcpText } from '~~/server/utils/mcp/private/text'

type DbClient = ReturnType<typeof useDb>

export const MCP_CHAT_LIST_DEFAULT_LIMIT = 20
export const MCP_CHAT_LIST_MAX_LIMIT = 50
export const MCP_CHAT_DEFAULT_MESSAGES = 50
export const MCP_CHAT_MAX_MESSAGES = 200
export const MCP_CHAT_MESSAGE_MAX_CHARS = 8000
export const MCP_CHAT_TOTAL_MAX_CHARS = 100_000

const MAX_BATCH_QUERY_PARAMS = 90

export const mcpChatSearchTargets = ['all', 'title', 'content'] as const

export type McpChatSearchTarget = typeof mcpChatSearchTargets[number]

export interface McpChatListInput {
  cursor?: string
  limit?: number
  search?: string
  searchIn?: McpChatSearchTarget
  projectId?: string
  pinnedOnly?: boolean
}

export interface McpChatSummary {
  slug: string
  title: string
  projectId: string | null
  projectName: string | null
  pinned: boolean
  shared: boolean
  memoryExcluded: boolean
  createdAt: string | null
  activityAt: string | null
  matchedIn?: 'title' | 'content' | 'both'
  snippet?: string
}

interface ChatListRow {
  id: string
  slug: string
  title: string | null
  projectId: string | null
  projectName: string | null
  pinnedAt: Date | null
  shared: boolean
  memoryExcluded: boolean | null
  createdAt: Date
  activityAt: Date
}

interface StoredMessagePart {
  type?: unknown
  text?: unknown
}

export interface McpChatMessageRow {
  publicId: string | null
  role: string
  parts: unknown
  usage: MessageUsage | null
  createdAt: Date
}

export interface McpChatMessage {
  id: string | null
  role: 'user' | 'assistant'
  model?: string
  createdAt: string | null
  text: string
  truncated?: true
}

export interface McpChatTranscript {
  messages: McpChatMessage[]
  omittedMessages: number
  truncated: boolean
}

function buildChatListColumns() {
  return {
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
    pinnedAt: schema.chats.pinnedAt,
    shared: buildChatSharedColumn(),
    memoryExcluded: schema.chats.memoryExcluded,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
  }
}

export function createInvalidMcpCursorError() {
  return createError({
    status: 400,
    message: 'The cursor is not valid. Omit it to start at the first page, '
      + 'or pass nextCursor from the previous page unchanged.',
  })
}

export function isValidMcpCursorId(id: string): boolean {
  return decodeKnowledgeEntityId(id) !== null
}

export function parseMcpHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null
  }

  const parsed = parseHistoryCursor(cursor)

  if (!parsed || !isValidMcpCursorId(parsed.id)) {
    throw createInvalidMcpCursorError()
  }

  return parsed
}

export function parseMcpSearchCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }

  const offset = parseSearchCursor(cursor)

  if (offset === null) {
    throw createInvalidMcpCursorError()
  }

  return offset
}

export function clampMcpLimit(
  limit: number | undefined,
  fallback: number,
  max: number,
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback
  }

  return Math.min(max, Math.max(1, Math.trunc(limit)))
}

export function cleanSearchSnippet(snippet: string): string {
  return snippet.split(SNIPPET_START).join('').split(SNIPPET_END).join('')
}

function toChatSummary(row: ChatListRow): McpChatSummary {
  return {
    slug: row.slug,
    title: row.title ?? '',
    projectId: row.projectId,
    projectName: row.projectName,
    pinned: row.pinnedAt !== null,
    shared: row.shared,
    memoryExcluded: row.memoryExcluded === true,
    createdAt: toIsoTimestamp(row.createdAt),
    activityAt: toIsoTimestamp(row.activityAt),
  }
}

export function mergeChatSearchResults(
  titleMatches: ChatListRow[],
  contentHits: ContentSearchHit[],
  contentChats: Map<string, ChatListRow>,
): McpChatSummary[] {
  const hitsByChatId = new Map(contentHits.map((hit) => {
    return [hit.chatId, hit]
  }))
  const titleIds = new Set(titleMatches.map((chat) => {
    return chat.id
  }))
  const merged: McpChatSummary[] = titleMatches.map((chat) => {
    const hit = hitsByChatId.get(chat.id)

    return {
      ...toChatSummary(chat),
      matchedIn: hit ? 'both' : 'title',
      ...(hit ? { snippet: cleanSearchSnippet(hit.snippet) } : {}),
    }
  })

  for (const hit of contentHits) {
    const chat = contentChats.get(hit.chatId)

    if (!chat || titleIds.has(hit.chatId)) {
      continue
    }

    merged.push({
      ...toChatSummary(chat),
      matchedIn: 'content',
      snippet: cleanSearchSnippet(hit.snippet),
    })
  }

  return merged
}

async function buildChatFilterConditions(
  db: DbClient,
  userId: number,
  filters: Pick<McpChatListInput, 'projectId' | 'pinnedOnly'>,
): Promise<SQL[]> {
  const conditions: SQL[] = []

  if (filters.projectId !== undefined) {
    const project = await resolveMcpChatProject(db, userId, filters.projectId)

    conditions.push(eq(schema.chats.projectId, project.id))
  }

  if (filters.pinnedOnly) {
    conditions.push(isNotNull(schema.chats.pinnedAt))
  }

  return conditions
}

async function loadChatsById(
  db: DbClient,
  userId: number,
  chatIds: string[],
  filterConditions: SQL[],
): Promise<Map<string, ChatListRow>> {
  const chats = new Map<string, ChatListRow>()

  for (
    let offset = 0;
    offset < chatIds.length;
    offset += MAX_BATCH_QUERY_PARAMS
  ) {
    const chunk = chatIds.slice(offset, offset + MAX_BATCH_QUERY_PARAMS)
    const rows = await db.select(buildChatListColumns())
      .from(schema.chats)
      .leftJoin(
        schema.projects,
        eq(schema.projects.id, schema.chats.projectId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        inArray(schema.chats.id, chunk),
        ...filterConditions,
      ))
      .limit(chunk.length)

    for (const row of rows) {
      chats.set(row.id, row)
    }
  }

  return chats
}

async function searchMcpChats(
  db: DbClient,
  userId: number,
  input: Required<Pick<McpChatListInput, 'search' | 'searchIn'>> & {
    cursor?: string
    limit: number
  },
  filterConditions: SQL[],
  logger: LoggerLike,
) {
  const offset = parseMcpSearchCursor(input.cursor)
  const titleMatches = input.searchIn === 'content'
    ? []
    : await db.select(buildChatListColumns())
      .from(schema.chats)
      .leftJoin(
        schema.projects,
        eq(schema.projects.id, schema.chats.projectId),
      )
      .where(and(
        eq(schema.chats.userId, userId),
        containsLikeEscaped(schema.chats.title, input.search),
        ...filterConditions,
      ))
      .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
      .limit(MAX_SEARCH_RESULTS)
  const contentHits = input.searchIn === 'title'
    ? []
    : await findChatsMatchingMessageContent({
      db,
      userId,
      search: input.search,
      limit: SEARCH_CANDIDATE_MESSAGE_LIMIT,
      logger,
    })
  const titleIds = new Set(titleMatches.map((chat) => {
    return chat.id
  }))
  const contentChats = await loadChatsById(
    db,
    userId,
    contentHits
      .map((hit) => {
        return hit.chatId
      })
      .filter((chatId) => {
        return !titleIds.has(chatId)
      }),
    filterConditions,
  )
  const merged = mergeChatSearchResults(
    titleMatches,
    contentHits,
    contentChats,
  )
  const nextOffset = offset + input.limit
  const nextCursor = nextOffset < merged.length
    && nextOffset < MAX_SEARCH_RESULTS
    ? createSearchCursor(nextOffset)
    : null

  return {
    chats: merged.slice(offset, nextOffset),
    nextCursor,
    searchCapped: merged.length >= MAX_SEARCH_RESULTS,
  }
}

export async function listMcpChats(
  db: DbClient,
  userId: number,
  input: McpChatListInput,
  logger: LoggerLike,
) {
  const limit = clampMcpLimit(
    input.limit,
    MCP_CHAT_LIST_DEFAULT_LIMIT,
    MCP_CHAT_LIST_MAX_LIMIT,
  )
  const search = input.search?.trim() ?? ''

  if (search.length >= MIN_SEARCH_LENGTH) {
    return await searchMcpChats(db, userId, {
      search,
      searchIn: input.searchIn ?? 'all',
      cursor: input.cursor,
      limit,
    }, await buildChatFilterConditions(db, userId, input), logger)
  }

  const cursor = parseMcpHistoryCursor(input.cursor)
  const filterConditions = await buildChatFilterConditions(db, userId, input)
  const rows = await db.select(buildChatListColumns())
    .from(schema.chats)
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      ...filterConditions,
      cursor
        ? or(
          lt(schema.chats.activityAt, cursor.activityAt),
          and(
            eq(schema.chats.activityAt, cursor.activityAt),
            lt(schema.chats.id, cursor.id),
          ),
        )
        : undefined,
    ))
    .orderBy(desc(schema.chats.activityAt), desc(schema.chats.id))
    .limit(limit)
  const lastRow = rows[rows.length - 1]

  return {
    chats: rows.map(toChatSummary),
    nextCursor: rows.length === limit && lastRow
      ? createHistoryCursor(lastRow)
      : null,
  }
}

export function extractMessageText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return ''
  }

  return parts
    .filter((part: StoredMessagePart) => {
      return part?.type === 'text' && typeof part.text === 'string'
    })
    .map((part: StoredMessagePart) => {
      return part.text as string
    })
    .join('\n\n')
}

/**
 * Builds a newest-last transcript of text parts only. Messages are taken
 * from the newest backwards until the total character budget is spent, so
 * the oldest ones are the ones dropped.
 */
export function buildMcpChatTranscript(
  rowsNewestFirst: McpChatMessageRow[],
  options: { messageMaxChars: number, totalMaxChars: number },
): McpChatTranscript {
  const kept: McpChatMessage[] = []
  let usedChars = 0
  let truncated = false

  for (const row of rowsNewestFirst) {
    if (!isPersistedMessageRole(row.role)) {
      continue
    }

    const remaining = options.totalMaxChars - usedChars

    if (remaining <= 0) {
      truncated = true

      break
    }

    const message = truncateMcpText(
      extractMessageText(row.parts),
      Math.min(options.messageMaxChars, remaining),
    )

    usedChars += message.text.length
    truncated ||= message.truncated
    kept.push({
      id: row.publicId,
      role: row.role,
      ...(row.role === 'assistant' && row.usage?.model
        ? { model: row.usage.model }
        : {}),
      createdAt: toIsoTimestamp(row.createdAt),
      text: message.text,
      ...(message.truncated ? { truncated: true as const } : {}),
    })
  }

  return {
    messages: kept.reverse(),
    omittedMessages: rowsNewestFirst.length - kept.length,
    truncated,
  }
}

export function collectChatModels(rows: McpChatMessageRow[]): string[] {
  const models = new Set<string>()

  for (const row of rows) {
    if (row.usage?.model) {
      models.add(row.usage.model)
    }
  }

  return [...models]
}

export async function getMcpChat(
  db: DbClient,
  userId: number,
  input: {
    slug: string
    maxMessages?: number
    siteUrl: string
    includeShareUrl?: boolean
  },
) {
  const chat = await db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
    pinnedAt: schema.chats.pinnedAt,
    memoryExcluded: schema.chats.memoryExcluded,
    createdAt: schema.chats.createdAt,
    activityAt: schema.chats.activityAt,
  })
    .from(schema.chats)
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
    )
    .where(and(
      eq(schema.chats.slug, input.slug),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    throw createError({
      status: 404,
      message: `No chat with the slug "${input.slug}". Call list_chats `
        + 'to find one.',
    })
  }

  const share = await db.select({
    slug: schema.chatShares.slug,
    expiresAt: schema.chatShares.expiresAt,
    indexable: schema.chatShares.indexable,
    showFiles: schema.chatShares.showFiles,
    allowBranch: schema.chatShares.allowBranch,
  })
    .from(schema.chatShares)
    .where(and(
      eq(schema.chatShares.chatId, chat.id),
      buildActiveShareFilter(),
    ))
    .limit(1)
    .get()
  const maxMessages = clampMcpLimit(
    input.maxMessages,
    MCP_CHAT_DEFAULT_MESSAGES,
    MCP_CHAT_MAX_MESSAGES,
  )
  const rows = await db.select({
    publicId: schema.messages.publicId,
    role: schema.messages.role,
    parts: schema.messages.parts,
    usage: schema.messages.usage,
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chat.id))
    .orderBy(desc(schema.messages.id))
    .limit(maxMessages + 1)
  const hasOlderMessages = rows.length > maxMessages
  const window = rows.slice(0, maxMessages)
  const transcript = buildMcpChatTranscript(window, {
    messageMaxChars: MCP_CHAT_MESSAGE_MAX_CHARS,
    totalMaxChars: MCP_CHAT_TOTAL_MAX_CHARS,
  })

  return {
    slug: chat.slug,
    title: chat.title ?? '',
    projectId: chat.projectId,
    projectName: chat.projectName,
    pinned: chat.pinnedAt !== null,
    memoryExcluded: chat.memoryExcluded === true,
    share: share
      ? toMcpShareSummary(
        input.siteUrl,
        share,
        input.includeShareUrl === true,
      )
      : null,
    createdAt: toIsoTimestamp(chat.createdAt),
    activityAt: toIsoTimestamp(chat.activityAt),
    models: collectChatModels(window),
    hasOlderMessages: hasOlderMessages || transcript.omittedMessages > 0,
    truncated: transcript.truncated,
    messages: transcript.messages,
  }
}
