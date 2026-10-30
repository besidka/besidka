import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { branchChat } from '~~/server/utils/chats/branch'
import {
  isChatGenerating,
} from '~~/server/utils/chats/generation-in-progress'
import { createHistoryCursor } from '~~/server/utils/chats/history/cursor'
import {
  deleteChat,
  deleteChatMessage,
  moveChatsToProject,
  renameChat,
  setChatMemoryExclusion,
  setChatPinnedAt,
} from '~~/server/utils/chats/lifecycle'
import type { OwnedChatRef } from '~~/server/utils/chats/lifecycle'
import {
  buildActiveShareFilter,
  revokeChatShares,
} from '~~/server/utils/chats/share-management'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import {
  MCP_CHAT_LIST_DEFAULT_LIMIT,
  MCP_CHAT_LIST_MAX_LIMIT,
  clampMcpLimit,
  parseMcpHistoryCursor,
} from '~~/server/utils/mcp/private/chats'
import { resolveMcpChatProject } from '~~/server/utils/mcp/private/chat-project'
import type {
  McpChatProject,
} from '~~/server/utils/mcp/private/chat-project'
import { buildMcpShareUrl } from '~~/server/utils/mcp/private/chat-share-summary'
import { toIsoTimestamp } from '~~/server/utils/mcp/private/text'

type DbClient = ReturnType<typeof useDb>

export const MCP_MOVE_CHATS_MAX = 100
export const MCP_DELETE_CHATS_MAX = 25
export const MCP_REVOKE_SHARES_MAX = 90

const MAX_BATCH_QUERY_PARAMS = 90

export type McpChatDeleteSkipReason = 'not_found' | 'generating' | 'error'

export interface McpChatUpdateInput {
  slug: string
  title?: string
  pinned?: boolean
  memoryExcluded?: boolean
  projectId?: string | null
}

export interface McpChatState {
  slug: string
  title: string
  pinned: boolean
  memoryExcluded: boolean
  projectId: string | null
  projectName: string | null
}

interface OwnedChatRow extends OwnedChatRef {
  slug: string
  title: string | null
  pinnedAt: Date | null
  memoryExcluded: boolean | null
}

const ownedChatColumns = {
  id: schema.chats.id,
  slug: schema.chats.slug,
  title: schema.chats.title,
  projectId: schema.chats.projectId,
  pinnedAt: schema.chats.pinnedAt,
  memoryExcluded: schema.chats.memoryExcluded,
}

function createChatNotFoundError(slug: string) {
  return createError({
    status: 404,
    message: `No chat with the slug "${slug}". Call list_chats to find one.`,
  })
}

function uniqueSlugs(slugs: string[]): string[] {
  return [...new Set(slugs)]
}

async function requireOwnedChat(
  db: DbClient,
  userId: number,
  slug: string,
): Promise<OwnedChatRow> {
  const chat = await db.select(ownedChatColumns)
    .from(schema.chats)
    .where(and(
      eq(schema.chats.slug, slug),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    throw createChatNotFoundError(slug)
  }

  return chat
}

async function findOwnedChatsBySlugs(
  db: DbClient,
  userId: number,
  slugs: string[],
): Promise<Map<string, OwnedChatRow>> {
  const chats = new Map<string, OwnedChatRow>()

  for (
    let offset = 0;
    offset < slugs.length;
    offset += MAX_BATCH_QUERY_PARAMS
  ) {
    const chunk = slugs.slice(offset, offset + MAX_BATCH_QUERY_PARAMS)
    const rows = await db.select(ownedChatColumns)
      .from(schema.chats)
      .where(and(
        eq(schema.chats.userId, userId),
        inArray(schema.chats.slug, chunk),
      ))
      .limit(chunk.length)

    for (const row of rows) {
      chats.set(row.slug, row)
    }
  }

  return chats
}

async function assertChatNotGenerating(chatId: string): Promise<void> {
  const isGenerating = await isChatGenerating(chatId)

  if (!isGenerating) {
    return
  }

  throw createError({
    status: 409,
    message: 'This chat is generating a reply right now.',
    fix: 'Wait for the reply to finish, then try again.',
  })
}

async function readChatState(
  db: DbClient,
  userId: number,
  chatId: string,
): Promise<McpChatState> {
  const chat = await db.select({
    slug: schema.chats.slug,
    title: schema.chats.title,
    pinnedAt: schema.chats.pinnedAt,
    memoryExcluded: schema.chats.memoryExcluded,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
  })
    .from(schema.chats)
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
    )
    .where(and(
      eq(schema.chats.id, chatId),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    throw createError({
      status: 404,
      message: 'The chat no longer exists.',
    })
  }

  return {
    slug: chat.slug,
    title: chat.title ?? '',
    pinned: chat.pinnedAt !== null,
    memoryExcluded: chat.memoryExcluded === true,
    projectId: chat.projectId,
    projectName: chat.projectName,
  }
}

/**
 * Sets any of title, pinned, memoryExcluded and projectId on one chat. Every
 * field is a target state: a field that already holds the value is skipped,
 * so repeating a call changes nothing. A foreign or malformed project id is
 * refused before anything is written.
 */
export async function updateMcpChat(
  db: DbClient,
  userId: number,
  input: McpChatUpdateInput,
  logger: LoggerLike,
): Promise<McpChatState> {
  if (
    input.title === undefined
    && input.pinned === undefined
    && input.memoryExcluded === undefined
    && input.projectId === undefined
  ) {
    throw createError({
      status: 400,
      message: 'Pass at least one of title, pinned, memoryExcluded or '
        + 'projectId.',
    })
  }

  const chat = await requireOwnedChat(db, userId, input.slug)
  const targetProject: McpChatProject | null = input.projectId
    ? await resolveMcpChatProject(db, userId, input.projectId)
    : null
  const nextTitle = input.title !== undefined
    && input.title !== (chat.title ?? '')
    ? input.title
    : null
  const nextPinned = input.pinned !== undefined
    && input.pinned !== (chat.pinnedAt !== null)
    ? input.pinned
    : null
  const nextMemoryExcluded = input.memoryExcluded !== undefined
    && input.memoryExcluded !== (chat.memoryExcluded === true)
    ? input.memoryExcluded
    : null
  const shouldMove = input.projectId !== undefined
    && (targetProject?.id ?? null) !== chat.projectId
  const current: OwnedChatRef = { id: chat.id, projectId: chat.projectId }

  if (nextMemoryExcluded !== null) {
    await enforceMemoryRateLimit('write', userId)
  }

  if (nextTitle !== null) {
    await renameChat(db, userId, current, nextTitle)
  }

  if (nextPinned !== null) {
    await setChatPinnedAt(db, userId, current, nextPinned ? new Date() : null)
  }

  if (nextMemoryExcluded !== null) {
    await setChatMemoryExclusion(
      db,
      userId,
      chat.slug,
      nextMemoryExcluded,
      logger,
      { forwardOnly: true },
    )
  }

  if (shouldMove) {
    await moveChatsToProject(db, userId, [current], targetProject)
  }

  return await readChatState(db, userId, chat.id)
}

/**
 * Moves chats into a project, or out of any project when `projectId` is
 * null. Slugs that are not the user's chats are reported, not refused.
 */
export async function moveMcpChatsToProject(
  db: DbClient,
  userId: number,
  input: { slugs: string[], projectId: string | null },
) {
  const slugs = uniqueSlugs(input.slugs)
  const project = input.projectId === null
    ? null
    : await resolveMcpChatProject(db, userId, input.projectId)
  const ownedChats = await findOwnedChatsBySlugs(db, userId, slugs)
  const chatsToMove = [...ownedChats.values()].filter((chat) => {
    return chat.projectId !== (project?.id ?? null)
  })

  if (chatsToMove.length > 0) {
    await moveChatsToProject(db, userId, chatsToMove, project)
  }

  return {
    moved: chatsToMove.length,
    alreadyThere: ownedChats.size - chatsToMove.length,
    notFound: slugs.filter((slug) => {
      return !ownedChats.has(slug)
    }),
  }
}

/**
 * Hard-deletes chats one at a time through the single-chat delete path, so
 * memory provenance, the search index and orphaned files are all cleaned up.
 * A chat that is generating a reply is skipped, not deleted (a best-effort
 * check). A chat whose delete throws is skipped with the reason `error` and
 * the loop goes on, so the result always lists what was already deleted.
 */
export async function deleteMcpChats(
  db: DbClient,
  userId: number,
  input: { slugs: string[] },
  logger: LoggerLike,
) {
  const slugs = uniqueSlugs(input.slugs)
  const ownedChats = await findOwnedChatsBySlugs(db, userId, slugs)
  const deleted: string[] = []
  const skipped: Array<{ slug: string, reason: McpChatDeleteSkipReason }> = []

  for (const slug of slugs) {
    const chat = ownedChats.get(slug)

    if (!chat) {
      skipped.push({ slug, reason: 'not_found' })

      continue
    }

    if (await isChatGenerating(chat.id)) {
      skipped.push({ slug, reason: 'generating' })

      continue
    }

    try {
      await deleteChat(db, userId, chat, logger)
      deleted.push(slug)
    } catch (exception) {
      logger.set({
        attributes: {
          mcpChatDelete: exceptionSummary(exception),
        },
      })
      skipped.push({ slug, reason: 'error' })
    }
  }

  return { deleted, skipped }
}

/**
 * Deletes one message of a chat that is not generating. The only message of
 * a chat cannot be deleted, the chat has to be.
 */
export async function deleteMcpChatMessage(
  db: DbClient,
  userId: number,
  input: { slug: string, messageId: string },
  logger: LoggerLike,
) {
  const chat = await requireOwnedChat(db, userId, input.slug)

  await assertChatNotGenerating(chat.id)
  await deleteChatMessage(db, userId, chat.id, input.messageId, logger)

  return { slug: chat.slug, messageId: input.messageId, deleted: true }
}

/**
 * Lists the chats with a live share link, most recent activity first.
 */
export async function listMcpSharedChats(
  db: DbClient,
  userId: number,
  input: {
    cursor?: string
    limit?: number
    siteUrl: string
    includeShareUrl?: boolean
  },
) {
  const limit = clampMcpLimit(
    input.limit,
    MCP_CHAT_LIST_DEFAULT_LIMIT,
    MCP_CHAT_LIST_MAX_LIMIT,
  )
  const cursor = parseMcpHistoryCursor(input.cursor)
  const rows = await db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    activityAt: schema.chats.activityAt,
    shareSlug: schema.chatShares.slug,
    expiresAt: schema.chatShares.expiresAt,
    indexable: schema.chatShares.indexable,
    showFiles: schema.chatShares.showFiles,
    allowBranch: schema.chatShares.allowBranch,
  })
    .from(schema.chats)
    .innerJoin(
      schema.chatShares,
      eq(schema.chatShares.chatId, schema.chats.id),
    )
    .where(and(
      eq(schema.chats.userId, userId),
      buildActiveShareFilter(),
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
    chats: rows.map((row) => {
      return {
        slug: row.slug,
        title: row.title ?? '',
        ...(input.includeShareUrl
          ? { shareUrl: buildMcpShareUrl(input.siteUrl, row.shareSlug) }
          : {}),
        expiresAt: toIsoTimestamp(row.expiresAt),
        indexable: row.indexable,
        showFiles: row.showFiles,
        allowBranch: row.allowBranch,
      }
    }),
    nextCursor: rows.length === limit && lastRow
      ? createHistoryCursor(lastRow)
      : null,
  }
}

/**
 * Revokes the public share links of chats. A slug that is not the user's
 * chat reads the same as a chat that was never shared, so a foreign slug
 * cannot be told apart.
 */
export async function revokeMcpChatShares(
  db: DbClient,
  userId: number,
  input: { slugs: string[] },
) {
  const slugs = uniqueSlugs(input.slugs)
  const ownedChats = await findOwnedChatsBySlugs(db, userId, slugs)
  const { revokedChatIds } = await revokeChatShares(
    db,
    userId,
    [...ownedChats.values()].map(chat => chat.id),
  )
  const revokedIds = new Set(revokedChatIds)
  const revoked = slugs.filter((slug) => {
    const chat = ownedChats.get(slug)

    return chat !== undefined && revokedIds.has(chat.id)
  })
  const revokedSlugs = new Set(revoked)

  return {
    revoked,
    notShared: slugs.filter((slug) => {
      return !revokedSlugs.has(slug)
    }),
  }
}

/**
 * Copies a chat that is not generating, or its start up to a message, into a
 * new chat in the same project.
 */
export async function branchMcpChat(
  db: DbClient,
  userId: number,
  input: { slug: string, messageId?: string },
  logger: LoggerLike,
) {
  const chat = await requireOwnedChat(db, userId, input.slug)

  await assertChatNotGenerating(chat.id)

  const branch = await branchChat(
    db,
    userId,
    chat.slug,
    input.messageId,
    logger,
  )

  return { slug: branch.slug, title: branch.title }
}
