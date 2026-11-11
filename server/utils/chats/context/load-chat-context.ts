import { and, desc, eq } from 'drizzle-orm'
import type { ChatContextResponse } from '#shared/types/chat-context.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { CHAT_CONTEXT_MAX_MESSAGES } from '#shared/utils/chat-context'
import {
  getChatTotalCost,
  hydrateMessageUsage,
} from '#shared/utils/message-metadata'
import * as schema from '~~/server/db/schema'
import { buildActiveShareFilter } from '~~/server/utils/chats/share-management'
import type { ChatContextItems } from '~~/server/utils/chats/context/build-chat-context'
import { buildChatContext } from '~~/server/utils/chats/context/build-chat-context'
import { loadChatContextArtifacts } from '~~/server/utils/chats/context/artifacts'
import type { ChatContextMessage } from '~~/server/utils/chats/context/sections'

type ContextDb = ReturnType<typeof useDb>

export { CHAT_CONTEXT_MAX_MESSAGES }

export interface ChatContextMessageRow {
  id: string | number
  publicId: string | null
  role: string
  parts: unknown
  tools?: unknown
  usage: MessageUsage | null
  createdAt: Date | null
}

export function toChatContextMessages(
  rows: readonly ChatContextMessageRow[],
): ChatContextMessage[] {
  return rows
    .filter((row) => {
      return isPersistedMessageRole(row.role)
    })
    .map((row) => {
      return {
        id: String(row.publicId ?? row.id),
        role: row.role,
        parts: Array.isArray(row.parts) ? row.parts : [],
        tools: row.tools,
      }
    })
}

export function collectContextModels(
  rows: readonly ChatContextMessageRow[],
): string[] {
  const models = new Set<string>()

  for (const row of rows) {
    if (row.usage?.model) {
      models.add(row.usage.model)
    }
  }

  return [...models]
}

export function getContextCost(rows: readonly ChatContextMessageRow[]) {
  const messages = rows
    .filter((row) => {
      return isPersistedMessageRole(row.role)
    })
    .map((row) => {
      return hydrateMessageUsage({
        role: row.role,
        parts: row.parts,
        usage: row.usage,
        createdAt: row.createdAt ?? undefined,
      })
    })

  return getChatTotalCost(messages) ?? null
}

export interface ChatContextRowsResult {
  rows: ChatContextMessageRow[]
  truncated: boolean
}

/**
 * The newest `CHAT_CONTEXT_MAX_MESSAGES` message rows of one chat, returned
 * oldest first. Selected as plain rows (never a relational `with`), so a very
 * long chat is not packed into one JSON string that D1 rejects as
 * SQLITE_TOOBIG, and capped so one request never reads an unbounded chat.
 */
export async function loadChatContextRows(
  db: ContextDb,
  chatId: typeof schema.chats.$inferSelect.id,
  options: { includeUsage?: boolean } = {},
): Promise<ChatContextRowsResult> {
  const rows = await db.select({
    id: schema.messages.id,
    publicId: schema.messages.publicId,
    role: schema.messages.role,
    parts: schema.messages.parts,
    tools: schema.messages.tools,
    ...(options.includeUsage === false
      ? {}
      : { usage: schema.messages.usage }),
    createdAt: schema.messages.createdAt,
  })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(desc(schema.messages.id))
    .limit(CHAT_CONTEXT_MAX_MESSAGES + 1) as ChatContextMessageRow[]
  const truncated = rows.length > CHAT_CONTEXT_MAX_MESSAGES

  return {
    rows: rows.slice(0, CHAT_CONTEXT_MAX_MESSAGES).reverse().map((row) => {
      return { ...row, usage: row.usage ?? null }
    }),
    truncated,
  }
}

export async function loadChatContextItems(
  db: ContextDb,
  chatId: typeof schema.chats.$inferSelect.id,
): Promise<ChatContextItems> {
  const { rows, truncated } = await loadChatContextRows(db, chatId, {
    includeUsage: false,
  })

  return buildChatContext(toChatContextMessages(rows), {
    visibility: 'private',
    truncated,
  })
}

export async function loadOwnedChatContext(
  db: ContextDb,
  userId: number,
  slug: string,
  options: { includeArtifacts?: boolean } = {},
): Promise<ChatContextResponse | null> {
  const chat = await db.select({
    id: schema.chats.id,
    slug: schema.chats.slug,
    title: schema.chats.title,
    projectId: schema.chats.projectId,
    projectName: schema.projects.name,
    memoryExcluded: schema.chats.memoryExcluded,
    pinnedAt: schema.chats.pinnedAt,
  })
    .from(schema.chats)
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.chats.projectId),
    )
    .where(and(
      eq(schema.chats.slug, slug),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    return null
  }

  const share = await db.select({
    slug: schema.chatShares.slug,
    expiresAt: schema.chatShares.expiresAt,
  })
    .from(schema.chatShares)
    .where(and(
      eq(schema.chatShares.chatId, chat.id),
      buildActiveShareFilter(),
    ))
    .limit(1)
    .get()
  const { rows, truncated } = await loadChatContextRows(db, chat.id)
  const messages = toChatContextMessages(rows)
  const artifacts = options.includeArtifacts
    ? await loadChatContextArtifacts({
      db,
      chatOwnerUserId: userId,
      messages,
      visibility: 'private',
    })
    : undefined
  const context = buildChatContext(messages, {
    visibility: 'private',
    truncated,
    artifacts,
  })

  return {
    chat: {
      id: chat.id,
      slug: chat.slug,
      title: chat.title ?? '',
      pinnedAt: chat.pinnedAt ? chat.pinnedAt.toISOString() : null,
      project: chat.projectId && chat.projectName
        ? { id: String(chat.projectId), name: chat.projectName }
        : null,
      memoryExcluded: chat.memoryExcluded === true,
      share: share
        ? {
          active: true,
          url: `/shared/${share.slug}`,
          expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
        }
        : { active: false },
      cost: getContextCost(rows),
      models: collectContextModels(rows),
    },
    ...context,
  }
}
